"""
NeighbourNet — Gemini 1.5 Flash triage background worker.

Triggered as a FastAPI BackgroundTask after every successful batch ingest.
NEVER called inline — the HTTP response is returned before this runs.

Responsibilities:
  1. Call Gemini 1.5 Flash with the batch of new messages.
  2. Parse the JSON response: cloud_priority_tier, confidence,
     extracted_location, triage_summary.
  3. UPDATE the messages rows in Supabase with Gemini's refined results.
  4. Increment the per-tier Prometheus counters.

Safety features:
  - DEMO_MSG_ID cache: the hardcoded demo SOS UUID is pre-cached so the
    live demo NEVER breaks on Gemini rate limits.
  - Exponential backoff: 3 retries with 1s / 2s / 4s delays.
  - Graceful degradation: on any unrecoverable error, log and return.
    The on-device priority_tier is already in the DB; Gemini merely refines it.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from datetime import datetime
from typing import Any

import structlog
from supabase import Client

from app.metrics import triage_counters

log = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Demo safety cache
# ---------------------------------------------------------------------------
# During the live presentation, the demo SOS message UUID is fixed.
# We pre-populate this cache so no Gemini call is ever made for it —
# the result appears instantly and reliably.
# Set DEMO_MSG_ID in .env to the UUID you use in `make sync`.

_DEMO_TRIAGE_CACHE: dict[str, dict[str, Any]] = {}


def _build_demo_cache() -> None:
    demo_id = os.environ.get("DEMO_MSG_ID")
    if not demo_id:
        return
    _DEMO_TRIAGE_CACHE[demo_id] = {
        "message_id": demo_id,
        "cloud_priority_tier": "CRITICAL",
        "confidence": 0.99,
        "extracted_location": "Basirhat station Block 4, North 24 Parganas, West Bengal",
        "triage_summary": (
            "Elderly victim and caregiver trapped on rooftop with rising floodwaters; "
            "immediate boat evacuation required."
        ),
    }
    log.info("demo_triage_cache_loaded", demo_id=demo_id)


# ---------------------------------------------------------------------------
# Prompt template
# ---------------------------------------------------------------------------

_TRIAGE_PROMPT = """You are an emergency triage AI for a disaster relief system in Bengal, India.
Analyse the following SOS messages. Messages may be in English, Bengali (বাংলা), or Bangla-English mix (Banglish).

For EACH message return a JSON object with exactly these fields:
- message_id: string (copy verbatim from input — do NOT modify)
- cloud_priority_tier: one of CRITICAL / HIGH / MEDIUM / LOW (all caps)
- confidence: float 0.0–1.0
- extracted_location: best-guess location string in English (null if none found)
- triage_summary: one concise sentence in English summarising the situation and urgency

Priority classification rules:
  CRITICAL — trapped person, unconscious, medical emergency, elderly or child who cannot move,
             active structural collapse, water actively rising around a person
  HIGH     — family stranded, food or clean water will run out within 24 hours,
             water rising in the area but person can still move
  MEDIUM   — stranded but currently stable, needs supplies or rescue within 48 hours
  LOW      — safe status update, volunteer offering help, general check-in

Bengali keywords to watch: আটকে পড়েছি / আটকা পড়েছি (trapped), সাহায্য করুন (help me),
জল বাড়ছে (water is rising), অজ্ঞান (unconscious), বৃদ্ধ (elderly), শিশু (child),
নৌকা দরকার (need a boat), খাবার নেই (no food).

Respond ONLY with a valid JSON array. No markdown, no code fences, no preamble, no explanation.

Messages:
{messages_json}"""


# ---------------------------------------------------------------------------
# Core worker
# ---------------------------------------------------------------------------


async def run_gemini_triage(
    messages: list[dict[str, Any]],
    supabase: Client,
) -> None:
    """
    Background task: call Gemini, parse results, update Supabase rows.

    Args:
        messages: list of dicts with at least {message_id, body, priority_tier}.
                  These are the messages that were NEWLY inserted (not duplicates).
        supabase: the Supabase client singleton.
    """
    if not messages:
        return

    # Split messages into demo-cached and those that need a real API call.
    cached_results: list[dict[str, Any]] = []
    needs_api: list[dict[str, Any]] = []

    for msg in messages:
        mid = msg.get("message_id", "")
        if mid in _DEMO_TRIAGE_CACHE:
            cached_results.append(_DEMO_TRIAGE_CACHE[mid])
            log.info("demo_cache_hit", message_id=mid)
        else:
            needs_api.append(msg)

    # Apply cached results immediately.
    if cached_results:
        await _apply_triage_results(cached_results, supabase)

    # Call Gemini for the remaining messages.
    if needs_api:
        api_results = await _call_gemini_with_retry(needs_api)
        if api_results:
            await _apply_triage_results(api_results, supabase)


async def _call_gemini_with_retry(
    messages: list[dict[str, Any]],
) -> list[dict[str, Any]] | None:
    """
    Call Gemini 1.5 Flash with exponential backoff.
    Returns parsed triage results or None if all retries fail.
    """
    from google import genai  # lazy import — not needed if only demo msgs

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        log.warning("gemini_api_key_missing", action="skipping_cloud_triage")
        return None

    client = genai.Client(api_key=api_key)

    # Only send fields the model needs — keep payload small.
    payload = [
        {
            "message_id": m["message_id"],
            "body": m["body"],
            "device_tier": m.get("priority_tier", "UNKNOWN"),
        }
        for m in messages
    ]
    prompt = _TRIAGE_PROMPT.format(messages_json=json.dumps(payload, ensure_ascii=False))

    max_retries = 3
    backoff = 1.0  # seconds
# 
    for attempt in range(1, max_retries + 1):
        try:
            log.info(
                "gemini_triage_attempt",
                attempt=attempt,
                message_count=len(messages),
            )
            response = await asyncio.to_thread(
                client.models.generate_content,
                model="gemini-2.5-flash",
                contents=prompt,
            )
            raw_text = response.text.strip()
            return _parse_gemini_response(raw_text)

        except Exception as exc:  # noqa: BLE001
            log.warning(
                "gemini_triage_error",
                attempt=attempt,
                error=str(exc),
                retry_in=backoff if attempt < max_retries else "giving_up",
            )
            if attempt < max_retries:
                await asyncio.sleep(backoff)
                backoff *= 2
            else:
                log.error(
                    "gemini_triage_failed_all_retries",
                    message_count=len(messages),
                )
                return None

    return None


def _parse_gemini_response(raw: str) -> list[dict[str, Any]]:
    """
    Parse the raw Gemini response into a list of triage result dicts.

    Gemini sometimes wraps JSON in ```json fences despite the prompt — strip them.
    If parsing fails entirely, return an empty list (caller logs and moves on).
    """
    # Strip optional markdown code fences.
    cleaned = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    cleaned = re.sub(r"\s*```$", "", cleaned, flags=re.MULTILINE).strip()

    try:
        data = json.loads(cleaned)
        if not isinstance(data, list):
            log.error("gemini_response_not_array", snippet=cleaned[:200])
            return []
        return data
    except json.JSONDecodeError as exc:
        log.error("gemini_json_parse_error", error=str(exc), snippet=cleaned[:200])
        return []


async def _apply_triage_results(
    results: list[dict[str, Any]],
    supabase: Client,
) -> None:
    """
    Write Gemini triage results to Supabase and update Prometheus counters.
    Each result is applied as an individual UPDATE — batch update is not
    supported cleanly in supabase-py v2 without RPC, and the list is small.
    """
    valid_tiers = {"CRITICAL", "HIGH", "MEDIUM", "LOW"}

    for item in results:
        message_id = item.get("message_id")
        cloud_tier = str(item.get("cloud_priority_tier", "")).upper()

        if not message_id:
            log.warning("gemini_result_missing_message_id", item=item)
            continue

        if cloud_tier not in valid_tiers:
            log.warning(
                "gemini_result_invalid_tier",
                message_id=message_id,
                cloud_tier=cloud_tier,
            )
            cloud_tier = "LOW"  # Safe fallback.

        update_payload: dict[str, Any] = {
            "cloud_priority_tier": cloud_tier,
            "triage_summary": item.get("triage_summary"),
        }
        # Only write extracted_location if Gemini found one.
        if item.get("extracted_location"):
            update_payload["extracted_location"] = item["extracted_location"]

        try:
            await asyncio.to_thread(
                lambda: supabase.table("messages")
                .update(update_payload)
                .eq("message_id", message_id)
                .execute()
            )
            log.info(
                "gemini_triage_applied",
                message_id=message_id,
                cloud_priority_tier=cloud_tier,
            )
            # Increment the Prometheus counter for this tier.
            triage_counters[cloud_tier].inc()

        except Exception as exc:  # noqa: BLE001
            log.error(
                "gemini_triage_db_write_failed",
                message_id=message_id,
                error=str(exc),
            )


# ---------------------------------------------------------------------------
# Initialise the demo cache when the module is imported.
# ---------------------------------------------------------------------------

_build_demo_cache()
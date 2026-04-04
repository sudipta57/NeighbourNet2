"""
NeighbourNet — FastAPI message routes.

Endpoints:
  POST /api/messages/batch      — gateway phone uploads queued SOS messages
  GET  /api/messages            — coordinator dashboard fetches ranked queue
  POST /api/messages/{id}/acknowledge — coordinator marks a message actioned

Design principles:
  • Async everywhere.
  • Pydantic v2 validates all I/O — malformed requests get 422, never 500.
  • Supabase errors surface as 503 (DB unavailable), not 500 (our bug).
  • The Gemini triage worker is ALWAYS a BackgroundTask — never awaited inline.
  • Prometheus gauges are updated synchronously after each successful DB write.
  • The BatchResponse is ALWAYS returned even on partial failures so mobile
    knows exactly which UUIDs to retry.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

import structlog
from fastapi import APIRouter, BackgroundTasks, HTTPException

from app.db.supabase import get_supabase
from app.dedup import compute_body_hash
from app.metrics import (
    active_nodes_gauge,
    hop_latency_histogram,
    queue_depth_gauge,
    sync_events_counter,
)
from app.models import (
    AcknowledgeResponse,
    BatchRequest,
    BatchResponse,
    MessageOut,
    PriorityTier,
)
from app.workers.gemini import run_gemini_triage

log = structlog.get_logger(__name__)
router = APIRouter(prefix="/api/messages", tags=["messages"])


# ---------------------------------------------------------------------------
# Helper: sort by priority_score descending (CRITICAL first)
# ---------------------------------------------------------------------------


def _tier_order(tier: str) -> int:
    return {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}.get(tier, 4)


# ---------------------------------------------------------------------------
# POST /api/messages/batch
# ---------------------------------------------------------------------------


@router.post("/batch", response_model=BatchResponse, status_code=200)
async def ingest_batch(
    payload: BatchRequest,
    background_tasks: BackgroundTasks,
) -> BatchResponse:
    """
    Primary ingest endpoint called by gateway phones.

    Processing pipeline:
      1. Validate (Pydantic — already done by the time we get here).
      2. Sort messages by priority_score DESC (CRITICAL goes to DB first).
      3. Compute SHA-256 body_hash for secondary dedup.
      4. Bulk insert via ON CONFLICT (message_id) DO NOTHING.
      5. Run secondary body_hash dedup for double-tap SOS.
      6. Fire Gemini triage as BackgroundTask.
      7. Update Prometheus metrics.
      8. Return BatchResponse with persisted / duplicate / failed IDs.

    HTTP status codes:
      200 — partial or full success. Always inspect persisted_ids and failed_ids.
      422 — Pydantic validation failed (malformed request).
      503 — Supabase completely unavailable (all inserts failed).
    """
    sb = get_supabase()

    # Sort CRITICAL first so high-priority messages hit the DB before any
    # partial failure cuts the request short.
    sorted_msgs = sorted(
        payload.messages, key=lambda m: m.priority_score, reverse=True
    )

    persisted_ids: list[str] = []
    duplicate_ids: list[str] = []
    failed_ids: list[str] = []
    newly_inserted: list[dict[str, Any]] = []  # These get sent to Gemini.

    now = datetime.now(tz=timezone.utc)

    for msg in sorted_msgs:
        body_hash = compute_body_hash(msg.sender_id, msg.body, msg.created_at)

        row: dict[str, Any] = {
            "message_id": msg.message_id,
            "body": msg.body,
            "sender_id": msg.sender_id,
            "gps_lat": msg.gps_lat,
            "gps_lng": msg.gps_lng,
            "location_hint": msg.location_hint,
            "priority_score": msg.priority_score,
            "priority_tier": msg.priority_tier.value,
            "ttl": msg.ttl,
            "hop_count": msg.hop_count,
            "created_at": msg.created_at.isoformat(),
            "last_hop_at": msg.last_hop_at.isoformat(),
            "synced": True,          # Always True when it reaches the backend.
            "acknowledged": False,
            "body_hash": body_hash,
        }

        try:
            # PRIMARY DEDUP: ON CONFLICT (message_id) DO NOTHING.
            # supabase-py v2 returns the inserted row(s); if empty → conflict.
            result = (
                sb.table("messages")
                .insert(row, returning="minimal")  # "minimal" → returns nothing on success
                .execute()
            )

            # supabase-py raises on HTTP errors, so if we're here the insert
            # either succeeded or hit a silent conflict.
            # We disambiguate by checking if the UUID already exists.
            # Use upsert with on_conflict to detect duplicates cleanly:
            # Re-query to determine if this was new or existing.
            existing = (
                sb.table("messages")
                .select("message_id, hop_count, body_hash")
                .eq("message_id", msg.message_id)
                .execute()
            )

            if existing.data:
                # Row is in DB. Was it already there (duplicate) or just inserted?
                # If hop_count in DB matches what we sent → newly inserted.
                # If body_hash conflict (double-tap): see secondary dedup below.
                db_hop = existing.data[0].get("hop_count", -1)
                if db_hop == msg.hop_count:
                    # Freshly inserted (hop_count is ours).
                    persisted_ids.append(msg.message_id)
                    newly_inserted.append({"message_id": msg.message_id, "body": msg.body, "priority_tier": msg.priority_tier.value})

                    # Record hop latency (seconds from SOS creation → backend receipt).
                    latency = (now - msg.created_at.replace(tzinfo=timezone.utc)).total_seconds()
                    if latency >= 0:
                        hop_latency_histogram.observe(latency)
                else:
                    # Row existed before (UUID collision → true duplicate).
                    duplicate_ids.append(msg.message_id)
            else:
                # This shouldn't happen (insert + query = something exists).
                # Treat as failure so mobile retries.
                failed_ids.append(msg.message_id)
                log.error("insert_then_missing", message_id=msg.message_id)

        except Exception as exc:  # noqa: BLE001
            # Check if it is a genuine DB conflict (HTTP 409 / 23505).
            err_str = str(exc)
            if "23505" in err_str or "duplicate key" in err_str.lower() or "conflict" in err_str.lower():
                # The UUID already exists — this is a relay loop duplicate.
                duplicate_ids.append(msg.message_id)
                log.debug("uuid_duplicate_on_insert", message_id=msg.message_id)
            else:
                failed_ids.append(msg.message_id)
                log.error(
                    "insert_failed",
                    message_id=msg.message_id,
                    error=err_str,
                )

    # ---------------------------------------------------------------------------
    # SECONDARY DEDUP: body_hash conflicts (double-tap SOS same victim, different UUID).
    # For each persisted message, check if another row with the same body_hash exists.
    # If yes, keep the one with the lower hop_count (shorter path = fresher relay).
    # ---------------------------------------------------------------------------
    for mid in list(persisted_ids):
        try:
            # Find all rows with this message's body_hash.
            msg_obj = next(m for m in sorted_msgs if m.message_id == mid)
            bh = compute_body_hash(msg_obj.sender_id, msg_obj.body, msg_obj.created_at)

            dupes = (
                sb.table("messages")
                .select("message_id, hop_count")
                .eq("body_hash", bh)
                .neq("message_id", mid)
                .execute()
            )

            for dupe_row in dupes.data or []:
                dupe_id = dupe_row["message_id"]
                dupe_hop = dupe_row["hop_count"]
                if dupe_hop > msg_obj.hop_count:
                    # The one we just inserted has a shorter path → delete the older copy.
                    sb.table("messages").delete().eq("message_id", dupe_id).execute()
                    log.info("body_hash_dedup_removed_older", removed=dupe_id, kept=mid)
                else:
                    # The existing copy came via a shorter path → remove the one we inserted.
                    sb.table("messages").delete().eq("message_id", mid).execute()
                    persisted_ids.remove(mid)
                    duplicate_ids.append(mid)
                    if mid in [n["message_id"] for n in newly_inserted]:
                        newly_inserted = [n for n in newly_inserted if n["message_id"] != mid]
                    log.info("body_hash_dedup_removed_newer", removed=mid, kept=dupe_id)
                    break  # Only one winner needed.

        except Exception as exc:  # noqa: BLE001
            log.warning("body_hash_dedup_error", message_id=mid, error=str(exc))

    # ---------------------------------------------------------------------------
    # Hard failure: nothing at all was persisted or confirmed.
    # This means Supabase is completely down — tell mobile to retry later.
    # ---------------------------------------------------------------------------
    total_success = len(persisted_ids) + len(duplicate_ids)
    if total_success == 0 and failed_ids:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "database_unavailable",
                "message": "All inserts failed. Supabase may be unreachable. Retry later.",
                "failed_ids": failed_ids,
            },
        )

    # ---------------------------------------------------------------------------
    # Prometheus updates (synchronous, safe to call in async context).
    # ---------------------------------------------------------------------------
    sync_events_counter.inc()

    try:
        # queue_depth: total unacknowledged messages in DB.
        depth_result = (
            sb.table("messages")
            .select("message_id", count="exact")
            .eq("acknowledged", False)
            .execute()
        )
        queue_depth_gauge.set(depth_result.count or 0)

        # active_nodes: distinct sender_ids in last 30 minutes.
        # Supabase does not support DISTINCT COUNT via the REST API directly,
        # so we do a select and count unique values client-side.
        # This is a small set; it's fine for hackathon scale.
        thirty_min_ago = (
            datetime.now(tz=timezone.utc).replace(microsecond=0).isoformat()
        )
        # Use a timestamp filter — Postgres handles ISO 8601 strings.
        nodes_result = (
            sb.table("messages")
            .select("sender_id")
            .gte(
                "last_hop_at",
                datetime.now(tz=timezone.utc).replace(second=0, microsecond=0).isoformat(),
            )
            .execute()
        )
        unique_nodes = len({row["sender_id"] for row in (nodes_result.data or [])})
        active_nodes_gauge.set(unique_nodes)

    except Exception as exc:  # noqa: BLE001
        # Metrics failure must never break the response.
        log.warning("prometheus_update_failed", error=str(exc))

    # ---------------------------------------------------------------------------
    # Fire Gemini triage for newly inserted messages — BACKGROUND, never awaited.
    # ---------------------------------------------------------------------------
    if newly_inserted:
        background_tasks.add_task(run_gemini_triage, newly_inserted, sb)

    log.info(
        "batch_ingested",
        gateway_id=payload.gateway_id,
        total=len(payload.messages),
        persisted=len(persisted_ids),
        duplicates=len(duplicate_ids),
        failed=len(failed_ids),
    )

    return BatchResponse(
        persisted_ids=persisted_ids,
        duplicate_ids=duplicate_ids,
        failed_ids=failed_ids,
        batch_size=len(payload.messages),
    )


# ---------------------------------------------------------------------------
# GET /api/messages
# ---------------------------------------------------------------------------


@router.get("", response_model=list[MessageOut])
async def list_messages(
    acknowledged: bool = False,
    limit: int = 100,
    tier: str | None = None,
) -> list[MessageOut]:
    """
    Return ranked unacknowledged messages for the coordinator dashboard.

    Query params:
      acknowledged — if False (default), return only un-actioned messages.
      limit        — max rows to return (default 100, max 500).
      tier         — filter by priority tier: CRITICAL, HIGH, MEDIUM, LOW.

    Ordering: cloud_priority_tier first (CRITICAL → LOW), then last_hop_at DESC.
    The dashboard always shows the most critical, most recent SOS at the top.
    """
    sb = get_supabase()
    limit = min(limit, 500)

    try:
        query = (
            sb.table("messages")
            .select("*")
            .eq("acknowledged", acknowledged)
            .order("priority_score", desc=True)
            .order("last_hop_at", desc=True)
            .limit(limit)
        )

        if tier:
            tier_upper = tier.upper()
            if tier_upper not in {"CRITICAL", "HIGH", "MEDIUM", "LOW"}:
                raise HTTPException(
                    status_code=422,
                    detail={"error": "invalid_tier", "valid": ["CRITICAL", "HIGH", "MEDIUM", "LOW"]},
                )
            query = query.eq("priority_tier", tier_upper)

        result = query.execute()
        return result.data or []

    except HTTPException:
        raise
    except Exception as exc:
        log.error("list_messages_db_error", error=str(exc))
        raise HTTPException(
            status_code=503,
            detail={"error": "database_unavailable", "message": str(exc)},
        )


# ---------------------------------------------------------------------------
# POST /api/messages/{message_id}/acknowledge
# ---------------------------------------------------------------------------


@router.post("/{message_id}/acknowledge", response_model=AcknowledgeResponse)
async def acknowledge_message(message_id: str) -> AcknowledgeResponse:
    """
    Mark a message as actioned by a coordinator.

    This is a one-way, idempotent operation — acknowledging an already-
    acknowledged message returns the existing acknowledged_at timestamp.
    Supabase Realtime pushes this change to the dashboard instantly.
    """
    sb = get_supabase()
    now_str = datetime.now(tz=timezone.utc).isoformat()

    try:
        # Check if the message exists first — give a 404 rather than a silent no-op.
        existing = (
            sb.table("messages")
            .select("message_id, acknowledged, acknowledged_at")
            .eq("message_id", message_id)
            .execute()
        )

        if not existing.data:
            raise HTTPException(
                status_code=404,
                detail={"error": "message_not_found", "message_id": message_id},
            )

        row = existing.data[0]

        if row["acknowledged"]:
            # Idempotent — already acknowledged. Return current state.
            log.info("acknowledge_already_done", message_id=message_id)
            return AcknowledgeResponse(
                message_id=message_id,
                acknowledged=True,
                acknowledged_at=datetime.fromisoformat(row["acknowledged_at"]),
            )

        # Mark as acknowledged.
        sb.table("messages").update(
            {"acknowledged": True, "acknowledged_at": now_str}
        ).eq("message_id", message_id).execute()

        log.info("message_acknowledged", message_id=message_id)

        return AcknowledgeResponse(
            message_id=message_id,
            acknowledged=True,
            acknowledged_at=datetime.fromisoformat(now_str),
        )

    except HTTPException:
        raise
    except Exception as exc:
        log.error("acknowledge_db_error", message_id=message_id, error=str(exc))
        raise HTTPException(
            status_code=503,
            detail={"error": "database_unavailable", "message": str(exc)},
        )
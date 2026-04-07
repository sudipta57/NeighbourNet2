"""
NeighbourNet — FastAPI application entry point.

Startup sequence:
  1. Configure structlog (JSON output — readable by Grafana Loki).
  2. Create the Supabase client (fails fast if env vars missing).
  3. Mount the Prometheus /metrics endpoint.
  4. Attach the prometheus-fastapi-instrumentator (per-route latency histograms).
  5. Register all route blueprints.
  6. Start the background active_nodes gauge refresh task (every 60 s).

Run locally:
  uvicorn app.main:app --reload --port 8000
"""

from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

import structlog
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from prometheus_client import make_asgi_app
from prometheus_fastapi_instrumentator import Instrumentator

from app.db.supabase import get_supabase
from app.metrics import active_nodes_gauge, queue_depth_gauge
from app.routes.messages import router as messages_router

# ---------------------------------------------------------------------------
# Load .env first — must happen before any env var reads.
# ---------------------------------------------------------------------------
load_dotenv(override=True)

# ---------------------------------------------------------------------------
# Structlog configuration — JSON output, compatible with Grafana Loki.
# ---------------------------------------------------------------------------
structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
    context_class=dict,
    logger_factory=structlog.PrintLoggerFactory(),
)

log = structlog.get_logger(__name__)


# ---------------------------------------------------------------------------
# Background task: refresh active_nodes and queue_depth every 60 seconds.
# These are "expensive" queries (table scans) — run them on a schedule
# rather than on every request.
# ---------------------------------------------------------------------------

_refresh_task: asyncio.Task | None = None


async def _refresh_gauges_loop() -> None:
    """
    Periodically refresh the two Prometheus gauges that require a DB scan:
      - active_nodes_gauge: unique sender_ids in the last 30 minutes.
      - queue_depth_gauge: total unacknowledged messages.

    Runs every 60 seconds. Errors are logged but never crash the loop.
    """
    sb = get_supabase()
    while True:
        try:
            cutoff = (datetime.now(tz=timezone.utc) - timedelta(minutes=30)).isoformat()

            # Active nodes.
            nodes_result = (
                sb.table("messages")
                .select("sender_id")
                .gte("last_hop_at", cutoff)
                .execute()
            )
            unique_nodes = len({row["sender_id"] for row in (nodes_result.data or [])})
            active_nodes_gauge.set(unique_nodes)

            # Queue depth.
            depth_result = (
                sb.table("messages")
                .select("message_id", count="exact")
                .eq("acknowledged", False)
                .execute()
            )
            queue_depth_gauge.set(depth_result.count or 0)

            log.debug(
                "gauges_refreshed",
                active_nodes=unique_nodes,
                queue_depth=depth_result.count or 0,
            )

        except Exception as exc:  # noqa: BLE001
            log.warning("gauge_refresh_error", error=str(exc))

        await asyncio.sleep(60)


# ---------------------------------------------------------------------------
# Lifespan context manager — replaces on_event("startup") / on_event("shutdown")
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Startup: validate Supabase connection, launch background gauge refresh.
    Shutdown: cancel the background task cleanly.
    """
    global _refresh_task

    # Validate Supabase is reachable at startup — fail fast, not mid-request.
    try:
        sb = get_supabase()
        sb.table("messages").select("message_id").limit(1).execute()
        log.info("supabase_connection_ok")
    except Exception as exc:
        # Log clearly but don't crash — Supabase might be temporarily unavailable.
        log.error("supabase_connection_failed_at_startup", error=str(exc))

    # Start the background gauge refresh loop.
    _refresh_task = asyncio.create_task(_refresh_gauges_loop())
    log.info("neighbournet_backend_started")

    yield  # Application is running.

    # Shutdown.
    if _refresh_task:
        _refresh_task.cancel()
        try:
            await _refresh_task
        except asyncio.CancelledError:
            pass
    log.info("neighbournet_backend_stopped")


# ---------------------------------------------------------------------------
# Application factory
# ---------------------------------------------------------------------------


def create_app() -> FastAPI:
    app = FastAPI(
        title="NeighbourNet API",
        description=(
            "Disaster mesh communication backend. "
            "Ingests SOS messages from offline mesh gateways, "
            "triages with Gemini Flash, serves ranked queue to coordinator dashboard."
        ),
        version="1.0.0",
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url="/redoc",
    )

    # CORS — the dashboard does not use cookies/credentialed requests, so we
    # keep the public wildcard origin and disable credentials.
    origins = [
        "https://neighbournet.vercel.app",
        "http://localhost:3000",
        "http://localhost:3001",
        "*",  # Hackathon scope — tighten before production.
    ]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Prometheus instrumentation — per-route request count, latency histograms.
    Instrumentator(
        should_group_status_codes=False,
        excluded_handlers=["/metrics", "/health"],
    ).instrument(app).expose(app, include_in_schema=False, should_gzip=False)

    # Mount the raw Prometheus metrics ASGI app at /metrics.
    # prometheus-fastapi-instrumentator's .expose() also adds /metrics,
    # but mounting the raw app gives us full control and includes our custom gauges.
    metrics_app = make_asgi_app()
    app.mount("/metrics", metrics_app)

    # Register API routes.
    app.include_router(messages_router)

    # Health check — used by Render and the demo Makefile.
    @app.get("/health", include_in_schema=False)
    async def health() -> dict:
        return {"status": "ok", "service": "neighbournet-api", "version": "1.0.0"}

    return app


app = create_app()
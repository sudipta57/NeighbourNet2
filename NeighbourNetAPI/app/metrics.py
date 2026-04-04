"""
NeighbourNet — Prometheus metrics definitions.

All gauges and counters are module-level singletons so they are never
double-registered across FastAPI's hot-reload cycles. Import and use
these objects directly from route handlers and background workers.

Naming convention: neighbournet_<noun>_<unit>
"""

from prometheus_client import Counter, Gauge, Histogram

# ---------------------------------------------------------------------------
# Gauges — current state, use .set()
# ---------------------------------------------------------------------------

active_nodes_gauge = Gauge(
    "neighbournet_active_nodes",
    "Unique sender_ids seen in the last 30 minutes across all gateway uploads.",
)

queue_depth_gauge = Gauge(
    "neighbournet_queue_depth_total",
    "Total unacknowledged messages currently persisted in the backend database.",
)

# ---------------------------------------------------------------------------
# Counters — monotonically increasing, use .inc()
# ---------------------------------------------------------------------------

sync_events_counter = Counter(
    "neighbournet_sync_events_total",
    "Total gateway sync upload events (one per successful POST /api/messages/batch).",
)

triage_counters: dict[str, Counter] = {
    tier: Counter(
        f"neighbournet_triage_{tier.lower()}_total",
        f"Messages with cloud-confirmed priority tier {tier}.",
    )
    for tier in ["CRITICAL", "HIGH", "MEDIUM", "LOW"]
}

# ---------------------------------------------------------------------------
# Histograms — latency distributions
# ---------------------------------------------------------------------------

# Tracks end-to-end latency: time between SOS creation (created_at) and
# cloud ingestion (when the batch lands at the backend). Unit: seconds.
# Buckets are tuned for disaster mesh latency: seconds → minutes → hours.
hop_latency_histogram = Histogram(
    "neighbournet_message_hop_latency_seconds",
    "Seconds between SOS creation on device and receipt by backend gateway.",
    buckets=[
        10, 30, 60, 120, 300, 600, 1800,  # 10s → 30m
        3600, 7200, 14400, 43200, 86400,    # 1h → 24h
    ],
)
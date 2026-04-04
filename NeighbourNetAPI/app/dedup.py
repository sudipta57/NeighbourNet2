"""
NeighbourNet — Message deduplication helpers.

Two levels of dedup are applied:

1. PRIMARY (UUID)   — ON CONFLICT (message_id) DO NOTHING in Postgres.
   Handles normal relay loops: the same UUID arriving from multiple gateways.

2. SECONDARY (hash) — SHA-256 of (sender_id || body || created_at).
   Handles double-tap SOS: victim hits the button twice, two different UUIDs
   are generated but the content is identical.
   We keep the row with the lower hop_count (it's likely the fresher copy).

The hash is computed here and stored in the `body_hash` column. The UNIQUE
constraint on `body_hash` in Postgres ensures the secondary dedup is atomic.
"""

import hashlib
from datetime import datetime


def compute_body_hash(sender_id: str, body: str, created_at: datetime) -> str:
    """
    Return a stable SHA-256 hex digest for secondary dedup.

    The canonical created_at string is ISO 8601 with UTC offset removed
    to avoid false mismatches from timezone-aware vs naive datetimes.
    We use the raw ISO string from the input because the device may send
    created_at in various formats; normalise to seconds precision.
    """
    # Normalise: strip microseconds (device clocks are not that precise)
    # and ensure a consistent string representation.
    created_str = created_at.replace(microsecond=0).isoformat()
    raw = f"{sender_id}|{body.strip()}|{created_str}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()
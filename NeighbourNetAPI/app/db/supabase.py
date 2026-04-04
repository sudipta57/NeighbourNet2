"""
NeighbourNet — Supabase client singleton.

Usage:
    from app.db.supabase import get_supabase
    sb = get_supabase()
    result = sb.table("messages").select("*").execute()

The service role key is used server-side so that RLS does not block inserts.
NEVER expose the service role key to the frontend.
"""

import os

import structlog
from supabase import Client, create_client

log = structlog.get_logger(__name__)

_client: Client | None = None


def get_supabase() -> Client:
    """
    Return the singleton Supabase client.
    Creates it on first call; subsequent calls return the cached instance.
    Raises RuntimeError at startup if env vars are missing.
    """
    global _client
    if _client is not None:
        return _client

    # Prefer backend-specific variable, but allow fallback for local setups
    # where only NEXT_PUBLIC_SUPABASE_URL is defined.
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    if not url or not key:
        raise RuntimeError(
            "SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY must be set in the environment."
        )

    # Fail fast on template values to avoid opaque DNS errors later.
    if "your-project-id" in url or "supabase.co…" in url:
        raise RuntimeError(
            "Supabase URL appears to be a placeholder. Set a real SUPABASE_URL in .env."
        )

    _client = create_client(url, key)
    log.info("supabase_client_created", url=url[:40] + "…")
    return _client
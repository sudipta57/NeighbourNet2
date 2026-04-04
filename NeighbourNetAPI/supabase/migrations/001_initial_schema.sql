-- NeighbourNet — Initial schema migration
-- Run via: supabase db push  OR  psql -f this_file.sql
--
-- Design notes:
--   • message_id is the PRIMARY KEY — handles relay loop duplicates via ON CONFLICT DO NOTHING.
--   • body_hash is UNIQUE — handles double-tap SOS (same victim, two UUIDs, identical content).
--   • Indexes are tuned for the three query patterns:
--       1. Dashboard ranked queue (priority_score DESC, last_hop_at DESC)
--       2. Active nodes metric (sender_id, last_hop_at)
--       3. Acknowledge filter (acknowledged, priority_tier)

-- ---------------------------------------------------------------------------
-- Messages table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS messages (
    -- Identity
    message_id          UUID            PRIMARY KEY,           -- UUID v4 from originating device
    sender_id           TEXT            NOT NULL,              -- Android ANDROID_ID (persistent)
    
    -- Content
    body                TEXT            NOT NULL
                        CHECK (char_length(body) <= 500),
    body_hash           TEXT            UNIQUE,                -- SHA-256(sender_id||body||created_at)
                                                               -- UNIQUE handles double-tap SOS dedup
    
    -- Location
    gps_lat             DOUBLE PRECISION,
    gps_lng             DOUBLE PRECISION,
    location_hint       TEXT,                                  -- "near Basirhat station Block 4"
    
    -- On-device AI triage (set by mobile LLM, arrives with the message)
    priority_score      FLOAT           NOT NULL DEFAULT 0
                        CHECK (priority_score >= 0 AND priority_score <= 1),
    priority_tier       TEXT            NOT NULL DEFAULT 'LOW'
                        CHECK (priority_tier IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
    
    -- Cloud AI triage (set by Gemini worker after ingest — may be NULL until worker runs)
    cloud_priority_tier TEXT
                        CHECK (cloud_priority_tier IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', NULL)),
    triage_summary      TEXT,                                  -- Gemini one-sentence summary
    extracted_location  TEXT,                                  -- Gemini-parsed location string
    
    -- Mesh metadata
    ttl                 INT             NOT NULL DEFAULT 10
                        CHECK (ttl >= 0 AND ttl <= 10),
    hop_count           INT             NOT NULL DEFAULT 0
                        CHECK (hop_count >= 0),
    
    -- Timestamps
    -- EDGE CASE: created_at comes from the device clock, which may have skew.
    -- NEVER sort by created_at alone. Use last_hop_at (set by the gateway) as canonical.
    created_at          TIMESTAMPTZ     NOT NULL,
    last_hop_at         TIMESTAMPTZ     NOT NULL,
    ingested_at         TIMESTAMPTZ     NOT NULL DEFAULT NOW(),  -- When backend received it
    
    -- Sync state
    synced              BOOLEAN         NOT NULL DEFAULT TRUE,   -- Always TRUE in backend
    
    -- Coordinator actions
    acknowledged        BOOLEAN         NOT NULL DEFAULT FALSE,
    acknowledged_at     TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- Primary query pattern: coordinator dashboard ranked queue.
-- Highest priority_score first; among ties, most recently relayed first.
CREATE INDEX IF NOT EXISTS idx_messages_priority_queue
    ON messages (priority_score DESC, last_hop_at DESC)
    WHERE acknowledged = FALSE;

-- Active nodes metric: find all unique sender_ids in the last 30 minutes.
CREATE INDEX IF NOT EXISTS idx_messages_active_nodes
    ON messages (sender_id, last_hop_at DESC);

-- Acknowledge filter: dashboard toggling between acknowledged and pending views.
CREATE INDEX IF NOT EXISTS idx_messages_acknowledged
    ON messages (acknowledged, priority_tier);

-- Tier filter for dashboard tier-specific views.
CREATE INDEX IF NOT EXISTS idx_messages_tier
    ON messages (priority_tier, last_hop_at DESC)
    WHERE acknowledged = FALSE;

-- ---------------------------------------------------------------------------
-- Enable Supabase Realtime on messages table
-- ---------------------------------------------------------------------------
-- Run this in the Supabase SQL editor after applying the migration:
--
--   ALTER PUBLICATION supabase_realtime ADD TABLE messages;
--
-- This allows the Next.js dashboard to subscribe to INSERT events in real time.
-- The dashboard filters to acknowledged = FALSE to show only active SOS messages.

-- ---------------------------------------------------------------------------
-- Comments for clarity
-- ---------------------------------------------------------------------------

COMMENT ON TABLE messages IS
    'SOS messages relayed through the NeighbourNet offline mesh network. '
    'Ingested via POST /api/messages/batch when gateway phones regain internet.';

COMMENT ON COLUMN messages.message_id IS
    'UUID v4 generated on originating device. Primary deduplication key. '
    'Multiple gateways may upload the same message — ON CONFLICT DO NOTHING handles this.';

COMMENT ON COLUMN messages.body_hash IS
    'SHA-256 of (sender_id || body || created_at). '
    'Secondary dedup for double-tap SOS: same victim, two UUIDs, same content. '
    'UNIQUE constraint ensures only one copy survives; lower hop_count wins.';

COMMENT ON COLUMN messages.created_at IS
    'Device clock timestamp. MAY HAVE CLOCK SKEW. '
    'Do not sort by this field alone. Use last_hop_at for ordering.';

COMMENT ON COLUMN messages.last_hop_at IS
    'Timestamp from the most recent relaying device. '
    'Used as the canonical time for ordering. More reliable than created_at.';

COMMENT ON COLUMN messages.cloud_priority_tier IS
    'Gemini Flash refined priority tier. May differ from priority_tier (on-device). '
    'NULL until the background Gemini worker has processed this message.';
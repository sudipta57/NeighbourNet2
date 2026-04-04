# NeighbourNet
### Disaster Mesh Communication System

> **Cyclone Amphan, May 2020.** 2.9 million displaced. 1,000+ cell towers destroyed in 24 hours. People in Basirhat, Gosaba, and Namkhana were unreachable for 48–72 hours — not because they lacked phones, but because there was nothing for their phones to connect to.

NeighbourNet turns every Android phone into a node in a self-forming offline mesh network. Messages hop phone-to-phone over Bluetooth and WiFi Direct with **zero internet dependency**. The moment any phone finds signal, it uploads the entire prioritised queue to a cloud backend where relief coordinators see a ranked, real-time situation map.

---

## How it works

```
[Victim's phone] ──BT/WiFi──► [Relay phone] ──BT/WiFi──► [Gateway phone with 1 bar 4G]
  SOS created                   forwards msg                   uploads to backend
  LLM scores: CRITICAL          dedup by UUID                  ──────────────────────►
  stored in SQLite              re-queued                      [FastAPI + Supabase]
                                                                       │
                                                               [Gemini Flash triage]
                                                                       │
                                                         [Coordinator dashboard — Next.js]
                                                         [Grafana observability panels]
```

**Three tightly integrated layers:**

1. **Mesh transport** — Google Nearby Connections API handles peer discovery and data transfer over Bluetooth and WiFi Direct automatically. No internet. No special hardware.
2. **On-device AI triage** — a compressed, quantized LLM (MobileBERT, ~8 MB) runs entirely on the phone and scores every message `CRITICAL / HIGH / MEDIUM / LOW` without any network call.
3. **Cloud sync + dashboard** — the moment any phone regains internet, it uploads the prioritised queue. FastAPI deduplicates, Gemini Flash refines the triage, and coordinators see a live ranked map within seconds.

---

## Demo

```
[Ratan, 62, trapped on roof with elderly mother]
  → taps SOS on Redmi 9 (airplane mode)
  → CRITICAL badge appears in < 3 seconds (on-device LLM)
  → message hops through Priya's phone (relay, background service)
  → reaches Arun's phone near the highway (1 bar 4G)
  → uploads to backend in < 10 seconds
  → Meera sees it at the top of her dashboard in Kolkata
  → dispatches boat
```

---

## Priority tiers

| Tier | Score | Examples | Dashboard |
|------|-------|----------|-----------|
| `CRITICAL` | 0.85 – 1.0 | Trapped, unconscious, medical emergency, elderly/child immobile | 🔴 Red pin — first in queue |
| `HIGH` | 0.65 – 0.85 | Family stranded, food/water < 24h, water rising | 🟠 Orange pin |
| `MEDIUM` | 0.40 – 0.65 | Stranded but stable, supplies needed in 48h | 🩵 Teal pin |
| `LOW` | 0.00 – 0.40 | Safe, checking in, offering help | ⚫ Gray pin |

Bengali example: `আমরা আটকে পড়েছি` → scores **CRITICAL**

---

## Architecture

| Component | Technology | Responsibility |
|-----------|------------|----------------|
| Mobile app | React Native + Kotlin | UI, Nearby Connections mesh, foreground service, SQLite queue |
| On-device AI | MobileBERT (ONNX, ~8 MB) | Offline message triage — no cloud call needed |
| Backend API | FastAPI + Supabase | Ingest, dedup, Gemini triage, coordinator API |
| Dashboard | Next.js 15 + Leaflet | Real-time ranked map, priority queue, acknowledge actions |
| Observability | Grafana Cloud + Prometheus | Mesh health, triage metrics, sync events, latency histograms |

---

## Backend

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/messages/batch` | Gateway phone uploads queued SOS messages (max 50/request) |
| `GET` | `/api/messages` | Coordinator fetches ranked unacknowledged queue |
| `POST` | `/api/messages/{id}/acknowledge` | Coordinator marks a message actioned |
| `GET` | `/metrics` | Prometheus metrics endpoint |
| `GET` | `/health` | Health check |

### Message schema

```json
{
  "message_id": "uuid-v4",
  "body": "Trapped on roof, elderly mother cannot walk, need boat urgently",
  "sender_id": "android-device-id",
  "gps_lat": 22.6517,
  "gps_lng": 88.7795,
  "location_hint": "near Basirhat station Block 4",
  "priority_score": 0.96,
  "priority_tier": "CRITICAL",
  "ttl": 7,
  "hop_count": 3,
  "created_at": "2026-05-22T14:32:00Z",
  "last_hop_at": "2026-05-22T14:34:12Z"
}
```

### Deduplication

Two layers of dedup prevent noise on the coordinator dashboard:

- **Primary** — `ON CONFLICT (message_id) DO NOTHING`. Handles relay loops: same UUID arriving from 5 different gateways simultaneously.
- **Secondary** — SHA-256 of `(sender_id + body + created_at)`. Handles double-tap SOS: victim hits the button twice, two different UUIDs, same content. Lower `hop_count` wins.

### Grafana panels

| Panel | What it shows |
|-------|---------------|
| Active mesh nodes | Unique devices seen in the last 30 minutes |
| Triage distribution | Pie chart of CRITICAL / HIGH / MEDIUM / LOW counts |
| Queue depth over time | Unacknowledged messages — drops = coordinator actioning SOS |
| Gateway sync rate | Upload events per minute — spikes = phones finding signal |
| Hop latency P50/P95 | Seconds from SOS creation to cloud receipt |

---

## Project structure

```
neighbournet/
│
├── .env.example              ← copy to .env, add Supabase + Gemini keys
├── Makefile                  ← make dev / make sync / make sync-bengali
├── requirements.txt
│
├── app/
│   ├── main.py               ← FastAPI app, lifespan, CORS, /health, /metrics
│   ├── models.py             ← Pydantic v2 request/response models
│   ├── metrics.py            ← Prometheus gauges, counters, histogram
│   ├── dedup.py              ← SHA-256 body hash for double-tap SOS
│   │
│   ├── db/
│   │   └── supabase.py       ← Supabase client singleton (service role key)
│   │
│   ├── routes/
│   │   └── messages.py       ← all three API endpoints
│   │
│   └── workers/
│       └── gemini.py         ← Gemini 1.5 Flash triage background task
│
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql   ← messages table, indexes, constraints
│
└── grafana/
    └── dashboards/
        └── neighbournet.json        ← 8 panels, provisioned as code
```

---

## Setup

### Prerequisites

- Python 3.11 or 3.12 (3.14 is not yet supported by all dependencies)
- A [Supabase](https://supabase.com) project (free tier works)
- A [Gemini API key](https://aistudio.google.com/app/apikey) (free tier works)
- A [Grafana Cloud](https://grafana.com/products/cloud/) account (free tier works)

### 1. Clone and install

```bash
git clone https://github.com/your-org/neighbournet
cd neighbournet
pip install -r requirements.txt
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
GEMINI_API_KEY=your-gemini-key
DEMO_MSG_ID=f47ac10b-58cc-4372-a567-0e02b2c3d479
```

> Use the **service role key** from Supabase → Settings → API, not the anon key.

### 3. Run the database migration

1. Go to your Supabase project → **SQL Editor** → **New query**
2. Paste the contents of `supabase/migrations/001_initial_schema.sql`
3. Click **Run**
4. Then run this to enable Realtime:

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
```

### 4. Start the server

```bash
uvicorn app.main:app --reload --port 8000
```

You should see:
```json
{"event": "supabase_connection_ok", ...}
{"event": "neighbournet_backend_started", ...}
```

### 5. Test it

```bash
# Fire a demo CRITICAL SOS
curl -X POST http://localhost:8000/api/messages/batch \
  -H "Content-Type: application/json" \
  -d '{
    "gateway_id": "demo-gateway-001",
    "messages": [{
      "message_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      "body": "Trapped on roof, elderly mother cannot walk, need boat urgently",
      "sender_id": "victim-ratan-001",
      "gps_lat": 22.6517,
      "gps_lng": 88.7795,
      "location_hint": "near Basirhat station Block 4",
      "priority_score": 0.96,
      "priority_tier": "CRITICAL",
      "ttl": 7,
      "hop_count": 3,
      "created_at": "2026-05-22T14:32:00Z",
      "last_hop_at": "2026-05-22T14:34:12Z"
    }]
  }'

# Check the priority queue
curl http://localhost:8000/api/messages

# Verify Prometheus metrics
curl http://localhost:8000/metrics | grep neighbournet
```

---

## Sponsor integrations

| Sponsor | Integration |
|---------|-------------|
| **RunAnywhere** | On-device AI inference — MobileBERT runs on ONNX Runtime Mobile, fully offline. Message content never leaves the device until the user explicitly syncs. |
| **Smolify AI** | Compressed model — MobileBERT fine-tuned on disaster messages, INT8 quantized. ~8 MB, < 200 ms inference on Snapdragon 665. 10–15x smaller than the base model. |
| **Grafana** | Full observability layer — Prometheus `/metrics` endpoint, 8 dashboard panels provisioned as JSON in `/grafana/dashboards/`. |
| **Vercel** | Coordinator dashboard deployed at `neighbournet.vercel.app`. Preview deployments on every PR. |
| **GitHub** | Public repo, clean commit history, MIT license, this README. |

---

## Edge cases handled

| Edge case | Mitigation |
|-----------|------------|
| Routing loop (A→B→A forever) | `seen_ids` set in SQLite + TTL=10 decremented per hop |
| Multiple gateways uploading simultaneously | Idempotent inserts: `ON CONFLICT DO NOTHING` on `message_id` PK |
| Double-tap SOS (same content, two UUIDs) | SHA-256 body hash dedup — lower `hop_count` wins |
| Partial upload (signal lost mid-request) | Backend returns `persisted_ids`; mobile retries only unconfirmed chunks |
| Bengali / mixed-language messages | Gemini prompt includes Bengali keywords; on-device model trained on Bengali examples |
| Clock skew between devices | Sort by `last_hop_at` (gateway timestamp), never `created_at` (device clock) |
| Storage exhaustion on device | Hard cap 500 messages; evict lowest priority first; never drop CRITICAL |
| Android kills background service | Foreground Service with persistent notification + restart on boot receiver |

---

## Acceptance criteria

The system is demo-ready when all of these pass:

- [ ] A message on a phone in airplane mode receives a `CRITICAL` badge within 3 seconds
- [ ] `আমরা আটকে পড়েছি` scores CRITICAL
- [ ] `"safe, checking in"` scores LOW
- [ ] When airplane mode is turned off, the queue uploads within 10 seconds without user action
- [ ] The coordinator dashboard shows the new message within 5 seconds of upload
- [ ] Grafana CRITICAL counter increments within 15 seconds
- [ ] Sending the same SOS twice produces no duplicate on the dashboard

---

## Tech stack

| Layer | Technology |
|-------|------------|
| Mobile UI | React Native (Expo bare workflow) |
| Native mesh | Kotlin + Google Nearby Connections API |
| On-device AI | ONNX Runtime Mobile + MobileBERT INT8 |
| Local storage | expo-sqlite (SQLite) |
| Backend | FastAPI (Python, async) |
| Database | Supabase (Postgres + Realtime) |
| Cloud AI | Gemini 1.5 Flash |
| Dashboard | Next.js 15 + Leaflet + OpenStreetMap |
| Observability | Grafana Cloud + Prometheus |
| Deployment | Vercel (dashboard) + Render (FastAPI) |

---

## License

MIT — built for Bengal, designed for every disaster zone.

*NeighbourNet — Hackathon 2026*








Fix the backend to accept LAN connections — stop the current uvicorn (Ctrl+C) and restart with:


uvicorn main:app --reload --port 8000 --host 0.0.0.0

<!-- ngrok config add-authtoken 3BsxdJuldrTkWCH5LOrdHdC2kZT_23QQi8zwE7KFvitrcSGnk -->
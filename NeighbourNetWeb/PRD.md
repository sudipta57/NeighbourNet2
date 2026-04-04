# NeighbourNet — Disaster Mesh Communication System
> AI-Powered · Offline-First · Edge Intelligence

**Product Requirements Document** | v1.0 | Hackathon 2026

| Field | Details |
|---|---|
| **Team** | NeighbourNet Hackathon Team |
| **Status** | Draft — Hackathon Submission |
| **Track** | Social Impact / Disaster Tech / Edge AI |
| **Sponsors** | Grafana · RunAnywhere · Smolify AI · Vercel · GitHub · Devfolio · MLH |
| **Target Platform** | Android (React Native + Kotlin native module) · Web Dashboard (Next.js 15) |

---

## Priority Tiers

| CRITICAL | HIGH | MEDIUM | LOW |
|---|---|---|---|
| Immediate life threat | Stranded, resources running out | Stable but needs help | Safe / informational |

*Message priority tiers used by the on-device LLM triage engine throughout this document.*

---

## 1. Executive Summary

When cyclones and floods strike Bengal — as Amphan did in 2020 and Yaas in 2021 — cell towers fail within hours, leaving 2–3 million displaced people unable to call for help. NeighbourNet solves this by turning every Android phone into a node in a self-forming, offline mesh network. Messages hop phone-to-phone using Bluetooth and WiFi Direct with zero internet dependency.

The system has three tightly integrated layers:

- **Mesh transport** — Google Nearby Connections API handles peer discovery and data transfer over BT/WiFi Direct automatically.
- **On-device AI triage** — a compressed, quantized LLM (MobileBERT / DistilBERT, ~8 MB) runs entirely on the phone and scores every incoming message CRITICAL / HIGH / MEDIUM / LOW without any network call. This is the RunAnywhere and Smolify AI integration.
- **Cloud sync + coordinator dashboard** — the moment any phone in the mesh regains internet (even a single bar of 4G), it uploads the prioritised queue to a FastAPI backend, which feeds a real-time Next.js dashboard where NDRF coordinators see a ranked, deduplicated situation map powered by Grafana observability metrics.

The result: a relief coordinator can dispatch boats to the highest-priority victims within seconds of a gateway phone reconnecting — even if the victims themselves never had internet during the entire disaster.

---

## 2. Problem Statement

### 2.1 The Core Failure Mode

Cellular infrastructure in Bengal is the first casualty of a severe weather event. During Cyclone Amphan (May 2020), over 1,000 cell towers were damaged or destroyed in 24 hours. People in Basirhat, Gosaba, and Namkhana were unreachable for 48–72 hours — not because they lacked phones, but because there was nothing for their phones to connect to.

Standard emergency protocols (calling 100, SMS to NDRF) all rely on the same failed infrastructure. WhatsApp, Google Maps SOS, and every other consumer app has the same single point of failure: the internet.

### 2.2 What Victims Actually Need

- A way to send an SOS with their location and situation — even a rough one.
- A way for relief workers nearby to receive and act on that SOS.
- A way for coordinators far away to get a clear picture of who needs help most.
- All of the above to work on a phone they already own, with no new hardware.

### 2.3 Why Existing Solutions Fall Short

| Solution | What it does | Why it fails in floods |
|---|---|---|
| Cellular SOS | Calls / SMS to emergency numbers | Needs working cell towers |
| Satellite phones | Works without towers | Expensive, rare, not consumer devices |
| Meshtastic / LoRa | Long-range mesh radio | Requires dedicated hardware dongle |
| **NeighbourNet** | **Phone-to-phone WiFi/BT mesh** | **Works on any Android phone in pocket** |

---

## 3. Goals and Non-Goals

### 3.1 Goals

- Enable phone-to-phone SOS messaging with zero internet dependency.
- Run on any mid-range Android phone (Android 8.0+, no special hardware).
- Triage messages on-device using a compressed LLM — no cloud call needed for scoring.
- Sync intelligently when any node regains internet — prioritised, deduplicated, atomic.
- Give relief coordinators a real-time, ranked situation dashboard (Grafana-backed).
- Win Grafana, RunAnywhere, Smolify AI, Vercel, GitHub, Devfolio, and MLH prizes.

### 3.2 Non-Goals (for this hackathon)

- **iOS support** — MultipeerConnectivity works differently; a future version will add it.
- **End-to-end encryption** — the cryptographic signing design is documented but not implemented in v1.
- **Long-range LoRa mesh** — requires hardware; scoped for a post-hackathon extension.
- **Two-way coordinator-to-victim messaging** — v1 is victim-to-coordinator only.

---

## 4. User Personas

### 🧑‍🌾 Ratan — Victim
62-year-old farmer in Basirhat, trapped on his roof with his elderly mother after flood water rose 6 feet. Has a Redmi 9 (Android 10). No internet. Needs to send his location and medical situation to anyone who can help.

**Needs:** one-tap SOS, template messages in Bengali, GPS-attached location, and the confidence that his message is being forwarded even if no one is immediately nearby.

---

### 👩‍🏫 Priya — Relay Node
28-year-old teacher in the same neighbourhood. NeighbourNet is running in the background as a foreground service. She doesn't need to do anything — her phone automatically receives Ratan's message and forwards it to the next peer it finds.

**Needs:** the app to work silently in the background without draining her battery or requiring her attention during the crisis.

---

### 🦺 Arun — Gateway
35-year-old relief volunteer near the district highway — 2 km from the flood zone — who has one bar of 4G. His phone automatically detects the signal, bulk-uploads the queued mesh messages, and shows him his local peer map.

**Needs:** reliable background sync the moment signal returns, with confirmation of which messages were delivered.

---

### 🖥️ Meera — Coordinator
NDRF district coordinator at the control room in Kolkata. She has full internet and sees the Grafana-backed Next.js dashboard — a map with clustered SOS pins, a priority queue, and AI-generated situation summaries.

**Needs:** clear priority ordering, extracted locations, deduplication, and one-click acknowledgement so her team knows which situations have been actioned.

---

## 5. System Architecture

### 5.1 Component Overview

NeighbourNet has four tightly coupled components. Each is independently testable, which matters for a hackathon where time is short.

| Component | Technology | Responsibility |
|---|---|---|
| Mobile app | React Native + Kotlin module | UI, Nearby Connections, foreground service, SQLite queue |
| On-device LLM | MobileBERT / DistilBERT (ONNX/TFLite, ~8 MB) | Message triage — CRITICAL/HIGH/MEDIUM/LOW — fully offline |
| Backend API | FastAPI + Supabase (Postgres + Realtime) | Ingest, dedup, cloud triage (Gemini Flash), situation reports |
| Coordinator dashboard | Next.js 15 + Leaflet + Grafana | Real-time ranked map, priority queue, Grafana observability |

### 5.2 Message Lifecycle

A message follows this exact path from victim to coordinator:

1. Victim hits SOS on their phone. A UUID, GPS coordinates, timestamp, and message body are created locally.
2. The on-device triage model (MobileBERT, offline) scores the message and assigns a priority tier. No internet needed.
3. The message is written to the local SQLite queue with the priority score, TTL=10, and hop_count=0.
4. Nearby Connections BLE advertisement is detected by a neighbouring phone. The message is forwarded over WiFi Direct or Bluetooth Classic. TTL is decremented; hop_count is incremented.
5. Each relay phone checks its `seen_ids` set. Duplicate UUIDs are silently dropped. Non-duplicates are scored again by the local triage model (confirming or adjusting priority) and re-queued.
6. When any phone detects internet connectivity, it becomes a gateway. It uploads the full queue to `POST /api/messages/batch` in a single atomic call.
7. The backend deduplicates by UUID (`ON CONFLICT DO NOTHING` in Supabase), runs Gemini Flash for cloud-quality triage on the batch, and writes the results to Postgres.
8. Supabase Realtime pushes the update to the coordinator dashboard instantly. Grafana metrics update within 10 seconds.
9. The gateway phone receives confirmation of successfully persisted UUIDs and marks them `synced=true` in SQLite. Only un-synced messages are retried on the next connection.

---

## 6. Feature Specifications

### 6.1 Mobile App — Mesh Transport

#### 6.1.1 Peer Discovery and Connection

The app uses Google Nearby Connections API in `STRATEGY_CLUSTER` mode — each device advertises and discovers simultaneously. BLE handles discovery; the API automatically promotes to WiFi Direct when higher bandwidth is needed. The foreground service keeps this running even when the screen is off.

- Advertising and discovery run continuously when app is active.
- Connection established within 3–5 seconds of two phones coming within range.
- Range: 30–100 m over Bluetooth, up to 250 m in open areas over WiFi Direct. Design for 50–80 m as the reliable baseline in flood conditions (rain, obstacles, metal roofs).
- **Adaptive scan backoff:** if no peers found for 5 minutes, scan interval increases from 2 s to 30 s to conserve battery.

#### 6.1.2 Message Forwarding Protocol

| Field | Description |
|---|---|
| `message_id` | UUID v4, generated on originating device. Primary dedup key. |
| `body` | Message text — Bengali, English, or mixed. Max 500 characters. |
| `sender_id` | Persistent device UUID (stored in Android ANDROID_ID, survives reinstall). |
| `gps_lat` / `gps_lng` | Last known GPS. Falls back to last-known-location if current fix unavailable. |
| `location_hint` | Optional text: 'near Basirhat station, Block 4'. Used when GPS is poor. |
| `priority_score` | Float 0.0–1.0 assigned by on-device LLM. 1.0 = CRITICAL. |
| `priority_tier` | CRITICAL / HIGH / MEDIUM / LOW. Derived from priority_score thresholds. |
| `ttl` | Starts at 10. Decremented each hop. Message dropped when TTL = 0. |
| `hop_count` | Total hops traversed. Used for analytics and dedup confidence scoring. |
| `created_at` | Originating device timestamp (ISO 8601). May have clock skew — see edge cases. |
| `last_hop_at` | Timestamp added by each relaying device. Most recent = authoritative time. |
| `synced` | Boolean. True once backend confirms persistence. Gateway tracks this in SQLite. |

---

### 6.2 On-Device LLM Triage (RunAnywhere + Smolify AI)

> **RunAnywhere Prize target:** On-device AI inference — the triage model runs entirely on the phone using ONNX Runtime Mobile. No internet required for scoring. Privacy-first: message content never leaves the device until the user explicitly syncs.

> **Smolify AI Prize target:** Compressed model — MobileBERT or DistilBERT fine-tuned on emergency/disaster messages, quantized to INT8, exported to ONNX. Total model size target: under 10 MB. Runs in under 200 ms on a mid-range Snapdragon 665.

#### 6.2.1 Model Design

The on-device model is a text classification model with four output classes corresponding to the four priority tiers. It is trained on a synthetic dataset of emergency messages in English, Bengali, and Bangla-English transliterated text.

- **Base model:** MobileBERT (25 MB pre-quantization) or DistilBERT (67 MB pre-quantization).
- **Quantization:** INT8 post-training quantization using ONNX Runtime's `quantize_dynamic()`.
- **Target size:** < 10 MB quantized. Target inference latency: < 200 ms on Snapdragon 665.
- **Training data:** synthetic messages covering — trapped victims, medical emergencies, resource requests, safe status updates, volunteer offers. Bengali example: 'আমরা আটকা পড়েছি' scores CRITICAL.
- **Output:** softmax probability over 4 classes. Priority score = P(CRITICAL) + 0.7×P(HIGH).

#### 6.2.2 Priority Tier Thresholds

| Tier | Score range | Trigger examples | Action |
|---|---|---|---|
| **CRITICAL** | 0.85 – 1.0 | Trapped, unconscious, medical emergency, child, elderly cannot move | First uploaded, first on dashboard. 🔴 Red pin on map. |
| **HIGH** | 0.65 – 0.85 | Family stranded, food/water < 24h, rising water | Second priority. 🟠 Orange pin. |
| **MEDIUM** | 0.40 – 0.65 | Stranded but stable, need supplies within 48h | Third priority. 🩵 Teal pin. |
| **LOW** | 0.00 – 0.40 | Safe, checking in, offering help | Last priority. ⚫ Gray pin. |

---

### 6.3 Gateway Sync and Backend

#### 6.3.1 Internet Detection and Upload

- The app registers a `NetworkCallback` (Android ConnectivityManager). On any network becoming available, the gateway sync service is triggered immediately.
- Upload endpoint: `POST /api/messages/batch`. Payload: array of un-sync'd messages sorted by `priority_score` descending.
- Chunked upload: 50 messages per HTTP request. On partial failure, only failed chunks are retried.
- On success, the backend returns a list of persisted UUIDs. The app marks these `synced=true` and removes them from the active queue on next cleanup pass.

#### 6.3.2 Backend Deduplication

- Supabase `messages` table has `message_id` as `PRIMARY KEY` with `ON CONFLICT DO NOTHING`.
- Secondary dedup: SHA-256 hash of `(sender_id + body_text + created_at)`. Messages with identical hashes are merged even if UUIDs differ (handles double-tap SOS).
- Multiple gateway phones uploading simultaneously are safe — idempotent inserts.

#### 6.3.3 Cloud Triage (Gemini Flash)

After deduplication, a background worker runs Gemini 1.5 Flash on each new message batch to produce cloud-quality triage, location extraction, and a situation summary for coordinators. The on-device triage score is used as a pre-sort; Gemini refines it. The prompt explicitly handles Bengali, English, and mixed-language input.

---

### 6.4 Coordinator Dashboard (Next.js 15 + Grafana)

> **Grafana Prize target:** Full observability layer: mesh health metrics (active nodes, peer counts, queue depth), triage breakdown panels (CRITICAL/HIGH/MEDIUM/LOW over time), gateway sync events, and message latency histograms — all pushed from FastAPI via Prometheus endpoint to Grafana Cloud free tier.

#### 6.4.1 Dashboard Features

- **Real-time map** (Leaflet + OpenStreetMap, offline tiles cached): SOS pins clustered and colour-coded by priority tier.
- **Priority queue panel:** ranked list of all unacknowledged messages. One-click acknowledge marks message as actioned in Supabase.
- **Situation report:** AI-generated natural language summary of the current situation — updated every time a new batch arrives.
- **Mesh status panel:** how many nodes are active, when the last sync occurred, which gateways are online.
- **Supabase Realtime:** dashboard updates within 1–2 seconds of a gateway upload — no polling.

#### 6.4.2 Grafana Panels

| Panel name | Metric source | What it shows |
|---|---|---|
| Active mesh nodes | FastAPI `/metrics` (Prometheus) | Count of unique sender_ids seen in last 30 min |
| Triage distribution | Supabase query | Pie/bar of CRITICAL/HIGH/MEDIUM/LOW counts |
| Queue depth over time | FastAPI `/metrics` | Un-sync'd messages per gateway node, time-series |
| Gateway sync events | FastAPI `/metrics` | Bar chart of upload events; number of messages per event |
| Message hop latency | Calculated field: `last_hop_at - created_at` | P50/P95 latency from SOS creation to cloud arrival |
| Acknowledged vs pending | Supabase | Stacked bar: how many CRITICAL messages have been actioned |

---

## 7. Edge Case Handling

These are the failure modes that will kill the product in real use. Each has a designed mitigation, not a hope.

| Edge case | Risk | Mitigation |
|---|---|---|
| Routing loop | Message bounces A→B→A forever | `seen_ids` set in SQLite + TTL=10 decremented per hop. Drop at TTL=0. |
| Storage exhaustion | Queue fills phone storage | Hard cap 500 messages. Evict lowest priority first. Never drop CRITICAL. |
| Battery drain | BT+WiFi scanning kills battery in 4–6 h | Adaptive backoff (2 s → 30 s scan). BLE-only low power mode toggle. |
| Android kills background process | OS terminates mesh service | Foreground Service with persistent notification. Restart on boot receiver. |
| Clock skew between devices | Wrong timestamps, bad ordering | Never sort by device clock alone. Use `last_hop_at` from gateway as canonical time. |
| Duplicate SOS from same victim | Noise for coordinator | SHA-256 body hash dedup on backend. On-device `seen_ids` prevents relay loops. |
| Multiple gateways uploading simultaneously | Backend receives same messages 5x | Idempotent inserts: `ON CONFLICT DO NOTHING` on `message_id` primary key. |
| Partial upload (signal lost mid-upload) | Messages lost or double-counted | Backend returns list of persisted UUIDs. App retries only non-confirmed chunks. |
| Bengali/mixed language messages | LLM misses urgency keywords | Model trained on Bengali + transliterated Bengali examples. Gemini Flash explicitly prompted for multilingual input. |
| GPS unavailable / inaccurate | Victim cannot be located | Cache last known location. Prompt for text landmark. Cache OSM tiles at install time. |
| Mesh partition (two isolated groups) | SOS never reaches gateway | Document 'relay runner' protocol: person physically carrying messages between zones. Shown in onboarding. |
| Message spoofing / false SOS | Bad actors flood coordinator | v1: none (hackathon scope). Designed: device keypair, message signing, unsigned messages flagged LOW confidence by triage model. |
| Device identity lost on reinstall | Old messages become orphaned | Store device UUID in Android ANDROID_ID, not app storage. Survives uninstall. |

---

## 8. Sponsor Integrations

Each sponsor integration is a first-class feature, not an afterthought.

### 8.1 RunAnywhere — On-Device AI Inference

**Prize target:** On-device AI, mobile/edge inference, privacy-first.

- **Implementation:** ONNX Runtime Mobile integrated into the React Native app via a Kotlin native module. The MobileBERT model runs on the CPU of any Android 8.0+ device.
- **Privacy guarantee:** message text is never transmitted for triage. Scoring is entirely local. Only after the user initiates sync does any data leave the device.
- **Demo moment:** turn on airplane mode, send an SOS — the priority badge appears instantly. Zero network activity in Charles Proxy / network monitor.
- **Fallback:** if ONNX Runtime fails (old device, insufficient RAM), a deterministic keyword scorer (regex-based) takes over. The LLM is the primary path; the keyword scorer is the safety net.

### 8.2 Smolify AI — Compressed Model

**Prize target:** Compressed/small AI models running efficiently on edge devices.

- **Model:** MobileBERT fine-tuned on disaster message classification, then INT8 quantized with ONNX Runtime's `quantize_dynamic()`. Final model size: ~6–10 MB.
- **Why this is genuinely compressed:** base MobileBERT is 100 MB+. The quantized fine-tuned version is 10–15x smaller, with less than 3% accuracy drop on the eval set.
- **Benchmark:** inference time on Redmi 9 (Snapdragon 665, 4GB RAM) < 200 ms per message. Memory footprint < 50 MB during inference.
- **Synthetic training data:** 5,000 messages generated across four classes — English, pure Bengali, and transliterated Bengali. Balanced classes, with deliberate hard negatives (e.g. 'water in the pot is boiling' must not score CRITICAL).

### 8.3 Grafana — Observability Dashboard

**Prize target:** Monitoring, observability dashboards.

- FastAPI exposes a `/metrics` Prometheus endpoint using `prometheus-fastapi-instrumentator`.
- Custom gauges: `neighbournet_active_nodes`, `neighbournet_queue_depth_total`, `neighbournet_sync_events_total`, `neighbournet_triage_critical_total` (and HIGH, MEDIUM, LOW variants).
- Grafana Cloud free tier: dashboards provisioned as JSON and checked into the GitHub repo (Infrastructure as Code).
- **Demo moment:** simulate a sync event during the presentation — the Grafana panel updates live within 10 seconds. Show the triage distribution pie chart shifting as CRITICAL messages arrive.

### 8.4 Vercel, GitHub, Devfolio, and MLH

- **Vercel:** coordinator dashboard deployed at `neighbournet.vercel.app`. Preview deployments for every PR.
- **GitHub:** public repository with full commit history, `ARCHITECTURE.md`, a demo GIF in the README, and an MIT license. README mentions Amphan and Yaas by name.
- **Devfolio:** write-up leads with '2.9 million displaced in Amphan; towers down for 72 hours.' Quantified impact. Social impact track.
- **MLH:** Best use of GitHub (clean repo history + README) + Most Creative Use of AI (on-device LLM triage in a disaster context).

---

## 9. Full Technology Stack

| Layer | Technology | Notes |
|---|---|---|
| Mobile UI | React Native (Expo bare workflow) | Cross-platform UI, easier to iterate fast in hackathon |
| Native BT/WiFi | Kotlin module + Nearby Connections API | Wraps Google's P2P mesh; handles BT and WiFi Direct auto-selection |
| On-device AI | ONNX Runtime Mobile + MobileBERT | INT8 quantized, < 10 MB, < 200 ms inference, fully offline |
| State management | Zustand | Lightweight, works well with RN, no boilerplate |
| Local storage | expo-sqlite (SQLite) | Message queue, seen_ids set, sync state |
| Device identity | Android ANDROID_ID | Persistent across reinstalls |
| Backend framework | FastAPI (Python) | Fast to build, async-native |
| Cloud database | Supabase (Postgres) | Realtime subscriptions, free tier, easy schema migrations |
| Cloud AI triage | Gemini 1.5 Flash | Free tier, multilingual, fast — used for cloud-quality re-scoring |
| Dashboard | Next.js 15 (App Router) | Vercel deploy |
| Map | Leaflet + OpenStreetMap | OSM tiles cached offline for affected areas at install time |
| Observability | Grafana Cloud + Prometheus | Sponsor integration; dashboards as JSON in repo |
| Deployment | Vercel (dashboard) + Render (FastAPI) | Both have free tiers; Vercel is sponsor |

---

## 10. Hackathon Development Plan

Ordered strictly by demo impact — what must be working to win, built first.

| Phase | What to build | Why first | Est. time |
|---|---|---|---|
| 1 | Coordinator dashboard + AI triage backend | Always demoable — no phones needed. Shows the most impressive output. | 3–4 h |
| 2 | Grafana integration | 2 h to wire up Prometheus endpoint. Very high prize ROI, low competition. | 2 h |
| 3 | On-device LLM — ONNX inference module | Core technical innovation. RunAnywhere + Smolify prizes. Needs time. | 4–5 h |
| 4 | Mobile app — SOS screen + SQLite queue | Without this, no end-to-end story. Build SOS UI + local storage first. | 3 h |
| 5 | Nearby Connections mesh (BT/WiFi Direct) | The hardest piece. Build last — if it breaks, you still have a strong demo. | 4–5 h |
| 6 | Gateway sync service | Connects mobile to backend. Fairly simple given the protocol is designed. | 2 h |
| 7 | README, demo GIF, Devfolio write-up | Non-negotiable for GitHub + MLH + Devfolio prizes. | 1 h |

### 10.1 Demo Script (90 seconds on stage)

Practice this exact sequence. Every line maps to something visible on screen.

1. *"Cyclone Amphan, 2020. 2.9 million displaced. Towers down for 72 hours."* (2 sentences, no slides)
2. Open NeighbourNet on phone. Show the peer count: '2 peers nearby'. No internet indicator.
3. Tap SOS. Select template: 'Trapped, need boat'. Show **CRITICAL** badge appear instantly — on-device LLM, airplane mode still on.
4. Switch to laptop. Show the coordinator dashboard. The SOS just arrived via simulated gateway sync.
5. Point to the Grafana panel live in the corner: CRITICAL count just went from 0 to 1.
6. Show the ranked priority queue: Ratan's message is at the top, red, with extracted location and AI summary.
7. *"Every phone in a disaster zone is now a relay. Every bar of signal is a lifeline."*

### 10.2 Simulating the Mesh for Demo

Real Bluetooth mesh is hard to demo on stage. Use this strategy: two Android phones physically nearby run the app. Simulate a third 'gateway' phone by triggering the sync endpoint directly via a `curl` command hidden in a `Makefile`. The coordinator dashboard updates live. Judges see the full end-to-end story without needing 5 phones in a room.

---

## 11. Acceptance Criteria

The product is demo-ready when **all** of the following pass:

- [ ] A message sent on a phone in airplane mode receives a priority badge within 3 seconds (on-device LLM).
- [ ] The badge is **CRITICAL** for *'trapped, elderly mother cannot walk, need boat'* and **LOW** for *'safe, checking in'*.
- [ ] Bengali input `'আমরা আটকে গেছি'` scores CRITICAL.
- [ ] When airplane mode is turned off, the queue uploads within 10 seconds without user action.
- [ ] The coordinator dashboard shows the new message within 5 seconds of upload.
- [ ] Grafana panel reflects the CRITICAL count increment within 15 seconds.
- [ ] Sending the same SOS twice does not create duplicate entries on the dashboard.
- [ ] The app runs in the background for 2+ hours on a Redmi device without being killed.
- [ ] The GitHub repo is public with a README that includes a demo GIF and the problem statement.
- [ ] The Vercel deploy URL is live and the dashboard loads on mobile browser.

---

## 12. Risks and Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Nearby Connections BT unstable on specific devices | 🔴 High | Test on two physical Android devices early. Have WiFi-only fallback mode. |
| ONNX model accuracy too low on Bengali | 🔴 High | Include Gemini Flash as cloud fallback. On-device is the prize demo; cloud is the safety net. |
| Android kills foreground service during demo | 🔴 High | Test on the specific demo device 24 hours before presentation. Add battery optimisation exemption in onboarding. |
| Grafana Cloud free tier rate limits | 🟠 Medium | Pre-load dashboard with historical data. Show screenshots if live metrics lag. |
| Not enough time to implement mesh | 🟠 Medium | Phases 1–3 are strong enough to win without real BT mesh. Simulate the mesh for demo (see §10.2). |
| Gemini API key rate limit during demo | 🟡 Low | Cache a pre-run triage result for the demo SOS message. Show real API call for non-demo messages. |

---

*NeighbourNet — Built for Bengal, designed for every disaster zone.*

**Hackathon 2026 | v1.0 | Open-source under MIT License**

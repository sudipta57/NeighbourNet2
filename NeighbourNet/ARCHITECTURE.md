# NeighbourNet — Architecture Overview

## What This App Does
NeighbourNet is built for Bengal flood and cyclone scenarios where cellular towers fail, power is unstable, and people need a way to call for help without internet. A victim can press SOS on one phone, the alert moves phone-to-phone through a local mesh, and the first device with connectivity acts as a gateway that uploads the message to coordinators and response teams.

The same architecture also supports concerts and other dense public events where friends may lose connectivity but still need to find one another. In that mode, phones use peer-to-peer mesh chat and live location sharing so people can communicate, share a pin, and reconnect without relying on mobile data or WiFi infrastructure.

## Use Cases

### Mesh Message Transfer

**Primary — Natural Disaster Response**
When cyclones and floods strike Bengal, cellular towers fail within 
hours, leaving millions of displaced people unable to call for help. 
NeighbourNet turns every Android phone into a relay node — a victim 
taps SOS, the message hops phone-to-phone across the affected area, 
and the moment any device finds a bar of signal it uploads the entire 
prioritised queue to NDRF coordinators. No tower, no internet, and 
no special hardware is required at any point in that chain.

**Alternative — Coal Mining and Underground Operations**
Underground coal mines have no radio coverage and no cellular signal 
by nature of their depth and rock composition. If a collapse, gas 
leak, or injury occurs, miners cannot reach the surface to report it. 
A mesh network running between miners' devices can carry emergency 
alerts from deep inside the mine to a surface gateway phone, which 
then contacts rescue teams. The TTL-based forwarding and SQLite 
queue mean messages survive intermittent relay gaps as miners move 
between tunnels.

**Alternative — Mountain Trekking and Remote Expeditions**
Trekkers in the Himalayas, Sikkim, or Ladakh routinely lose cellular 
coverage for days at a time. If a member of a group is injured or 
separated, their SOS can hop between trekking parties across ridges 
and campsites until it reaches a guide, a village, or a high point 
with satellite or cellular signal. Every trekker's phone in the 
region becomes a passive relay node without any action on their part.

### Mesh Chat with Location Sharing

**Primary — Concerts and Crowded Events**
At a large music festival or stadium event, cellular networks become 
so congested that messages fail to deliver even when signal bars 
appear full. NeighbourNet's mesh chat works entirely over Bluetooth 
and WiFi Direct, bypassing the congested network completely. Two 
friends exchange their four-digit friend codes before entry — at the 
venue, they chat over the mesh and share live GPS location pins so 
they can physically navigate to each other. If a child is separated 
from their family inside the crowd, a parent can broadcast a message 
over the mesh and any nearby phone running the app will relay it — 
the child does not even need to be a saved contact for the message 
to propagate.

**Alternative — Any Location Without Internet Infrastructure**
Remote ashrams, forest campsites, island retreats, border villages, 
and deep-interior research stations all share a common problem — 
people gather there but internet does not reach. NeighbourNet's mesh 
chat lets any group of people in such a location communicate with 
each other as naturally as they would on WhatsApp, with full message 
history stored locally and GPS location sharing available on demand. 
One person with a question, an announcement, or an emergency can 
reach everyone in the group simultaneously through the mesh without 
any infrastructure beyond the phones already in their pockets.

## Core Features

### 1. Offline P2P Mesh Network
What it does: phones discover each other and form a self-healing mesh network using Bluetooth and WiFi Direct. Messages hop from phone to phone with no internet required.

| Technology | What it does | Why chosen |
|---|---|---|
| Google Nearby Connections API | Handles peer discovery, connection negotiation, and data transfer over BLE and WiFi Direct automatically | Abstracts the complexity of raw Bluetooth and WiFi Direct. It handles medium selection, connection upgrades, and reconnection automatically, so no custom BLE stack is needed. |
| Strategy.P2P_CLUSTER | Every device advertises and discovers simultaneously | Best fit for a mesh topology where every node is equal, with no central hub and no single point of failure. |
| Foreground Service + Boot Receiver | Keeps the mesh running when screen is off, restarts on device reboot | Android aggressively kills background processes, so a foreground service with a persistent notification prevents this. |
| TTL + seen_ids deduplication | Each message carries a TTL counter decremented per hop. Seen message IDs are stored in memory | Prevents routing loops where the same message bounces between devices forever. |
| SQLite message queue | All messages stored locally before forwarding | Survives app restarts, enables retry, and provides a persistent store for unsynced messages. |

### 2. AI-Powered SOS Triage
What it does: every incoming SOS message is automatically scored CRITICAL / HIGH / MEDIUM / LOW on the device itself, with no internet or cloud call required.

| Technology | What it does | Why chosen |
|---|---|---|
| paraphrase-multilingual-MiniLM-L12-v2 | Multilingual sentence-transformer model that converts text into 384-dimensional semantic embedding vectors | Pre-trained on more than 50 languages including Bengali, so it works on Bengali, English, and mixed input without transliteration or translation. |
| Zero-shot cosine similarity | Message embedding is compared against four pre-computed anchor vectors, one per priority tier. Highest similarity determines the tier | No training data or fine-tuning is required, and accuracy improves simply by editing anchor sentences. It is ready in hours, not days. |
| INT8 ONNX quantization | Model exported from PyTorch to ONNX format then quantized to 8-bit integers | Reduces model size from 120MB to 32MB, a 3.75x compression, with less than 2% accuracy drop. It runs under 100ms on a mid-range Snapdragon 665. |
| Keyword fallback scorer | Regex-based priority detection when ONNX runtime is unavailable | Ensures triage never fails completely, so every message gets a priority even on very old devices. |
| Priority score formula: cosine_sim(CRITICAL) + 0.7 × cosine_sim(HIGH) | Weighted combination of two highest-risk similarity scores | Gives partial credit for messages that are serious but not immediately life-threatening. |

### 3. Gateway Sync — Offline to Online Handoff
What it does: the moment any phone in the mesh detects internet connectivity, it automatically uploads the entire prioritised message queue to the cloud backend without any user action.

| Technology | What it does | Why chosen |
|---|---|---|
| Android ConnectivityManager NetworkCallback | Detects the exact moment any network interface becomes available | Event-driven, so there is no polling and no battery waste. It fires immediately when signal appears. |
| FastAPI backend on Render | Receives batch message uploads via POST /api/messages/batch | Async Python is easy to deploy on the free tier and handles concurrent gateway uploads safely. |
| Supabase (PostgreSQL) | Stores all messages with UUID primary key and ON CONFLICT DO NOTHING deduplication | Multiple gateways uploading the same message simultaneously is safe because inserts are idempotent. |
| Chunked upload (50 messages per request) | Queue is split into chunks and uploaded sequentially | Partial failures only retry failed chunks, and successfully uploaded messages are never re-sent. |
| Gemini 1.5 Flash (cloud triage) | Re-scores messages after upload with full cloud-quality NLP | On-device triage is fast but approximate, so Gemini refines priority and extracts structured location data for coordinators. |
| Supabase Realtime | Pushes new messages to coordinator dashboard instantly | No polling is needed, so the dashboard updates within 1-2 seconds of a gateway upload. |

### 4. Peer-to-Peer Mesh Chat with Location Sharing
What it does: two people at a concert or disaster zone can chat directly through the mesh with no internet. Either person can share their live GPS location which appears as an interactive map in the chat thread.

| Technology | What it does | Why chosen |
|---|---|---|
| Friend Code system | Each device generates a deterministic 4-digit numeric code from its UUID | Human-readable and easy to share verbally or via SMS before going offline, with no account or server required. |
| Identity beacon broadcast | App broadcasts a small beacon packet every 15 seconds carrying the device's friend code and UUID | Allows friends added by code to be automatically identified and linked when they come into mesh range, with no manual pairing step. |
| Direct message routing | Chat messages carry a destination_id field, and relay nodes forward without reading content if destination_id does not match their own UUID | Enables private 1-to-1 conversation over a shared broadcast mesh without a central router. |
| SQLite chat history | All chat messages stored locally per thread | Full conversation history survives app restarts and offline periods. |
| expo-location | Gets device GPS coordinates when user taps the share location button | Works entirely via satellite, so no internet is required for a GPS fix. |
| OpenStreetMap via WebView + Leaflet.js | Renders an interactive map tile view inside the chat bubble showing the shared location pin | No API key is required, there is no Google Maps billing, and the tile data is open source. |
| Zustand global state | Incoming mesh messages update the UI reactively regardless of which screen is active | Lightweight state management avoids prop drilling across deep component trees. |

## Why Offline-First Architecture
Cellular infrastructure is often the first thing to fail in a disaster because towers are physical assets exposed to flood, wind, and debris. Even when the tower itself survives, local power loss can cascade into backhaul outages and battery depletion, which takes the network down at the exact moment people need it most.

Traditional apps fail for the same reason: WhatsApp, Google SOS, and 112 all depend on the same mobile network and internet layer that has already collapsed. If the base layer is gone, the app can still open, but it cannot deliver the message to anyone who can act on it.

NeighbourNet avoids that dependency by making every phone a node in the network. There is no single point of failure, and the system degrades gracefully as devices leave the mesh because any remaining phone can still relay, store, and eventually upload the message.

## Sponsor Technology Integrations

| Sponsor | Technology Used | Where in the App |
|---|---|---|
| RunAnywhere | ONNX Runtime Mobile for on-device AI inference | Message triage runs entirely on the phone CPU with no cloud call for scoring. Demo flow: turn on airplane mode, send SOS, and the badge appears instantly. |
| Smolify AI | INT8 quantized ONNX model, 120MB down to 32MB | paraphrase-multilingual-MiniLM-L12-v2 is compressed 3.75x and runs under 100ms on Snapdragon 665. |
| Grafana | Prometheus metrics endpoint plus Grafana Cloud dashboards | Tracks active mesh nodes, triage distribution, gateway sync rate, and message hop latency P50/P95. |
| Vercel | Coordinator dashboard deployment | Next.js 15 dashboard at neighbournet.vercel.app provides a real-time SOS map for NDRF coordinators. |
| GitHub | Full public repository with commit history | Hosts the MIT-licensed codebase, this architecture document, and the demo GIF in the README. |

## Data Flow — SOS Message Lifecycle
1. Victim taps SOS on their phone with no internet connection.
2. The message gets a UUID, GPS coordinates, and a timestamp.
3. The on-device triage model scores it CRITICAL, HIGH, MEDIUM, or LOW in under 100ms.
4. The message is written to the SQLite queue with TTL=10 and synced=false.
5. A nearby Connections BLE advertisement is detected by a neighbouring phone.
6. The message is forwarded over WiFi Direct or Bluetooth Classic.
7. Each relay phone checks seen_ids, and duplicates are silently dropped.
8. Non-duplicates are re-queued and re-forwarded, with TTL decremented.
9. A phone with internet is detected by NetworkCallback.
10. The full queue is uploaded to the FastAPI backend sorted by priority_score.
11. The backend deduplicates by UUID and runs Gemini Flash re-triage.
12. Supabase Realtime pushes the update to the coordinator dashboard.
13. The coordinator sees a ranked SOS map with CRITICAL messages at the top.
14. The backend returns persisted UUIDs, and the app marks them synced=true.

## Edge Cases and Mitigations

| Edge Case | Mitigation |
|---|---|
| Routing loop (A→B→A forever) | seen_ids set in SQLite plus TTL=10 decremented per hop. The message is dropped at TTL=0. |
| Android kills background mesh service | Foreground Service with persistent notification plus Boot Receiver restarts on device reboot. |
| Multiple gateways uploading simultaneously | Idempotent inserts with ON CONFLICT DO NOTHING on the message_id primary key in Supabase. |
| Partial upload (signal lost mid-request) | Backend returns list of persisted UUIDs, and the app retries only unconfirmed chunks. |
| Bengali and mixed-language messages | Model is pre-trained natively on Bengali, and anchor sentences include Bengali examples. Gemini Flash is explicitly prompted for multilingual input. |
| GPS unavailable indoors | Last known location is cached, and the user is prompted for a text landmark as fallback. |
| Storage exhaustion | Hard cap of 500 messages. Lowest priority is evicted first, and CRITICAL messages are never dropped. |
| Friend UUID unknown at chat time | Identity beacon broadcast every 15 seconds auto-links friend code to real device UUID when in range, with broadcast fallback used until UUID is confirmed. |
| Clock skew between devices | Sort by last_hop_at, which uses the gateway timestamp, not created_at, which depends on an unreliable device clock. |
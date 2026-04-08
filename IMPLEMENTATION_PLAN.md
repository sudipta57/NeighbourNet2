# NeighbourNet — Implementation Plan
> Phased roadmap from hackathon prototype to SaaS launch.
> Based on codebase audit completed 2026-04-08.
> Read CODEBASE_CONTEXT.md first for current implementation status.

---

## Phase 0 — Stabilise the Prototype
**Goal:** Make the current build reliable for demos and internal testing. No new features — only fix things that are broken or misleading.

---

### 0.1 Fix the `mesh_telemetry` Supabase table
**Why:** `telemetryReporter.ts` fires every 5 seconds but the table doesn't exist. Every call fails silently. The mesh visualization page in the dashboard shows no real data, making the mesh graph look broken during demos.
**Effort:** S
**Dependencies:** Supabase project access

**Tasks:**
- Add `002_mesh_telemetry.sql` to `NeighbourNetAPI/supabase/migrations/`
```sql
CREATE TABLE IF NOT EXISTS mesh_telemetry (
  device_id     TEXT        PRIMARY KEY,
  mascot        TEXT,
  role          TEXT        CHECK (role IN ('gateway', 'relay', 'offline')),
  peer_ids      TEXT[],
  hop_count     INT         NOT NULL DEFAULT 0,
  conn_type     TEXT        CHECK (conn_type IN ('bluetooth', 'wifi_direct', 'both')),
  is_origin     BOOLEAN     NOT NULL DEFAULT FALSE,
  last_seen     TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mesh_telemetry_last_seen ON mesh_telemetry (last_seen DESC);
ALTER PUBLICATION supabase_realtime ADD TABLE mesh_telemetry;
```
- Run the migration: `supabase db push` or via Supabase SQL editor
- Verify `telemetryReporter.ts` upserts succeed without warnings in logs

---

### 0.2 Fix the active nodes Prometheus metric
**Why:** In `app/routes/messages.py:258–268`, the 30-minute filter uses `now.replace(second=0)` instead of `now - timedelta(minutes=30)`. The gauge always reflects only the current minute's messages.
**Effort:** S
**Dependencies:** None

**Task:**
- Edit `NeighbourNetAPI/app/routes/messages.py:~255`
```python
# BEFORE (broken):
.gte("last_hop_at", datetime.now(tz=timezone.utc).replace(second=0, microsecond=0).isoformat())

# AFTER (correct):
from datetime import timedelta
thirty_min_ago = (datetime.now(tz=timezone.utc) - timedelta(minutes=30)).isoformat()
.gte("last_hop_at", thirty_min_ago)
```
- Verify gauge reports correctly after a sync event

---

### 0.3 Enable Supabase Realtime on `messages` table
**Why:** The dashboard's Supabase Realtime subscription receives no events unless `ALTER PUBLICATION supabase_realtime ADD TABLE messages` has been run. This is documented in a SQL comment but not automated.
**Effort:** S
**Dependencies:** Supabase project access

**Task:**
- Add to migration `001_initial_schema.sql` (or create `003_enable_realtime.sql`) with the `ALTER PUBLICATION` statement, or document it explicitly in the deployment runbook
- Confirm dashboard receives real-time INSERT events after a gateway sync

---

### 0.4 Remove hardcoded demo `sender_id`
**Why:** Every SOS from every device has `sender_id = 'neighbournet-demo-user'`. The backend treats all devices as one node. Active nodes will never exceed 1.
**Effort:** S
**Dependencies:** `src/device/identity.ts` or `src/db/database.ts` (device UUID already stored in secure store)

**Task:**
- In `SosScreen.tsx:31`, replace `HARD_CODED_USER_ID` with the device UUID from the store:
```typescript
// Before:
const HARD_CODED_USER_ID = 'neighbournet-demo-user'

// After: use deviceId from Zustand store (already loaded in App.tsx)
const deviceId = useAppStore((state) => state.deviceId) ?? 'unknown-device'
```
- Ensure `deviceId` is always populated before SosScreen renders (App.tsx already calls `getDeviceUUID` during init and stores it in `useAppStore`)

---

### 0.5 Add `ngrok-skip-browser-warning` header removal (cleanup)
**Why:** `gatewaySync.ts:173` sends `'ngrok-skip-browser-warning': 'true'` header. This is a dev artifact that should not be in the production gateway sync path. It's harmless but indicates leftover debug config.
**Effort:** XS
**Dependencies:** None

**Task:**
- Remove the `'ngrok-skip-browser-warning': 'true'` header from the fetch call in `gatewaySync.ts`, or gate it on `__DEV__`

---

### 0.6 Fix CORS wildcard before demo
**Why:** `app/main.py` includes `"*"` in `allow_origins`. This allows any website to make credentialed requests to the API.
**Effort:** S
**Dependencies:** Know final deployment URLs

**Task:**
- Replace `"*"` with explicit list:
```python
allow_origins=[
    "https://neighbournet.vercel.app",
    "http://localhost:3000",
    "http://localhost:3001",
],
```
- Test that dashboard still works and mobile sync (non-browser) is unaffected

---

## Phase 1 — SaaS Foundation
**Goal:** Transform the prototype into a multi-tenant, authenticated SaaS product. This phase unlocks paying customers.

---

### 1.1 Implement API authentication
**Why:** All three API endpoints are fully open. Anyone can POST fake SOS messages, read coordinator queues, or acknowledge messages.
**Effort:** M
**Dependencies:** Decide auth strategy (API keys for mobile, JWT/OAuth for dashboard)

**Recommended approach — two-tier auth:**
1. **Mobile gateway → API:** Static per-organisation API key in `Authorization: Bearer <key>` header. Validated against a `gateway_keys` table in Supabase.
2. **Dashboard → API:** Supabase JWT (Supabase Auth). Dashboard login with email/password or SSO.

**Tasks:**
- Add `gateway_keys` table to Supabase (org_id, key_hash, created_at, revoked_at)
- Add API key middleware to FastAPI (`app/middleware/auth.py`)
- Add `Authorization` header to `gatewaySync.ts` fetch calls
- Integrate Supabase Auth into the Next.js dashboard (`@supabase/auth-helpers-nextjs`)
- Add login page to dashboard (`app/login/page.tsx`)
- Apply RLS (Row Level Security) to Supabase `messages` table per org_id

---

### 1.2 Add multi-tenancy (organisation model)
**Why:** Currently all data is in one shared Supabase table. One NGO's SOS messages are accessible to any other API client.
**Effort:** L
**Dependencies:** 1.1 (auth must exist first)

**Tasks:**
- Add `organisations` table: `(org_id UUID PK, name TEXT, created_at TIMESTAMPTZ)`
- Add `org_id UUID NOT NULL REFERENCES organisations(org_id)` to `messages` table (new migration)
- Update `POST /api/messages/batch` to read `org_id` from the gateway's API key
- Update `GET /api/messages` and `POST /acknowledge` to filter by the authenticated org's `org_id`
- Apply Supabase RLS: `CREATE POLICY "org_isolation" ON messages USING (org_id = auth.jwt()->>'org_id')`
- Update mobile `gatewaySync.ts` to send API key header
- Update dashboard to scope all queries to the authenticated org

---

### 1.3 Proper secrets management
**Why:** Currently developers must manually set env vars from `.env.example`. There are no secret rotation mechanisms, no validation on startup beyond "fail fast."
**Effort:** M
**Dependencies:** None

**Tasks:**
- Set up a secrets manager (e.g. Doppler, 1Password Secrets Automation, or GitHub Secrets + deployment env vars)
- Add a startup validation function that lists all missing env vars with human-readable error messages
- Document every required env var in a `docs/environment.md` file
- Remove `usesCleartextTraffic="true"` from `AndroidManifest.xml` — require HTTPS for all production API URLs
- Add `.env.production` validation to Expo build scripts (`eas.json`)

---

### 1.4 Set up CI/CD pipeline
**Why:** No automated tests run on PRs. Deployments are manual.
**Effort:** M
**Dependencies:** GitHub repo structure

**Tasks:**
- Create `.github/workflows/backend.yml`: lint (ruff/flake8), type-check (mypy), unit tests (pytest), deploy to Render on main push
- Create `.github/workflows/frontend.yml`: type-check (tsc --noEmit), lint (eslint), Vercel preview deploy on PR, production deploy on main push
- Create `.github/workflows/mobile.yml`: type-check, ESLint; trigger EAS build on release tag
- Add a basic pytest smoke test for each API endpoint (use `httpx.AsyncClient` test client)
- Add a basic Jest test for `triageEngine.ts` keyword scorer (verify Bengali CRITICAL keywords score correctly)

---

### 1.5 Billing hooks
**Why:** SaaS needs a path to revenue. Even if billing is not active at launch, the data model must support it.
**Effort:** M
**Dependencies:** 1.2 (multi-tenancy)

**Tasks:**
- Integrate Stripe (or Lemon Squeezy for simpler setup)
- Add `subscriptions` table: `(org_id, stripe_customer_id, plan, status, expires_at)`
- Add usage tracking: count messages ingested per org per billing period
- Add a billing portal link to the dashboard settings page
- Gate CRITICAL tier access or message volume limits by plan

---

## Phase 2 — Core Product Hardening
**Goal:** Make the mesh reliable, the AI actually work, and the dashboard production-grade.

---

### 2.1 Implement real on-device ONNX triage
**Why:** The primary technical differentiator — on-device AI with no internet — is entirely unimplemented. The RunAnywhere/Smolify prize feature is keyword scoring dressed up as a neural model.
**Effort:** L
**Dependencies:** ML expertise, training dataset, Android NDK

**Tasks:**

**Step A — Build the model:**
- Collect/generate ~5,000 disaster message examples in English, Bengali, and Banglish across 4 classes
- Fine-tune `paraphrase-multilingual-MiniLM-L12-v2` (better multilingual support than MobileBERT for Bengali) on the dataset
- Export to ONNX: `model.save_pretrained()` → `optimum.exporters.onnx`
- Quantize to INT8: `onnxruntime.quantization.quantize_dynamic()`
- Verify: size < 15 MB, inference time < 200 ms on Snapdragon 665
- Commit model as `NeighbourNet/assets/model_int8.onnx` (Git LFS or release artifact)

**Step B — Build the Kotlin native module:**
- Add ONNX Runtime Android dependency to `build.gradle`: `com.microsoft.onnxruntime:onnxruntime-android:1.x.x`
- Create `OnnxTriageModule.kt` in `android/.../NeighbourNet/`
- Load model from `assets/model_int8.onnx` on module init
- Implement `@ReactMethod fun classifyMessage(text: String, promise: Promise)`
- Register in `NearbyPackage.kt` (add `OnnxTriageModule` to `createNativeModules()`)
- Return `{priority_tier: String, priority_score: Float}` as JS-readable map

**Step C — Wire up in TypeScript:**
- `NativeModules.OnnxTriage` will now be non-null — `triageEngine.ts` primary path will activate automatically
- Add integration test: send "আটকে পড়েছি" in airplane mode, verify CRITICAL badge appears < 3 seconds

---

### 2.2 Implement Android foreground service
**Why:** Without a foreground service, Android kills the app within minutes of the screen turning off. This makes the relay functionality useless in real disaster scenarios where victims' screens are off.
**Effort:** M
**Dependencies:** None

**Tasks:**
- Create `MeshForegroundService.kt`: extends `Service`, shows a persistent notification "NeighbourNet Mesh Active — X peers connected"
- Register in `AndroidManifest.xml`:
```xml
<service android:name=".MeshForegroundService" android:foregroundServiceType="connectedDevice" />
```
- Create `BootReceiver.kt`: starts `MeshForegroundService` on `BOOT_COMPLETED`
- Register boot receiver in manifest:
```xml
<receiver android:name=".BootReceiver" android:exported="true">
  <intent-filter>
    <action android:name="android.intent.action.BOOT_COMPLETED"/>
  </intent-filter>
</receiver>
```
- Add battery optimization exemption request to onboarding flow
- Test: screen-off relay for 30 minutes on Redmi device

---

### 2.3 Fix TTL decrement and hop_count increment during relay
**Why:** Messages relay infinitely in theory (the native dedup set prevents loops in practice, but analytics data is wrong and the TTL field is meaningless).
**Effort:** S
**Dependencies:** None

**Tasks:**
- In `NearbyModule.kt:onPayloadReceived`, parse `hop_count` and `ttl` from the JSON, check `if (hop_count >= ttl) return` before relaying
- Before calling `rebroadcastToAll`, increment `hop_count` in the JSON: `ack.put("hop_count", hopCount + 1)`
- Remove the static `DEFAULT_TTL = 3` class-level constant — replace all uses with per-message TTL from JSON
- Update `meshRelay.ts` to reflect the same logic (remove its own hop_count check if native layer now handles it correctly)

---

### 2.4 Implement delivery acknowledgements
**Why:** The `sendAcknowledgement` function is dead code. Users get no confirmation that their SOS reached another device.
**Effort:** S
**Dependencies:** 2.3 (TTL fix)

**Tasks:**
- In `NearbyModule.kt:onPayloadReceived`, after emitting to JS, call `sendAcknowledgement(messageJson, endpointId)` for received SOS messages
- Wire up the `onMessageDelivered` JS event in `meshService.ts` to call a callback
- In `App.tsx`, handle `onMessageDelivered` — show a notification or update the message card to show "Delivered to peer"

---

### 2.5 Implement adaptive scan backoff
**Why:** Continuous BLE + WiFi Direct scanning drains battery in 4–6 hours. In a multi-day disaster scenario this is a critical failure.
**Effort:** S
**Dependencies:** None

**Tasks:**
- In `meshService.ts` or a new `meshBackoff.ts`, track time since last peer found
- If no peer found for 5 minutes: increase scan interval from 2s to 30s
- If peer found: reset to 2s interval
- Expose backoff state to `MeshStatusScreen.tsx` so users can see "Scanning every 30s (no peers nearby)"

---

### 2.6 Dashboard auth and org scoping
**Why:** The dashboard is open to anyone with the URL. Coordinators' mission-critical SOS data must be private.
**Effort:** M
**Dependencies:** 1.1 (auth), 1.2 (multi-tenancy)

**Tasks:**
- Integrate Supabase Auth in Next.js (email/password + magic link)
- Add `middleware.ts` to redirect unauthenticated users to `/login`
- Create `app/login/page.tsx`
- Scope all dashboard queries to the authenticated org
- Add user management page for org admins to invite coordinators

---

### 2.7 Replace hardcoded `gateway_id`
**Why:** All gateways appear as the same device in logs and metrics. Gateway-specific analytics are impossible.
**Effort:** S
**Dependencies:** 0.4 (device UUID fix)

**Task:**
- In `gatewaySync.ts:17`, replace `HARD_CODED_GATEWAY_ID` with the device's UUID:
```typescript
const gatewayId = useAppStore.getState().deviceId ?? 'unknown-gateway';
```

---

### 2.8 Add rate limiting to the API
**Why:** `/api/messages/batch` can be flooded with 50-message batches. Without rate limiting, a single bad actor can fill the database and spike Supabase costs.
**Effort:** S
**Dependencies:** 1.1 (auth, so rate limiting can be per-org)

**Tasks:**
- Add `slowapi` or `limits` library to `requirements.txt`
- Apply rate limits: `/api/messages/batch` → 100 requests/minute per API key, `/api/messages` → 60 req/min per JWT
- Return 429 with `Retry-After` header on breach

---

## Phase 3 — Market Launch
**Goal:** Everything needed to onboard paying customers, support them, and observe the system in production.

---

### 3.1 Onboarding flow (mobile)
**Why:** New users have no idea how to use the app. There is no explanation of the mesh concept, no permission rationale, and no "your friend code is X" reveal.
**Effort:** M
**Dependencies:** None

**Tasks:**
- Build a 4-screen onboarding flow:
  1. "What is NeighbourNet?" (mesh diagram, use case)
  2. Permission request rationale (Bluetooth, location, battery optimisation)
  3. "Your friend code is **TIGER-7829**" (copy button, share button)
  4. "You're connected to the mesh" (show peer count)
- Store onboarding completion flag in `expo-secure-store`
- Show onboarding on first launch only

---

### 3.2 Organisation onboarding (web)
**Why:** NGO coordinators need a self-serve way to create an account, invite team members, and get an API key for their gateway devices.
**Effort:** M
**Dependencies:** 1.2 (multi-tenancy), 1.5 (billing)

**Tasks:**
- Build `app/onboarding/page.tsx`: org name, contact email, use case, plan selection
- Auto-create org + admin account + first API key on form submit
- Send welcome email with API key and setup instructions (use Resend or Postmark)
- Build `app/settings/page.tsx`: manage API keys, invite coordinators, view usage

---

### 3.3 Build the ONNX model training pipeline
**Why:** The keyword fallback is a demo workaround. The actual product promise is an 8–10 MB neural model. This needs a repeatable training pipeline so the model can be retrained as disaster vocabulary evolves.
**Effort:** L
**Dependencies:** 2.1 (initial model built manually)

**Tasks:**
- Create `ml/` directory with: `generate_dataset.py`, `train.py`, `evaluate.py`, `export_onnx.py`
- Generate synthetic training data: 5,000 messages × 4 classes × 3 languages
- Add hard negatives (e.g. "water boiling on the stove" must not score CRITICAL)
- Evaluate on held-out Bengal-specific test set
- Document: "to retrain the model, run `make train && make export`"
- Set up GitHub Action to run evaluation on model PRs

---

### 3.4 Documentation
**Why:** Engineers at partner NGOs need to integrate NeighbourNet. Coordinators need to know how to use the dashboard.
**Effort:** M
**Dependencies:** All Phase 1 and Phase 2 features stable

**Tasks:**
- `docs/api.md` — full API reference with request/response examples
- `docs/setup.md` — how to deploy the backend (Render), dashboard (Vercel), and configure Supabase
- `docs/mobile.md` — how to build and distribute the APK to field teams
- `docs/coordinator-guide.md` — how to use the dashboard (with screenshots)
- `docs/environment.md` — every required env var, its purpose, and where to find its value

---

### 3.5 Production monitoring and alerting
**Why:** No uptime monitoring, no error tracking, no alerting. Coordinators using the dashboard during an actual disaster need 99.9% availability.
**Effort:** M
**Dependencies:** Phase 1 deployed

**Tasks:**
- Add Sentry to FastAPI backend (exception tracking)
- Add Sentry to Next.js dashboard (client + server-side errors)
- Set up UptimeRobot or Better Stack to monitor `/health` endpoint
- Add PagerDuty/OpsGenie alert: if queue depth > 100 CRITICAL messages and no coordinator has acknowledged in 10 minutes → page on-call
- Add Grafana alert: active nodes drops to 0 during expected mesh-active hours → notify

---

### 3.6 Performance and load testing
**Why:** A real disaster generates thousands of SOS messages in minutes. The current architecture (single Render instance, Supabase free tier) has never been stress-tested.
**Effort:** M
**Dependencies:** Phase 1 deployed

**Tasks:**
- Write a load test script (k6 or locust): simulate 50 concurrent gateway phones uploading 50 messages each
- Measure: P50/P95/P99 latency for `/api/messages/batch`, Supabase insert throughput
- Identify bottleneck (likely the per-message secondary dedup queries in `messages.py:186–214`)
- Optimise: consider batch body_hash dedup as a single SQL query instead of N individual queries
- Document max safe load per Render/Supabase plan tier

---

### 3.7 Privacy and compliance
**Why:** SOS messages contain medical information, GPS coordinates, and personal details. Any NGO operating in the EU or dealing with NDRF data may face regulatory requirements.
**Effort:** M
**Dependencies:** 1.2 (multi-tenancy)

**Tasks:**
- Add `data_retention_days` per org: auto-delete acknowledged messages older than N days
- Add a data export endpoint: `GET /api/org/export` → CSV of all messages
- Add a data deletion endpoint: `DELETE /api/org/data` for GDPR right to erasure
- Draft a privacy policy covering: what data is collected, where it's stored, how long it's retained
- Review if GPS + body text constitutes personal data under PDPB (India) or GDPR

---

## Effort Reference

| Label | Meaning |
|---|---|
| XS | < 30 minutes |
| S | 1–4 hours |
| M | 1–3 days |
| L | 1–2 weeks |

## Task Dependency Map

```
0.1 → (no deps)
0.2 → (no deps)
0.3 → (no deps)
0.4 → (no deps)
0.5 → (no deps)
0.6 → (no deps)

1.1 → 0.4, 0.6
1.2 → 1.1
1.3 → (no deps)
1.4 → (no deps)
1.5 → 1.2

2.1 → (no deps — can start in parallel with Phase 1)
2.2 → (no deps)
2.3 → (no deps)
2.4 → 2.3
2.5 → (no deps)
2.6 → 1.1, 1.2
2.7 → 0.4
2.8 → 1.1

3.1 → (no deps)
3.2 → 1.2, 1.5
3.3 → 2.1
3.4 → Phase 1 + Phase 2 complete
3.5 → Phase 1 deployed
3.6 → Phase 1 deployed
3.7 → 1.2
```

---

*NeighbourNet Implementation Plan — last updated 2026-04-08*

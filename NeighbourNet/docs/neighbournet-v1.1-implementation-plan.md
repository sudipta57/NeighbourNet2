# NeighbourNet v1.1 — Implementation Plan

## Context for Claude Code

NeighbourNet is an offline mesh communication Android app for concerts — crowded venues where cell towers are saturated. Every Android phone becomes a relay node. Messages hop phone-to-phone over Bluetooth and WiFi Direct with zero internet dependency.

### Existing Stack (already built, do not modify unless stated)

- **React Native** with Expo bare workflow (Android only)
- **Kotlin native module** — Google Nearby Connections API using `P2P_CLUSTER` strategy (BLE + WiFi Direct)
- **Zustand** for state management
- **expo-sqlite v16** for local message queue
- **expo-secure-store** for device UUID
- **expo-location** for GPS
- **Leaflet + OpenStreetMap** via WebView for friend map

### Existing Kotlin Module: `NearbyModule.kt`

- Already handles advertising, discovery, connection, and payload transfer
- Currently sends text messages via `Payload.fromBytes()`
- Has TTL-based hop relay logic (TTL decrement + hop_count increment before rebroadcast)
- Foreground service (`MeshForegroundService.kt`) is already running for background mesh
- Device UUID stored in expo-secure-store, accessible from both JS and Kotlin

### Existing SQLite Schema (expo-sqlite v16)

- Messages table with columns: `id`, `device_uuid`, `sender_id`, `recipient_id`, `content`, `type`, `ttl`, `hop_count`, `timestamp`, `status`
- Deduplication via message `id` (UUID v4 generated at send time)

---

## Feature 1: Image Transfer (Hybrid P2P + Mesh Fallback)

### Overview

Send images between users. Try direct P2P first for best quality. If P2P fails (user is too far), automatically fall back to mesh relay with a compressed version.

### Why Hybrid

`P2P_CLUSTER` strategy has lower bandwidth than `P2P_STAR` or `P2P_POINT_TO_POINT`, but it's the only strategy that supports mesh (M-to-N connections). We compensate by compressing images more aggressively for the mesh path.

### Architecture

```
Sender picks image
    ↓
Compress to 2 tiers:
  - High quality: ≤300 KB (for P2P direct)
  - Low quality:  ≤120 KB (for mesh fallback)
    ↓
Send control message (fromBytes) → { type: "image_offer", image_id, file_size, sender_id, recipient_id }
    ↓
Attempt P2P direct connection to recipient (5 second timeout)
    ↓
  ┌─ P2P SUCCESS → send 300 KB image via Payload.fromFile()
  └─ P2P TIMEOUT → send 120 KB image via mesh relay (Payload.fromBytes(), TTL=2, targeted to recipient UUID)
    ↓
Recipient receives → store in app local storage → display in chat
```

### Step-by-Step Implementation

#### Step 1: Image Picker + Compression (JS Side)

**Install dependencies:**

```bash
npx expo install expo-image-picker expo-image-manipulator expo-file-system
```

**Create: `src/utils/imageCompressor.ts`**

```
Purpose: Take a picked image URI, produce two compressed versions.

Function: compressImage(uri: string) → { highQuality: string, lowQuality: string }

Logic:
1. Use expo-image-manipulator to resize + compress
2. High quality target: max 1200px wide, JPEG quality 0.7, output ≤300 KB
3. Low quality target: max 600px wide, JPEG quality 0.4, output ≤120 KB
4. If high quality is already ≤120 KB, use same file for both tiers
5. Return local file URIs for both versions

Edge cases:
- If source image is smaller than 600px, don't upscale
- If compression still exceeds size cap, reduce quality further in a loop (step down 0.1 per iteration, min 0.2)
```

#### Step 2: Image Payload Protocol (Kotlin Side)

**Modify: `NearbyModule.kt`**

Add a new payload type for images. The existing text message flow uses `Payload.fromBytes()` with a JSON string. Image transfer needs two phases:

**Phase A — Control Message (always via fromBytes):**

```kotlin
// New message type in the payload JSON
{
  "type": "image_offer",        // new type alongside existing "text", "location", etc.
  "image_id": "uuid-v4",        // unique ID for dedup
  "sender_id": "device-uuid",
  "recipient_id": "device-uuid",
  "file_size": 125000,          // bytes
  "transfer_mode": "direct" | "mesh",
  "ttl": 2,                     // only used if mesh
  "hop_count": 0,
  "timestamp": 1234567890
}
```

**Phase B — File Payload:**

```
If transfer_mode == "direct":
  - Use Payload.fromFile(file) for the high quality image
  - Send directly to connected peer

If transfer_mode == "mesh":
  - Read the low quality image file into byte array
  - Prepend a header byte (0x01 = image) to distinguish from text payloads
  - Send as Payload.fromBytes(headerByte + imageBytes)
  - Relay logic: if I receive an image payload and recipient_id != my UUID and TTL > 0:
      → decrement TTL, increment hop_count, rebroadcast to all connected peers
  - If recipient_id == my UUID:
      → save to local storage, emit event to JS side
```

**Important: Byte array max size consideration**

`Payload.fromBytes()` supports up to ~1 MB, so 120 KB mesh images are well within limits. Do NOT use `fromFile()` for mesh relay — intermediate nodes would need to write temp files.

#### Step 3: P2P Direct Attempt with Timeout (Kotlin Side)

**Add to: `NearbyModule.kt`**

```
New exported method: sendImage(recipientId: String, highQualityPath: String, lowQualityPath: String)

Logic:
1. Check if recipient is in the current connected endpoints list
2. If YES (already connected via mesh):
   a. Attempt to send high quality image via Payload.fromFile()
   b. Set a 5-second timeout using Handler/Coroutine
   c. Listen for PayloadTransferUpdate — if FAILURE or timeout:
      → cancel the file transfer
      → fall back to mesh: read lowQualityPath into bytes, send via fromBytes with mesh headers
   d. If SUCCESS → emit "image_sent" event to JS
3. If NOT connected directly:
   → immediately go to mesh path (don't waste time attempting direct)
```

#### Step 4: Receiving Images (Kotlin Side)

**Modify: `onPayloadReceived` in `NearbyModule.kt`**

```
Current: only handles Payload.Type.BYTES as text JSON

Add handling for:
1. Check first byte of BYTES payload:
   - 0x00 or valid JSON start '{' → existing text message flow
   - 0x01 → image payload, strip header, save bytes to cache dir as JPEG
2. For Payload.Type.FILE:
   - Save to app cache directory
   - Read the associated control message (image_offer) to get metadata

After saving:
- Emit event to JS: { type: "image_received", image_id, sender_id, localUri }
- Store reference in SQLite (see Step 5)
```

#### Step 5: SQLite Schema Update (JS Side)

**Modify: existing SQLite migration**

```sql
-- Add to messages table or create separate media table
-- Recommended: extend messages table

ALTER TABLE messages ADD COLUMN media_type TEXT DEFAULT NULL;
-- Values: NULL (text), "image", "ptt_audio"

ALTER TABLE messages ADD COLUMN media_uri TEXT DEFAULT NULL;
-- Local file URI pointing to saved image/audio in app cache

ALTER TABLE messages ADD COLUMN media_size INTEGER DEFAULT NULL;
-- File size in bytes

ALTER TABLE messages ADD COLUMN transfer_mode TEXT DEFAULT NULL;
-- "direct" or "mesh" — for analytics/debugging
```

#### Step 6: Zustand Store Updates (JS Side)

**Modify: `src/store/meshStore.ts` (or equivalent)**

```
Add actions:
- sendImage(recipientId: string, imageUri: string) → triggers compression → calls NativeModule.sendImage()
- receiveImage(payload: { image_id, sender_id, localUri }) → saves to SQLite, updates chat state
- updateImageProgress(image_id: string, progress: number) → for progress indicator

Add state:
- imageTransfers: Map<string, { status: 'compressing' | 'sending' | 'sent' | 'failed', progress: number }>
```

#### Step 7: Chat UI Updates (JS Side)

**Modify: Chat screen component**

```
Add to chat input area:
- Image attachment button (camera icon) next to text input
- On press: open expo-image-picker (camera + gallery options)
- After pick: show preview thumbnail with send/cancel buttons

Add to message bubble component:
- If message.media_type === "image":
  → Render Image component with source = message.media_uri
  → Tap to open full-screen viewer
  → Show "mesh" or "direct" badge for debugging (optional, can remove later)

Add progress indicator:
- When sending: show circular progress overlay on the image thumbnail
- States: compressing (spinner) → sending (progress %) → sent (checkmark) → failed (retry button)

IMPORTANT: Use TouchableOpacity (from react-native), NOT from react-native-gesture-handler.
This is an existing project convention to avoid touch interception issues in ScrollViews.
```

#### Step 8: Deduplication for Images

```
Same as text messages — use image_id (UUID v4) generated at send time.
In onPayloadReceived, before saving:
  → Query SQLite: SELECT id FROM messages WHERE id = ?
  → If exists, drop the payload (already received, possibly via a different relay path)
```

---

## Feature 2: Push-to-Talk Voice (PTT over Mesh)

### Overview

Walkie-talkie style voice communication. Hold a button to record, release to send. Audio clips are small enough to relay over the mesh network.

### Why PTT and Not Real-Time Call

Real-time voice over mesh adds 20–50ms latency per hop. At 3 hops = 60–150ms relay latency + encoding time = unusable for a real call. PTT avoids this entirely — you're sending discrete audio packets, not a continuous stream. Also, concerts are too loud for normal phone calls anyway. PTT is the natural UX.

### Audio Codec Decision: Opus

- **Opus at 16 kHz, 60ms frame size** → ~5 KB per second of audio (~300 KB per minute)
- A 3-second PTT clip = ~15 KB, a 5-second clip = ~25 KB
- This is small enough to send as `Payload.fromBytes()` via mesh with zero network stress
- Opus is preferred over Codec2 (which goes lower to ~1.2 kbps) because Opus quality is better and concert ambient noise doesn't benefit from ultra-low bitrate

### Constraints

- **Max PTT duration: 5 seconds** — hard cap. Nobody sends long voice memos at a concert. Keeps clips under 25 KB.
- **TTL: 3 hops** for PTT audio — slightly higher than images because the payload is much smaller
- **Playback: auto-play on receive** with a brief notification sound first

### Architecture

```
Sender holds PTT button
    ↓
Record audio (expo-av) up to 5 seconds
    ↓
Encode to Opus (via native Kotlin module)
    ↓
Wrap as Payload.fromBytes():
  Header byte (0x02 = ptt_audio) + metadata JSON + opus bytes
    ↓
Send via mesh (same relay logic as text, TTL=3)
    ↓
Recipient receives → decode Opus → auto-play with speaker
```

### Step-by-Step Implementation

#### Step 1: Audio Recording (JS Side)

**Install dependencies:**

```bash
npx expo install expo-av
```

**Create: `src/utils/audioRecorder.ts`**

```
Purpose: Handle PTT recording lifecycle

Exports:
- startRecording() → begins recording, returns recording object
- stopRecording() → stops recording, returns local file URI
- getRecordingDuration() → current duration in ms

Recording config:
- Format: PCM/WAV (will be encoded to Opus in native layer)
- Sample rate: 16000 Hz (16 kHz)
- Channels: 1 (mono)
- Bit depth: 16-bit

Auto-stop logic:
- If duration reaches 5000ms → automatically call stopRecording()
- Return the file URI to the caller

Permission handling:
- Request RECORD_AUDIO permission on first PTT press
- If denied, show toast explaining why mic access is needed
```

#### Step 2: Opus Encoding (Kotlin Native Module)

**Create: `android/app/src/main/java/com/neighbournet/OpusModule.kt`**

```
Purpose: Encode PCM audio to Opus, decode Opus to PCM

Dependencies: Add libopus Android library
  → Use pre-built: https://github.com/nickolay-test/opus-android
  → Or compile from source via NDK

Exported methods (to React Native):

  encodeToOpus(inputPcmPath: String, promise: Promise)
    → Read PCM/WAV file from inputPcmPath
    → Encode to Opus using 16kHz, mono, ~24 kbps bitrate
    → Save .opus file to app cache dir
    → Resolve promise with output file path

  decodeFromOpus(inputOpusPath: String, promise: Promise)
    → Read .opus file
    → Decode to PCM/WAV
    → Save .wav file to app cache dir
    → Resolve promise with output file path

Register in MainApplication / ReactPackage like existing NearbyModule.
```

**Alternative if native Opus is too complex:**

Use `react-native-audio-api` or encode as compressed AAC via expo-av directly. AAC at 24 kbps mono produces similar file sizes (~3-4 KB/sec). Trade-off: slightly larger files but zero native codec work. This is an acceptable fallback.

#### Step 3: PTT Payload Protocol (Kotlin Side)

**Modify: `NearbyModule.kt`**

Add PTT audio as a new payload type:

**Control + Data in a single fromBytes payload:**

```kotlin
// PTT payloads are small enough to send as a single Payload.fromBytes()
// No need for Payload.fromFile() — max 25 KB

// Byte structure:
// [0]       = 0x02 (PTT audio marker)
// [1..N]    = metadata JSON bytes (length-prefixed: first 2 bytes = JSON length as unsigned short)
// [N+1..end] = Opus audio bytes

// Metadata JSON:
{
  "type": "ptt_audio",
  "audio_id": "uuid-v4",
  "sender_id": "device-uuid",
  "recipient_id": "device-uuid" | "broadcast",  // support both DM and broadcast
  "duration_ms": 3200,
  "ttl": 3,
  "hop_count": 0,
  "timestamp": 1234567890
}
```

**Relay logic (same as text, with audio marker):**

```
On receive:
1. Check byte[0]:
   - 0x02 → PTT audio
2. Parse metadata JSON
3. If recipient_id == my UUID OR recipient_id == "broadcast":
   → Extract Opus bytes, save to cache, emit event to JS for playback
4. If recipient_id != my UUID AND TTL > 0:
   → Decrement TTL, increment hop_count
   → Rebroadcast to all connected peers
5. Dedup: check audio_id against seen IDs set (same as message dedup)
```

#### Step 4: PTT Playback (JS Side)

**Create: `src/utils/audioPlayer.ts`**

```
Purpose: Handle incoming PTT playback

Exports:
- playPttAudio(localUri: string, senderName: string) → plays the audio

Playback behavior:
1. Play a brief notification chirp sound (like walkie-talkie "beep") — 100ms
2. Show a toast/overlay: "[SenderName] is speaking..."
3. Play the Opus audio (decoded to PCM via OpusModule.decodeFromOpus)
4. Use expo-av Audio.Sound for playback
5. Route to speaker (not earpiece) — important for concerts, loudspeaker mode
6. After playback completes, dismiss the overlay

Queue handling:
- If multiple PTT messages arrive in quick succession, queue them
- Play sequentially with the chirp before each one
- Show sender name for each
```

#### Step 5: SQLite Storage for PTT Messages

```
Use the same messages table with the columns added in Feature 1:

For PTT messages:
- media_type = "ptt_audio"
- media_uri = local path to saved .opus file
- media_size = file size in bytes
- content = "" (empty, or "[Voice Message]" for display in chat list)
- transfer_mode = "mesh" (PTT always uses mesh)
```

#### Step 6: Zustand Store Updates (JS Side)

**Modify: `src/store/meshStore.ts`**

```
Add actions:
- startPttRecording(recipientId: string) → starts recording
- stopPttRecording() → stops, encodes, sends
- receivePttAudio(payload) → saves to SQLite, triggers playback

Add state:
- pttState: 'idle' | 'recording' | 'encoding' | 'sending'
- pttDuration: number (current recording duration in ms, for UI timer)
- pttQueue: Array<{ audio_id, sender_id, localUri }> (incoming playback queue)
```

#### Step 7: PTT UI (JS Side)

**Modify: Chat screen component**

```
Add PTT button:
- Large circular button at the bottom of chat (alongside text input and image button)
- Press and hold → start recording
  → Button turns red, shows pulsing animation
  → Show recording timer (counting up to 5s max)
  → Waveform/pulse animation while recording
- Release → stop recording, encode, send
  → Button returns to normal, brief "sending..." state
  → Then "sent" checkmark animation

Layout suggestion:
  [Image btn] [.... Text input ....] [PTT btn]
  
  PTT button is always visible. When held, text input area can show the waveform instead.

Incoming PTT display in chat:
- Show as a chat bubble with a play button icon
- Duration text: "0:03" 
- Sender name
- Tap to replay (auto-plays on first receive, tap to replay later)
- Same bubble style as text but with audio icon distinguishing it

IMPORTANT: Use TouchableOpacity (from react-native) for the PTT button.
For press-and-hold detection: use onPressIn (start recording) and onPressOut (stop recording).
Do NOT use gesture-handler — project convention.
```

---

## Shared: AndroidManifest Permissions

**Verify these are already present (they should be from v1.0):**

```xml
<uses-permission android:name="android.permission.BLUETOOTH" />
<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" />
<uses-permission android:name="android.permission.BLUETOOTH_ADVERTISE" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<uses-permission android:name="android.permission.BLUETOOTH_SCAN" />
<uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />
<uses-permission android:name="android.permission.CHANGE_WIFI_STATE" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.NEARBY_WIFI_DEVICES" />
```

**New permissions needed for v1.1:**

```xml
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />
<!-- For Android 12 and below: -->
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />
```

---

## Shared: Payload Type Byte Convention

Standardize the first byte of all `Payload.fromBytes()` messages:

| Byte | Type | Max Size | TTL |
|------|------|----------|-----|
| `0x00` or `{` | Text message (JSON) | ~1 KB | 5 |
| `0x01` | Image (mesh fallback) | 120 KB | 2 |
| `0x02` | PTT audio (Opus) | 25 KB | 3 |

This convention allows the receiver to route payloads to the correct handler without parsing JSON first.

---

## Shared: Bilingual UI Requirement

All new UI strings must be in **both Bengali and English**. This is a non-negotiable design standard for the entire app. Use the existing i18n setup (if present) or maintain a translation object for all new strings:

- "Hold to talk" / "কথা বলতে ধরে রাখুন"
- "Sending image..." / "ছবি পাঠানো হচ্ছে..."
- "Voice message" / "ভয়েস মেসেজ"
- "Image" / "ছবি"
- "Tap to replay" / "আবার শুনতে ট্যাপ করুন"
- "Recording..." / "রেকর্ড হচ্ছে..."
- "Compressing..." / "কম্প্রেস হচ্ছে..."

---

## Implementation Order

Execute in this sequence — each step builds on the previous:

### Phase A: Foundation (do first)

1. SQLite schema migration (add media columns)
2. Payload type byte convention in NearbyModule.kt (add byte routing)
3. AndroidManifest permission additions

### Phase B: Image Transfer

4. Image picker + compressor utility (JS)
5. Image send logic in NearbyModule.kt (P2P attempt + mesh fallback)
6. Image receive logic in NearbyModule.kt (byte routing + file save)
7. Zustand store updates for image state
8. Chat UI — image attachment button, image bubbles, progress indicator

### Phase C: PTT Voice

9. Audio recorder utility with expo-av (JS)
10. Opus encoding native module (Kotlin) — or AAC fallback
11. PTT send logic in NearbyModule.kt (fromBytes with 0x02 header)
12. PTT receive logic + auto-playback (JS)
13. Zustand store updates for PTT state
14. Chat UI — PTT button with hold-to-talk, audio bubbles, waveform

### Phase D: Polish

15. Error handling for all failure cases (permission denied, file too large, encode failure)
16. Deduplication testing with multiple relay nodes
17. Progress indicators and loading states
18. Bengali translations for all new strings

---

## Testing Checklist

### Image Transfer

- [ ] Pick image from gallery → compresses to two tiers
- [ ] Send to nearby user (within P2P range) → receives high quality (≤300 KB)
- [ ] Send to far user (out of P2P range) → falls back to mesh, receives low quality (≤120 KB)
- [ ] 5-second P2P timeout triggers mesh fallback correctly
- [ ] Large source image (5+ MB) compresses within caps
- [ ] Duplicate image (same image_id arriving from two relay paths) is deduped
- [ ] Progress indicator shows correct states
- [ ] Image displays in chat bubble, tap opens full screen

### PTT Voice

- [ ] Hold PTT button → recording starts, waveform shows
- [ ] Release PTT → audio encodes and sends
- [ ] 5-second auto-stop works
- [ ] Received PTT auto-plays with chirp notification
- [ ] Multiple rapid PTT messages queue and play sequentially
- [ ] PTT relays through mesh (test with 3 devices in a chain)
- [ ] Audio is audible over loudspeaker (not earpiece)
- [ ] PTT bubble shows in chat with replay button

### Mesh Relay

- [ ] Image with TTL=2 reaches device 2 hops away
- [ ] Image with TTL=2 does NOT reach device 3 hops away
- [ ] PTT with TTL=3 reaches device 3 hops away
- [ ] Text messages still work unchanged (regression)
- [ ] Payload type byte routing correctly separates text / image / PTT

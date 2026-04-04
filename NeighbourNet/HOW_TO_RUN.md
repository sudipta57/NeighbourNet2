# NeighbourNet — How to Run (After April 2025 Fixes)

## Prerequisites

Two physical Android phones connected via USB, Bluetooth and Location enabled on both.

---

## Step 1 — Start the backend

```bash
cd /home/sudipta/D_drive/neighbour_root/NeighbourNetAPI
source .venv/bin/activate
uvicorn app.main:app --port 8000
```

Leave this terminal open.

---

## Step 2 — Start ngrok

In a new terminal:

```bash
ngrok http 8000
```

The URL `https://towardly-celena-unspectacled.ngrok-free.dev` is your reserved domain and will activate automatically. Leave this terminal open.

---

## Step 3 — Build the APK

```bash
cd /home/sudipta/D_drive/neighbour_root/NeighbourNet/android
./gradlew app:assembleDebug --configure-on-demand -x lint -x test
```

APK output: `android/app/build/outputs/apk/debug/app-debug.apk`

> Only rebuild when you change JS or native (Kotlin) code. Skip this step if the APK is already fresh.

---

## Step 4 — Set up both devices

Run for each connected device serial (get serials with `adb devices -l`):

```bash
adb -s PHONE_SERIAL install -r android/app/build/outputs/apk/debug/app-debug.apk
adb -s PHONE_SERIAL reverse tcp:8000 tcp:8000
```

The `reverse tcp:8000` command tunnels the backend through USB so the phone can reach `localhost:8000` on your computer. **Required for message upload to work on physical devices.**

---

## Step 5 — Launch the app on both devices

```bash
adb -s PHONE_1_SERIAL shell am start -n com.anonymous.NeighbourNet/.MainActivity
adb -s PHONE_2_SERIAL shell am start -n com.anonymous.NeighbourNet/.MainActivity
```

Grant all permissions (Bluetooth, Location) when prompted on each device.

---

## Verify it is working

### Mesh
```bash
adb -s PHONE_SERIAL logcat -d | grep NearbyMesh | tail -20
```
Expected: `advertising started`, `discovery started`, `endpoint found`, `peer connected — total peers: N`

### Upload
```bash
adb -s PHONE_SERIAL logcat -d | grep GatewaySync | tail -10
```
Expected after sending an SOS: `Synced via fallback API base http://127.0.0.1:8000` (or the ngrok URL)

---

## Daily workflow (after first setup)

1. Start backend + ngrok (Steps 1–2)
2. `adb reverse tcp:8000 tcp:8000` on each device (Step 4, install line not needed)
3. Launch app (Step 5)

---

## Common problems

### Mesh: peers not discovered
- Ensure Bluetooth and Location are ON on both phones and app is in foreground
- Tap **Scan Nearby Devices** on both phones
- Check permissions:
  ```bash
  adb -s PHONE_SERIAL shell dumpsys package com.anonymous.NeighbourNet | grep -E "BLUETOOTH|NEARBY|LOCATION|granted=true"
  ```

### Upload: "Sync failed" or no sync log
- Confirm backend is running: `curl http://localhost:8000/api/messages/batch` should return `405 Method Not Allowed`
- Confirm ngrok is running: `curl https://towardly-celena-unspectacled.ngrok-free.dev/api/messages/batch` should also return `405`
- Confirm `adb reverse tcp:8000 tcp:8000` was run for the device
- Rerun Step 4 (`adb reverse`) after unplugging/replugging the device

### Build fails
```bash
cd /home/sudipta/D_drive/neighbour_root/NeighbourNet/android
./gradlew clean
./gradlew app:assembleDebug --configure-on-demand -x lint -x test
```

Do **not** use `./gradlew :app:assembleDebug` directly — it fails with AGP 8.x variant resolution errors.

### App crashes on launch
```bash
adb -s PHONE_SERIAL logcat -d | grep -E "App init error|ReactNativeJS|FATAL"
```

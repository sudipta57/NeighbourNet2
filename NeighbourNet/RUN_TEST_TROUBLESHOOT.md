# NeighbourNet Run, Test, and Quick-Fix Guide

This is the single practical guide to:
- Run the app
- Test core features
- Fix common mesh/network issues quickly

## 1) Quick Start (Daily Use)

From project root:

```bash
cd /home/sudipta/D_drive/all-projects-main/NeighbourNet
npm install
npm run start
```

In another terminal, build/install Android app:

```bash
cd /home/sudipta/D_drive/all-projects-main/NeighbourNet
npm run android
```

## 2) Run on Two Physical Android Phones

### A) Check both devices are connected

```bash
adb devices -l
```

### B) Build debug APK once

```bash
cd /home/sudipta/D_drive/all-projects-main/NeighbourNet/android
./gradlew :app:assembleDebug
```

### C) Install on both phones

```bash
cd /home/sudipta/D_drive/all-projects-main/NeighbourNet
adb -s PHONE_1_SERIAL install -r android/app/build/outputs/apk/debug/app-debug.apk
adb -s PHONE_2_SERIAL install -r android/app/build/outputs/apk/debug/app-debug.apk
```

### D) Launch app on both

```bash
adb -s PHONE_1_SERIAL shell am start -n com.anonymous.NeighbourNet/.MainActivity
adb -s PHONE_2_SERIAL shell am start -n com.anonymous.NeighbourNet/.MainActivity
```

## 3) Core Test Flow

## Test A: Mesh discovery between two phones
1. Open app on both phones.
2. Go to Mesh Status on both.
3. Tap Scan Nearby Devices (or Start Mesh & Scan Devices).
4. Wait 10 to 20 seconds.
5. Expected: Peers Nearby should become greater than 0 on at least one device, then both.

## Test B: Offline queue + sync
1. Turn internet off on phone.
2. Send SOS.
3. Expected: message is queued.
4. Turn internet back on.
5. Tap Sync now.
6. Expected: queued message becomes synced.

## Test C: Priority triage sanity
Send sample messages:
- Trapped, need boat -> expected CRITICAL/HIGH
- Medical emergency -> expected HIGH/CRITICAL
- Safe, checking in -> expected LOW

## 4) Quick Fixes (Most Common Problems)

## Problem: Scan button disabled on one phone
Usually means mesh is not active on that device.

Try:
1. Close app completely on both phones and reopen.
2. On affected phone, tap Start Mesh & Scan Devices.
3. If still disabled/stuck, force-stop and relaunch:

```bash
adb -s AFFECTED_SERIAL shell am force-stop com.anonymous.NeighbourNet
adb -s AFFECTED_SERIAL shell am start -n com.anonymous.NeighbourNet/.MainActivity
```

4. Reinstall latest debug APK on both phones.

## Problem: Peers Nearby remains 0 on both phones
Try in this order:
1. Ensure Bluetooth and Location are ON on both phones.
2. Keep both phones unlocked and app in foreground.
3. Press scan on both once.
4. Restart Bluetooth on both phones.
5. Reopen app and rescan.

Collect focused logs:

```bash
adb -s PHONE_SERIAL logcat -d | grep -E "NearbyMesh|ReactNativeJS|App init error|Failed to trigger peer scan"
```

## Problem: Mesh permission issues
Check runtime grants:

```bash
adb -s PHONE_SERIAL shell dumpsys package com.anonymous.NeighbourNet | grep -E "BLUETOOTH_ADVERTISE|BLUETOOTH_SCAN|BLUETOOTH_CONNECT|NEARBY_WIFI_DEVICES|ACCESS_FINE_LOCATION|granted=true"
```

If any required permission is denied, uninstall app and install again, then allow all requested permissions.

## Problem: Network sync not working
Current API base URL is configured in:
- src/constants/priorities.ts

If backend URL changed, update API_BASE_URL, rebuild, and reinstall APK.

Quick log check:

```bash
adb -s PHONE_SERIAL logcat -d | grep -E "GatewaySync|Network blocked|Sync failed|Validation error"
```

## Problem: adb says "more than one device/emulator"
Specify serial every time:

```bash
adb -s PHONE_SERIAL <command>
```

## 5) Hard Reset Workflow (When Things Are Weird)

```bash
cd /home/sudipta/D_drive/all-projects-main/NeighbourNet
pkill -f "expo|metro|react-native" || true
adb kill-server
adb start-server
npm run start
```

Then rebuild/reinstall:

```bash
cd /home/sudipta/D_drive/all-projects-main/NeighbourNet/android
./gradlew :app:assembleDebug
cd /home/sudipta/D_drive/all-projects-main/NeighbourNet
adb -s PHONE_1_SERIAL install -r android/app/build/outputs/apk/debug/app-debug.apk
adb -s PHONE_2_SERIAL install -r android/app/build/outputs/apk/debug/app-debug.apk
```

## 6) One-Command Health Checks

Check connected devices:

```bash
adb devices -l
```

Check app process running:

```bash
adb -s PHONE_SERIAL shell pidof com.anonymous.NeighbourNet
```

Check latest mesh events:

```bash
adb -s PHONE_SERIAL logcat -d | grep NearbyMesh | tail -n 80
```

---
If a problem repeats, collect logs from both phones at the same time and compare timestamps around app launch and first scan.
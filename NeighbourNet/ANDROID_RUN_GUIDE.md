# NeighbourNet Android Run Guide (From Scratch)

This guide covers everything from initial setup to running the app on an Android emulator.

## 1. Go to project root

```bash
cd /home/sudipta/D_drive/all-projects-main/NeighbourNet
```

## 2. Install system prerequisites (Ubuntu/Debian)

```bash
sudo apt update
sudo apt install -y curl git unzip zip openjdk-17-jdk
```

## 3. Install Node.js (LTS)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
java -version
```

## 4. Install Android Studio and SDK components

1. Download and install Android Studio: https://developer.android.com/studio
2. Open Android Studio and install these components from SDK Manager:
   - Android SDK Platform (latest stable, usually API 34/35)
   - Android SDK Platform-Tools
   - Android SDK Build-Tools
   - Android Emulator
   - Android SDK Command-line Tools

## 5. Configure Android environment variables

```bash
echo 'export ANDROID_HOME=$HOME/Android/Sdk' >> ~/.bashrc
echo 'export ANDROID_SDK_ROOT=$HOME/Android/Sdk' >> ~/.bashrc
echo 'export PATH=$PATH:$ANDROID_HOME/emulator' >> ~/.bashrc
echo 'export PATH=$PATH:$ANDROID_HOME/platform-tools' >> ~/.bashrc
echo 'export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin' >> ~/.bashrc
source ~/.bashrc
```

## 6. Verify Android CLI tools

```bash
sdkmanager --version
adb version
emulator -version
```

## 7. Install required Android packages and accept licenses

```bash
yes | sdkmanager --licenses
sdkmanager "platform-tools" "emulator" "platforms;android-35" "build-tools;35.0.0" "system-images;android-35;google_apis;x86_64"
```

## 8. Create an Android Virtual Device (AVD)

```bash
avdmanager create avd -n Pixel_7_API_35 -k "system-images;android-35;google_apis;x86_64" -d pixel_7
```

## 9. Start the emulator

```bash
emulator -avd Pixel_7_API_35
```

## 10. Confirm emulator is detected

```bash
adb devices
```

You should see a device similar to:

```text
emulator-5554 device
```

## 11. Install project dependencies

```bash
cd /home/sudipta/D_drive/all-projects-main/NeighbourNet
npm install
```

## 12. Run the app on Android

```bash
npm run android
```

This project uses:

- `npm run android` -> `expo run:android`
- `npm run start` -> `expo start --dev-client`

## Daily workflow (after first setup)

1. Start emulator:

```bash
emulator -avd Pixel_7_API_35
```

2. Start Metro/dev client:

```bash
cd /home/sudipta/D_drive/all-projects-main/NeighbourNet
npm run start
```

3. Build/run app when needed:

```bash
cd /home/sudipta/D_drive/all-projects-main/NeighbourNet
npm run android
```

## Troubleshooting

### Reset Metro/ADB if stuck

```bash
pkill -f "expo|metro|react-native" || true
adb kill-server
adb start-server
adb devices
```

### Clean Android build and rebuild

```bash
cd /home/sudipta/D_drive/all-projects-main/NeighbourNet/android
./gradlew clean
cd ..
npm run android
```

### Reinstall node modules

```bash
cd /home/sudipta/D_drive/all-projects-main/NeighbourNet
rm -rf node_modules package-lock.json
npm install
npm run android
```

### Clear Expo cache

```bash
npx expo start -c --dev-client
```

### If app cannot connect to Metro

```bash
adb reverse tcp:8081 tcp:8081
```

## One-shot quick run (line-by-line)

```bash
cd /home/sudipta/D_drive/all-projects-main/NeighbourNet
npm install
emulator -avd Pixel_7_API_35
adb devices
npm run android
```

## Run on emulator + physical device at the same time

Use one Metro server and install the app explicitly on each device.

### 1) Start emulator and connect phone

- Start your emulator.
- Connect your Android phone with USB.
- Enable Developer Options and USB debugging on the phone.
- If prompted on phone, tap "Allow USB debugging".

### 2) Start Metro once

```bash
cd /home/sudipta/D_drive/all-projects-main/NeighbourNet
npm run start
```

### 3) Verify both devices are listed

```bash
adb devices
```

Expected: one emulator (for example, `emulator-5554`) and one phone serial.

### 4) Reverse Metro port for both devices

```bash
adb -s emulator-5554 reverse tcp:8081 tcp:8081
adb -s YOUR_PHONE_SERIAL reverse tcp:8081 tcp:8081
```

### 4.1) Reverse local gateway API port (required if backend runs on your laptop)

```bash
adb -s emulator-5554 reverse tcp:8000 tcp:8000
adb -s YOUR_PHONE_SERIAL reverse tcp:8000 tcp:8000
```

Without this, queue sync on a physical phone can fail with `Network request failed` even if Metro is connected.

### 5) Build debug APK once

```bash
cd /home/sudipta/D_drive/all-projects-main/NeighbourNet/android
./gradlew assembleDebug
cd ..
```

### 6) Install APK on both

```bash
adb -s emulator-5554 install -r android/app/build/outputs/apk/debug/app-debug.apk
adb -s YOUR_PHONE_SERIAL install -r android/app/build/outputs/apk/debug/app-debug.apk
```

### 7) Launch app on both

```bash
adb -s emulator-5554 shell am start -n com.anonymous.NeighbourNet/.MainActivity
adb -s YOUR_PHONE_SERIAL shell am start -n com.anonymous.NeighbourNet/.MainActivity
```

Tip: Replace `YOUR_PHONE_SERIAL` with the exact serial from `adb devices`.



<!-- Rebuild the APK:
cd ./android
./gradlew clean assembleDebug

Start Metro once from the project root:
cd /home/sudipta/D_drive/all-projects-main/NeighbourNet
npm run start

Confirm both phones are visible:
adb devices

Reverse the Metro port for each phone serial:
adb -s SERIAL_1 reverse tcp:8081 tcp:8081
adb -s SERIAL_2 reverse tcp:8081 tcp:8081

Install the rebuilt APK on both devices:
adb -s SERIAL_1 install -r android/app/build/outputs/apk/debug/app-debug.apk
adb -s SERIAL_2 install -r android/app/build/outputs/apk/debug/app-debug.apk

Launch the app on both phones:
adb -s SERIAL_1 shell am start -n com.anonymous.NeighbourNet/.MainActivity
adb -s SERIAL_2 shell am start -n com.anonymous.NeighbourNet/.MainActivity

The app id and launcher activity come from build.gradle and AndroidManifest.xml. -->






<!-- 
What to do now on your devices

Start backend on your laptop (port 8000).
Run on each device:
adb -s emulator-5554 reverse tcp:8081 tcp:8081
adb -s emulator-5554 reverse tcp:8000 tcp:8000
adb -s YOUR_PHONE_SERIAL reverse tcp:8081 tcp:8081
adb -s YOUR_PHONE_SERIAL reverse tcp:8000 tcp:8000
Open app on both devices and keep both on the mesh screen for a bit.
Press Scan Nearby Devices on one or both phones.
Verify peer count rises above 0.
Send a message while offline, then enable internet on one device and confirm queue drains without repeated red-box errors. -->

<!-- hey now the mesh is working perfect, but the sos are not uploading , it fails, can you -->
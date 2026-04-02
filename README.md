# PTHR Mobile Tracking

React Native mobile app built with Expo for one shared codebase across iOS and Android.

## What it does

- Signs employees in using the existing backend auth API
- Sends live device location to `POST /api/tracking/location`
- Reads tracking policy from `GET /api/tracking/settings`
- Supports background location updates for attendance/live monitoring
- Keeps API base URL configurable for simulator, emulator, and physical devices

## Quick start

1. Install dependencies

```bash
npm install
```

2. Copy environment file

```bash
cp .env.example .env
```

3. Set your backend URL

```env
EXPO_PUBLIC_API_BASE_URL=http://YOUR-LAN-IP:8000
```

4. Start Expo

```bash
npm start
```

## Run targets

```bash
npm run android
npm run ios
npm run web
```

If you open the Metro URL in a normal browser and see JSON, that is expected. The URL is a development manifest for Expo Go or the native simulator, not a browser UI.

## Native bundling

Generate native projects:

```bash
npm run prebuild
```

Run native app locally:

```bash
npm run android:native
npm run ios:native
```

If Android Studio is installed, make sure these are available in your shell before running Android native builds:

```bash
export ANDROID_HOME=$HOME/Library/Android/sdk
export ANDROID_SDK_ROOT=$HOME/Library/Android/sdk
```

If `npm run android:native` fails with an NDK error, install the missing NDK from Android Studio:

```text
Android Studio → Settings → Android SDK → SDK Tools → NDK (Side by side)
```

The current native setup expects a complete NDK installation. Expo Go does not need this, but native Android builds do.

## Release builds

This project includes EAS build profiles in `eas.json`.

Preview/internal builds:

```bash
npm run build:android:preview
npm run build:ios:preview
```

Production store builds:

```bash
npm run build:android:production
npm run build:ios:production
```

Store submission commands:

```bash
npm run submit:android
npm run submit:ios
```

## Important notes

- On a physical phone, `localhost` will not reach your computer. Use your machine LAN IP.
- iOS background location requires permission approval and must be tested on a real device for the most accurate behavior.
- Android background tracking works best on a physical device with battery optimization disabled for the app.
- iOS simulator launch requires a full Xcode installation and selected command line tools.

## Backend endpoints used

- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/tracking/settings`
- `POST /api/tracking/location`

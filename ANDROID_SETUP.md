# AVELUT Android App — Complete Setup Guide

## ✅ Status: google-services.json added

---

## Step 1: Install Android Studio (REQUIRED)

Download from: **https://developer.android.com/studio**

> Android Studio bundles JDK 17 — you don't need to install Java separately.

After installing, open Android Studio at least once to finish SDK setup.

---

## Step 2: Add SHA-1 Fingerprint for Google Sign-In (REQUIRED)

Google Sign-In on native Android requires a **SHA-1 certificate fingerprint** registered in Firebase.

### Generate the debug SHA-1 fingerprint:

After Android Studio is installed, run this from the `android/` folder:

```bash
cd android
./gradlew signingReport
```

Look for the `SHA1:` line under `Variant: debug`. It looks like:
```
SHA1: AA:BB:CC:DD:EE:FF:...
```

### Register it in Firebase:

1. Go to [Firebase Console](https://console.firebase.google.com) → project **tlord-1ab38**
2. **Project Settings** → **General** → scroll to your Android app (`com.avelut.app`)
3. Click **"Add fingerprint"**
4. Paste the SHA-1 value → **Save**
5. **Re-download** the `google-services.json` file (it'll now contain a native OAuth client)
6. Replace `android/app/google-services.json` with the new file

---

## Step 3: Build & Run the App

### From the project root, rebuild everything:

```bash
# 1. Build web assets
npm run build

# 2. Sync to Android
npx cap sync android

# 3. Open Android Studio
npx cap open android
```

### In Android Studio:
1. Wait for Gradle sync to complete (first time takes 3–10 min)
2. Plug in your Android phone (enable **Developer Options + USB Debugging**)
   — OR — create an **AVD emulator** (Tools → Device Manager → Create Device)
3. Press the **▶ Run** button (or `Shift+F10`)

---

## Step 4: Test Push Notifications

1. Log into the app on your device
2. Go to **Firebase Console** → **Cloud Messaging** → **Send test message**
3. Find the FCM token in Firebase RTDB: `users/{uid}/fcm_token`
4. Send a test notification
5. It should appear in the Android notification tray ✅

---

## Step 5: Build a Release APK (for distribution)

In Android Studio:
- **Build** → **Generate Signed Bundle / APK**
- Choose **APK**
- Create a new keystore (keep it safe — you need it for all future updates)
- Build → find the APK in `android/app/release/`

---

## After Any Code Changes

Whenever you update the React/TypeScript code:

```bash
npm run build:mobile
# This runs: vite build && npx cap sync android
```

Then in Android Studio, press **▶ Run** again — it redeploys automatically.

---

## Quick Reference

| Command | What it does |
|---------|-------------|
| `npm run dev` | Web dev server (unchanged) |
| `npm run build` | Build web assets to `dist/` |
| `npm run build:mobile` | Build + sync to Android |
| `npx cap sync android` | Sync web assets to native project |
| `npx cap open android` | Open project in Android Studio |

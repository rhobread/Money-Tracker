# Money Tracker

A mobile money tracker built with Expo and JavaScript. Set your current balance in Indonesian rupiah (IDR) and save your changes locally on your phone.

## Requirements

- A current Node.js LTS release and npm: https://nodejs.org/
- Expo Go on your Android phone or iPhone, compatible with this project's Expo SDK 58.
- Your computer and phone connected to the same Wi-Fi network for the default connection method.

You do not need Android Studio or Xcode to run the app on a physical phone using Expo Go.

## Run On Your Phone

### 1. Open the project

Open a terminal in the project folder. On Windows PowerShell:

```powershell
cd "C:\Personal Projects\Money Tracker"
```

### 2. Install dependencies

Run this for the first setup, or after dependencies change:

```bash
npm install
```

### 3. Start Expo

```bash
npm start
```

Keep the terminal open while developing. Expo displays a QR code.

### 4. Open the app

- **Android:** Open Expo Go and scan the QR code.
- **iPhone:** Scan the QR code with the Camera app, then tap the link to open Expo Go.

The first load may take a little time while Expo bundles the app. Changes to your code normally appear automatically through Fast Refresh.

To stop the development server, press `Ctrl+C` in the terminal. To run it again later, use `npm start`; you do not need to reinstall dependencies each time.

## Use The App

1. Tap **Set your balance**.
2. Enter your current amount in IDR, without thousands separators. Up to two decimal places are supported with a comma or dot (for example, `1250,50`).
3. Tap **Save balance** to save it on the device.
4. Tap **Update balance** whenever you want to change it.

The initial balance is zero and IDR is the only currency. Balances use Indonesian formatting, for example `Rp 1.250,50`. Two decimal places are retained so existing fractional balances are not rounded away.

Existing version 1 balances (USD, EUR, GBP, PHP, INR, CAD, or AUD) are relabeled as IDR, not converted using exchange rates: an old balance of USD 123.45 becomes IDR 123.45. Loading migrates the data in memory while preserving the integer amount and last-updated timestamp; the original stored data is left untouched until you save a balance, which writes version 2. Invalid or unsupported data is rejected without overwriting it.

## Run In An Emulator

### Android

Install Android Studio, configure an Android Virtual Device, and start the emulator. Then run:

```bash
npm run android
```

### iOS

The iOS Simulator requires macOS and Xcode. On a Mac with the simulator configured, run:

```bash
npm run ios
```

Windows cannot run the iOS Simulator, but you can use a physical iPhone with Expo Go.

## Troubleshooting

### The phone cannot connect

- Confirm the phone and computer are on the same Wi-Fi network.
- Allow Node.js through Windows Firewall on your trusted private network.
- VPNs and guest Wi-Fi networks can block the connection.

If the local connection still fails, stop Expo and try tunnel mode:

```bash
npm start -- --tunnel
```

Follow any Expo prompt to install its tunnel dependency, then scan the new QR code. Tunnel mode requires internet access and may be slower.

### Expo Go reports an incompatible SDK

This project uses Expo SDK 58. Update Expo Go and check that it supports this SDK. See https://expo.dev/go for available versions and platform limitations. If a compatible Expo Go version is unavailable for your device, a compatible development build is required.

### Changes are not showing or Metro reports cache errors

Stop the server and restart with a cleared bundler cache:

```bash
npm start -- --clear
```

### PowerShell blocks npm.ps1

Use `npm.cmd` instead of `npm`, for example:

```powershell
npm.cmd install
npm.cmd start
```

## Local Data Storage

- The app saves JSON using AsyncStorage under the key `@money-tracker/wallet`.
- Version 2 data contains the balance in integer hundredths of a rupiah (`balanceMinor`), currency fixed to `IDR`, last-updated timestamp, and a schema version. The minor-unit scale is unchanged from version 1 to avoid losing saved amounts.
- Saving successfully updates both the stored data and the displayed balance.
- Data persists between app launches. There is no account, backend, or app-managed cloud sync.
- This is app-private storage, not a user-visible JSON file in your Downloads folder.
- AsyncStorage is not encrypted. Clearing app data or uninstalling can delete the saved balance.
- When testing in Expo Go, data lives in Expo Go's storage rather than a separately installed Money Tracker app.

The balance functionality works without a backend. During development, Expo Go still needs access to the development server to load the app; this setup does not produce a standalone installable app.

## Project Structure

```text
App.js                         App entry component
index.js                       Expo entry registration
src/
  components/BalanceEditor.js  Balance editing form
  screens/BalanceScreen.js    Main dashboard
  hooks/useWallet.js          Loading and saving state
  storage/walletStorage.js    Local JSON persistence
  utils/money.js              Amount parsing and data validation
  theme.js                   Shared colors
tests/money.test.js           Money and data validation tests
```

## Development Checks

Run unit tests:

```bash
npm test
```

Check Expo configuration and dependency compatibility:

```bash
npx expo-doctor
```

Verify Android and iOS JavaScript bundles:

```bash
npx expo export --platform all
```

Exported bundles are written to `dist/`. This checks bundling; it does not create an APK or iOS installation file and does not replace testing on a device.


to run
npm start -- --go

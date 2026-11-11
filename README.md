# Money Tracker

A personal money tracker built with Expo and JavaScript. Track named money sources in Indonesian rupiah (IDR); the current balance is their sum.

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

1. Tap the **Current balance** card to show your money sources. Tap it again to hide them.
2. Tap **Add source** and enter a name, such as Bank A or Cash.
3. Enter its amount in IDR, without thousands separators. Up to two decimal places are supported with a comma or dot (for example, `1250,50`). Negative amounts are supported.
4. Tap **Save**. Bank A with 1000 and Bank B with 2000 produce a current balance of 3000.
5. Use **Edit** to change a source's name or amount. **Delete** asks for confirmation before removing it.

The initial balance is zero and IDR is the only currency. Balances use Indonesian formatting, for example `Rp 1.250,50`. Two decimal places are retained so existing fractional balances are not rounded away.

Existing version 1 balances (USD, EUR, GBP, PHP, INR, CAD, or AUD) and version 2 IDR balances become one source named **My money**. Every integer hundredth, including zero and negative values, and the last-updated timestamp are preserved. Legacy currencies are relabeled as IDR without exchange-rate conversion. Migration happens in memory; the original stored JSON is untouched until a successful add, edit, or delete writes version 3. Invalid or unsupported data blocks editing and offers a retry without overwriting storage.

Names must contain 1 to 80 characters after trimming. Each amount must be smaller than 10 billion rupiah in magnitude. Totals must fit within JavaScript's safe integer range in hundredths. The balance is derived, not separately editable. Failed saves retain the previous list and total; repeated submissions are blocked while saving.

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
- Version 3 data contains `sources` (each with a stable `id`, `name`, and integer `amountMinor`), currency fixed to `IDR`, `updatedAt`, and `version`. Amounts remain in hundredths of a rupiah. No separate total is stored.
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
  components/SourceEditor.js   Source editing form
  screens/BalanceScreen.js    Main dashboard
  hooks/useWallet.js          Loading and saving state
  storage/walletStorage.js    Local JSON persistence
  utils/money.js              Amount parsing and data validation
  theme.js                   Shared colors
tests/money.test.js           Validation, totals and migration tests
tests/storage.test.js         Persistence and failure-protection tests
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

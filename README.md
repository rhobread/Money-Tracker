# Money Tracker

A personal money tracker built with Expo and JavaScript. Track your current balance, recurring income, and payments in Indonesian rupiah (IDR). All tracking is manual and saved on the device.

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

1. Tap the **Current balance** card to open the **Money Sources** screen. Use **< Balance** or Android's back button to return.
2. Tap **Add source** and enter a name, such as Bank A or Cash.
3. Enter its amount in IDR, without thousands separators. Up to two decimal places are supported with a comma or dot (for example, `1250,50`). Negative amounts are supported.
4. Tap **Save**. Bank A with 1000 and Bank B with 2000 produce a current balance of 3000.
5. Use **Edit** to set a source's current balance or change its name. **Delete** asks for confirmation; sources still selected by income/payment items or entries cannot be deleted until those references are cleared or moved.

The initial balance is zero and IDR is the only currency. Balances use Indonesian formatting, for example `Rp 1.250,50`. Two decimal places are retained so existing fractional balances are not rounded away.

Existing version 1 balances (USD, EUR, GBP, PHP, INR, CAD, or AUD) and version 2 IDR balances become one source named **My money**. Every integer hundredth, including zero and negative values, and the last-updated timestamp are preserved. Legacy currencies are relabeled as IDR without exchange-rate conversion. Migration happens in memory; the first successful save writes the combined money data described below, leaving the older keys untouched. Invalid or unsupported data blocks editing and offers a retry without overwriting storage.

Names must contain 1 to 80 characters after trimming. Each amount must be smaller than 10 billion rupiah in magnitude. Totals must fit within JavaScript's safe integer range in hundredths. The balance is derived, not separately editable. Failed saves retain the previous list and total; repeated submissions are blocked while saving.

## Income And Payments

Below the balance are two cards: **Source of Income** for money you expect to receive, and **Payments** for money you need to pay. Tap either card to open its list.

1. Tap **Add income** or **Add payment**.
2. Enter a name and amount, such as Payment `5800000`, Kontrakan Fatra `1000000`, or Kontrakan Desi `12000000`.
3. Select a **Default money source**, such as Bank A, then choose **Daily**, **Weekly**, **Monthly**, or **Yearly**, and enter the **First due date** as `YYYY-MM-DD` (for example, `2026-11-01`). **Choose per entry** leaves the default empty.
4. Save. The item's detail screen automatically lists entries for that year. Use **Previous** and **Next** to browse other years, and the month buttons to narrow the list. Daily and weekly items initially open to the current month (or their first month if they haven't started yet).
5. Tap **Paid** to mark an entry paid using today's date. Income increases its money source; payments decrease it. If no source is selected, an editor opens so you can choose one before saving.
6. Tap an entry's **Edit** button to adjust its amount, due date, paid status, paid date, or money source. **Use default** inherits the item's default, or select another source for just that entry.
7. Uncheck **Paid** to mark the entry unpaid, clear its paid date, and reverse its previous balance change.

Income uses **Paid** to mean the money has been received. Unpaid entries past their due date show **Overdue**. All actions are still manual: the app changes your local records only, not your actual bank accounts. There are no automatic payments, bank connections, or notifications.

For example, paid income of Rp1.000.000 into Bank A adds Rp1.000.000 to its balance. A paid bill of Rp200.000 from Bank B subtracts Rp200.000 from Bank B. The front-page total updates automatically.

Saving a paid entry again does not count it twice. Changing only its due/paid dates does not move money. Changing its amount adjusts the difference; changing its source reverses the old source's change and applies the new amount to the new source. Paid entries retain their selected source if you later change the item's default.

**Older paid entries are not added or deducted during migration**, because their amounts may already be included in your current balances. They show a note. To explicitly include one now, save it as unpaid first, then mark it paid with a selected money source. This also applies if you edit an older paid entry: it remains uncounted until that explicit unpaid/paid action.

Weekly entries repeat on the weekday of the first due date. Monthly entries repeat on its day of the month; if that day is missing, the last day of that month is used (January 31 becomes February 28 or 29, then March 31). Yearly February 29 entries use February 28 in non-leap years. No entries are generated before the first due date.

**Edit item** changes the name, default amount, repeat schedule, and default money source. Entries you have already edited or marked paid retain their saved amounts, dates, and status, even if the schedule changes. Entries are grouped by their original scheduled year and month, so changing one due date into a different period does not move it to another period's list. **Delete item** asks for confirmation, removes the item and its saved entries, and reverses its previously recorded balance changes.

Manually editing a money source sets its actual current balance. Later reversals still add or subtract the original recorded amount from that current balance; they do not reset it to an older balance. An operation that exceeds the supported amount limits fails without saving any part of the change.

Date fields accept real calendar dates from 1900 through 9999. Income and payment amounts must be zero or positive; the section determines whether money is incoming or outgoing.

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

- The app saves one JSON object using AsyncStorage under `@money-tracker/data`, with an outer schema version of 1, wallet version 3, and trackers version 2.
- Balances, source selections, paid status, and recorded balance changes are saved together in one write. A failed save leaves both the balances and entries unchanged.
- Older `@money-tracker/wallet` and `@money-tracker/trackers` keys are read only if the combined key is absent. They remain untouched as migration backups. An invalid combined record never falls back to those potentially stale backups.
- Recurring entries are calculated when you view a year; only schedules and entries you explicitly change are stored. No background task is needed to generate them.
- The wallet contains `sources` (each with a stable `id`, `name`, and integer `amountMinor`), currency fixed to `IDR`, `updatedAt`, and `version`. Amounts remain in hundredths of a rupiah. No separate total is stored.
- Each tracker has `defaultSourceId`; saved entries can override `sourceId`. A paid entry's internal `applied` record remembers its signed balance change so edits, unpaying, and deletion can correct or reverse it without double-counting.
- Saving successfully updates both the stored data and the displayed balance.
- Data persists between app launches. There is no account, backend, or app-managed cloud sync.
- This is app-private storage, not a user-visible JSON file in your Downloads folder.
- AsyncStorage is not encrypted. Clearing app data or uninstalling can delete your balance and trackers.
- When testing in Expo Go, data lives in Expo Go's storage rather than a separately installed Money Tracker app.

The balance functionality works without a backend. During development, Expo Go still needs access to the development server to load the app; this setup does not produce a standalone installable app.

## Logo And App Icon

Put app images in `assets/`. The included logo is a simple wallet and coin in the app's green and lime colors.

| File | Purpose |
| --- | --- |
| `assets/logo.svg` | Editable vector source, with a transparent background. |
| `assets/icon.png` | Generated 1024 x 1024 app icon with a solid green background. |
| `assets/adaptive-icon.png` | Generated transparent foreground for Android launcher icons. |

After editing `assets/logo.svg`, regenerate the PNG icons:

```bash
npm run icons:generate
```

The renderer is a development-only dependency; it is not included in the mobile app. Keep the SVG canvas square and the main design centered so Android launcher masks do not cut it off.

If you make your own PNG instead, replace `assets/icon.png` with a square 1024 x 1024 PNG. Android also uses `assets/adaptive-icon.png`; replace that with a transparent foreground version with generous padding. Do not run the generator afterward unless you want to overwrite those PNGs from the SVG. Image paths and the Android icon background color are configured in `app.json`.

Launcher icon changes require a new native APK/app build. Expo Go's own installed launcher icon does not change.

## Project Structure

```text
App.js                         App entry component
index.js                       Expo entry registration
assets/                        Logo source and generated app icons
scripts/generate-icons.js      SVG-to-PNG icon generation
src/
  components/SourceEditor.js    Balance source editing
  components/TrackerForm.js     Shared tracker form and fields
  components/TrackerEditor.js   Recurring item editing
  components/OccurrenceEditor.js Individual entry editing
  components/MoneySourcePicker.js Default and per-entry source selection
  screens/BalanceScreen.js      Main dashboard
  screens/MoneySourcesScreen.js Bank/cash source list and editing
  screens/TrackerScreen.js      Income/payment lists and entries
  hooks/useMoneyData.js         Shared money data and save lock
  storage/moneyStorage.js       Combined JSON persistence and migration
  utils/finance.js              Linked balance updates and reversals
  utils/money.js                Amount parsing and balance validation
  utils/trackers.js             Dates, recurrence and tracker validation
  theme.js                   Shared colors
tests/money.test.js           Validation, totals and migration tests
tests/finance.test.js         Linked balances, reversals and source validation
tests/trackers.test.js        Recurrence and tracker validation tests
tests/moneyStorage.test.js    Combined persistence, migration and failure protection
tests/trackerUi.test.js       Dashboard navigation and entry update handlers
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

# Rho Tracker

A personal tracker built with Expo and JavaScript, with a bread logo and two sections: **Money** and **Habit Tracker**. Money tracks balance, recurring income, and payments in Indonesian rupiah (IDR). Optional Google Drive sync covers both Money and Habits, including check-in history.

The visible app name is Rho Tracker. Existing native app IDs, OAuth redirect scheme, Google Drive namespace, and account storage keys stay unchanged so upgrades and Google sign-in keep working. The npm package still uses the historical `money-tracker` name; it is not the app's display name.

## Habits

1. Open **Habit Tracker** below Money, then tap **Add habit**.
2. Enter a name, such as Workout, and choose **Build a good habit** or **Avoid a bad habit**.
3. Pick the days. Mon, Tue, Thu, and Fri are selected by default, giving a four-day weekly goal. **Every day** selects all seven.
4. In **Weekly**, check each scheduled day when you did the good habit or avoided the bad one. Checking all scheduled days completes that week's goal.
5. Switch to **Daily** for the selected day's habits. Use the arrows to browse days or weeks and review past check-ins.
6. **Edit** changes the name and schedule without discarding check-ins. The good/bad type stays fixed to preserve their meaning. **Delete** asks before removing a habit and its history.

New habits start at the beginning of the current week. You can check today or a past scheduled day, but not future days. Each check-in stores both the habit date and the time it was checked. Unchecking removes that check-in. Bad habits use an unchecked day for an occurrence or a day not yet checked; this first version does not distinguish the two.

Habits and Money share the active account and sync status. In device-only mode they remain local until explicitly copied to a Google account. In account mode they save locally first and sync together as one complete snapshot. A conflict choice replaces both Money and Habits; it is not a merge. Clearing app data or uninstalling can erase unsynced changes.

Existing device habits are not automatically assigned to an account. For an empty account, use **Copy device-only data**. If your account already has Money but no habits, use **Copy device-only habits** to preserve its balances and payments. This is available in **Google Drive** on the home screen or within either section. Copying never deletes the separate device-only data, and importing habits is disabled once the account has habits to avoid overwriting history.

## Requirements

- A current Node.js LTS release and npm: https://nodejs.org/
- For device-only testing: Expo Go compatible with this project's Expo SDK 58.
- For Google sign-in: a native development build or APK and your own Google OAuth client IDs. Expo Go cannot run native Google sign-in.
- Your computer and phone connected to the same Wi-Fi network for the default connection method.

You do not need Android Studio or Xcode to run the app on a physical phone using Expo Go.

## Run On Your Phone

### 1. Open the project

Open a terminal in the project folder. On Windows PowerShell:

```powershell
cd "C:\Personal Projects\Rho-Tracker"
```

### 2. Install dependencies

Run this for the first setup, or after dependencies change:

```bash
npm install
```

### 3. Start Expo

```bash
npm start -- --go
```

Keep the terminal open while developing. Expo displays a QR code.

### 4. Open the app

- **Android:** Open Expo Go and scan the QR code.
- **iPhone:** Scan the QR code with the Camera app, then tap the link to open Expo Go.

The first load may take a little time while Expo bundles the app. Changes to your code normally appear automatically through Fast Refresh.

To stop the development server, press `Ctrl+C` in the terminal. To run it again later in Expo Go, use `npm start -- --go`; you do not need to reinstall dependencies each time. Use `npm start -- --dev-client` with a native development build instead.

## Use The App

1. Open **Money** from Rho Tracker, then tap the **Current balance** card to open the **Money Sources** screen. Use **< Balance** or Android's back button to return.
2. Tap **Add source** and enter a name, such as Bank A or Cash.
3. Enter its amount in IDR. Thousands dots appear automatically as you type: `1000` becomes `1.000`, and `1000000` becomes `1.000.000`. Enter a comma yourself for up to two decimal places, for example `1.250,50`. Negative source balances are supported.
4. Tap **Save**. Bank A with 1000 and Bank B with 2000 produce a current balance of 3000.
5. Use **Edit** to set a source's current balance or change its name. **Delete** asks for confirmation; sources still selected by income/payment items or entries cannot be deleted until those references are cleared or moved.

The initial balance is zero and IDR is the only currency. Balances use Indonesian formatting, for example `Rp 1.250,50`. Two decimal places are retained so existing fractional balances are not rounded away.

Existing version 1 balances (USD, EUR, GBP, PHP, INR, CAD, or AUD) and version 2 IDR balances become one source named **My money**. Every integer hundredth, including zero and negative values, and the last-updated timestamp are preserved. Legacy currencies are relabeled as IDR without exchange-rate conversion. Migration happens in memory; the first successful save writes the combined money data described below, leaving the older keys untouched. Invalid or unsupported data blocks editing and offers a retry without overwriting storage.

Names must contain 1 to 80 characters after trimming. Each amount must be smaller than 10 billion rupiah in magnitude. Totals must fit within JavaScript's safe integer range in hundredths. The balance is derived, not separately editable. Failed saves retain the previous list and total; repeated submissions are blocked while saving.

The same live formatting is used for balance sources, recurring income/payments, and individual entries. It does not automatically add a decimal comma or fractional digits while typing. Grouped values can be pasted. On keyboards that show a dot as their decimal key, pressing that key inserts a decimal comma. Grouping is display-only; storage and balance calculations still use exact integer hundredths.

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

## Google Sign-In And Drive Sync

### Cost And Storage

Google currently provides standard Drive API use at no additional cost within its quotas. A personal money tracker uses very little quota. Your JSON snapshots count toward your Google account's storage; the standard free allowance is 15 GB shared with Drive, Gmail, and Photos. More storage can cost money, and API terms can change. No paid sign-in library, Firebase subscription, or app server is required.

Official references: [Drive API usage limits and pricing](https://developers.google.com/workspace/drive/api/guides/limits), [Google account storage](https://support.google.com/drive/answer/6374270), and [private app data](https://developers.google.com/workspace/drive/api/guides/appdata). Pricing was checked on November 12, 2026. EAS cloud builds have separate free-tier limits; building locally with Android Studio does not require an EAS subscription. Sideloading an APK does not require a paid Play Store developer account.

Drive files live in its **private app-data folder**, not ordinary My Drive folders. The app requests only `drive.appdata` in addition to normal Google identity access, not permission to read all your files. Data travels over HTTPS, but this app does not add its own encryption to JSON backups. History is retained as immutable snapshots and uses storage; automatic history cleanup is not implemented.

### How It Behaves

1. Open **Google Drive** on the home screen or Money dashboard and select **Sign in with Google**.
2. If that account already has Drive data, it is restored automatically, unless local edits conflict with it.
3. If the account is new, it starts empty. **Copy device-only data** explicitly copies your existing balances, trackers, habits, and check-ins to that account. For an existing Money account with no habits, **Copy device-only habits** copies just habits and check-ins. The original device-only copy is kept.
4. Changes save locally first. Sync runs after changes, on account activation, and when the app returns to the foreground. Use **Sync now** to retry after going online.
5. Offline changes stay queued in that account's local cache. Network errors never replace data with an empty dataset.
6. If two devices changed the same starting version, choose **Use this device version** or a specific **Drive version**. This is a whole-data choice, not a merge. Choosing a Drive version replaces unsynced local edits only after confirmation. Unresolved conflicts remain blocked after restarting or switching accounts; **Sync now** can check whether another device already resolved them.
7. **Sign out / use device-only data** returns to your separate device-only dataset. It does not delete account caches, queued edits, or Drive files. Signing into another account never copies the previous account's data into it.

Sync is paused while a Money or Habit editor or delete confirmation is open, so a downloaded version cannot overwrite an unfinished form. Closing the form allows queued sync to resume. Editing both sections is briefly disabled while a sync/account operation is running. Conflicts must be resolved, or you can sign out, before editing account data again. Sync does not run while the app is closed, and reconnecting while it stays in the foreground may require **Sync now** or returning to the app.

The repository implements sync; it does not prove your phone's data has been uploaded. Check that the intended Google account is active, that no local changes are waiting and no error/conflict is shown, then use **Sync now** and check the last successful sync time. A restore on a second configured device is the end-to-end verification. A new APK/native build is needed to install this update; all devices sharing the account should upgrade before syncing the new format. Older builds reject the new data version instead of discarding habits.

Google account details are display metadata, not authorization. Access tokens are obtained/refreshed through the native SDK and the current Google identity is checked before Drive requests. Tokens and client secrets are not saved in the money JSON or AsyncStorage. Cached account data is still unencrypted local app storage; clearing/uninstalling can erase unsynced changes.

### One-Time Google Setup

This repository cannot supply credentials for your Google account. Complete these steps once before testing sign-in. Device-only mode works without them.

**1. Create a Google Cloud project and enable Drive**

Open [Google Cloud Console](https://console.cloud.google.com/), create/select a project, and enable **Google Drive API** in the API Library. Firebase is not needed.

**2. Configure Google Auth Platform**

Set up Branding, Audience, and Data Access (the OAuth consent screen). For personal use, use External/Testing and add your own Google email as a test user. Include the `https://www.googleapis.com/auth/drive.appdata` scope along with the normal sign-in identity scopes. Testing mode has user restrictions and can require reauthorization after grants expire; sign in again if the app requests it. Publishing to a broader audience can require additional Google review or branding setup.

**3. Create a Web application OAuth client**

Under Clients/Credentials, create a **Web application** client in that project. Its public client ID goes in the project-root `.env`:

```dotenv
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=YOUR_WEB_CLIENT_ID.apps.googleusercontent.com
```

Use the actual ID Google issues, not the placeholder. This is a public identifier included in the app, **not a client secret**. Do not put client secrets, access tokens, or service-account keys in the app. `.env.example` lists the supported variables and `.env` is gitignored.

**4. Register the Android package and signing SHA-1**

Create an **Android OAuth client** in the same project with package **`com.moneytracker.app`** and the SHA-1 of the certificate that actually signs your installed build. The Android client ID itself is not used as `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`.

For EAS APKs, inspect the project's signing credentials with `npx eas-cli@latest credentials --platform android`. For local debug builds, first generate native files with `npx expo prebuild --platform android`, then inspect the generated app's debug keystore (if that is the keystore used by its Gradle configuration):

```powershell
keytool -list -v -keystore "android/app/debug.keystore" -alias androiddebugkey -storepass android -keypass android
```

Register each certificate you actually use: local debug, EAS preview/release, and Play App Signing can all differ. A package/SHA-1 mismatch prevents sign-in. With the explicit Web client ID, this Android setup uses native autolinking and does not need Firebase or `google-services.json`.

**5. Build and install the native app**

For local Android development, install Android Studio, an Android SDK, and a compatible JDK. Then:

```bash
npx expo run:android
```

This generates and installs a development build. Afterward, start the development server with `npm start -- --dev-client`. Generated `android/` and `ios/` folders are gitignored; keep configuration in `app.json` / `app.config.js`.

Alternatively, create an EAS account, link this project using the EAS CLI setup, and build a standalone APK using the included profile:

```bash
npx eas-cli@latest build --platform android --profile preview
```

Before building, open `eas.json` and replace `PASTE_YOUR_WEB_CLIENT_ID_HERE` at `build.preview.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` with the complete **Web application Client ID** from Google, including `.apps.googleusercontent.com`. This lets the APK build use your ID without configuring Expo's website. Do not use the Android client ID or a client secret. The client ID is public and safe to include in this config.

If you prefer the EAS website's **preview** environment variable instead, remove the matching `env` entry from `eas.json` so it does not override your website value. Local `.env` files are gitignored and should not be assumed to reach a cloud build. For the development profile, set the same variable in the **development** EAS environment or your local development `.env`.

Install the resulting APK on the phone. A standalone APK does not require Expo Go or the development server. Internet is needed for sign-in and sync, but cached account/device data works offline.

**Optional iOS setup**

Create an iOS OAuth client in the same project for bundle ID `com.moneytracker.app`. Set `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` as well as the Web ID. `app.config.js` registers the reversed iOS URL scheme and native sign-in plugin when the iOS ID is configured. Rebuild on macOS/EAS after configuration changes. iOS native sign-in still needs device testing; Apple build/distribution requirements and fees are separate from Google's API pricing.

Expo SDK 58 builds adopting the UIKit scene lifecycle also need OAuth URL forwarding to `GIDSignIn` in `SceneDelegate`, including cold-launch URLs. Follow the library's [iOS redirect forwarding guide](https://react-native-nitro-google-sign-in.github.io/docs/setup/ios#appdelegate-handle-oauth-redirect-urls) before using iOS sign-in. This repository configures the URL scheme and pods, but does not generate a custom SceneDelegate forwarder. The primary setup above targets Android APKs; a successful iOS JavaScript export is not proof of working native iOS authentication.

**6. Test first sign-in and restore**

Open **Google Drive**, sign in, and grant private app-data access. For a new account, confirm **Copy device-only data** if you want your existing data uploaded. Wait for a successful sync before uninstalling or moving devices. On another correctly configured build using the same Google Cloud project, sign into the same Google account to restore the Drive version.

OAuth IDs are compiled into JavaScript at build time. Restart Metro after local `.env` changes, and rebuild a standalone APK for those changes to take effect. Live sign-in has not been verified in this repository environment because no real OAuth credentials or device were supplied.

## Run In An Emulator

### Android

Install Android Studio, configure an Android Virtual Device, and start the emulator. For the native app, first install a build using `npx expo run:android`. Once installed, run:

```bash
npm run android
```

### iOS

The iOS Simulator requires macOS and Xcode. On a Mac, install the native development build using `npx expo run:ios`, then run:

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
npm start -- --go --tunnel
```

Follow any Expo prompt to install its tunnel dependency, then scan the new QR code. Tunnel mode requires internet access and may be slower.

When using a native development build, replace `--go` with `--dev-client`.

### Expo Go reports an incompatible SDK

This project uses Expo SDK 58. Update Expo Go and check that it supports this SDK. See https://expo.dev/go for available versions and platform limitations. If a compatible Expo Go version is unavailable for your device, a compatible development build is required.

### Changes are not showing or Metro reports cache errors

Stop the server and restart with a cleared bundler cache:

```bash
npm start -- --go --clear
```

### PowerShell blocks npm.ps1

Use `npm.cmd` instead of `npm`, for example:

```powershell
npm.cmd install
npm.cmd start
```

## Git And Build Uploads

`app.json` and `eas.json` are local configuration files in this setup and are intentionally ignored by Git. Keep local backups; cloning the repository alone will not restore them. The separate `.easignore` explicitly includes these two files because EAS needs the app identity, project association, and build profile. Without that separate upload configuration, Git's ignore rules can cause prebuild failures.

Both ignore files exclude local `.env` files, `credentials.json`, `credentials/`, keystores, signing keys, client-secret JSON files, and service-account files. EAS uses its existing remote signing credentials instead of uploading local signing files with the source code.

Adding a name to `.gitignore` does not stop tracking files that were already committed. Those files must also be removed from Git's index with `git rm --cached`; this keeps their local copies. Existing Git history is not erased. If a real private key, password, or client secret was previously published, revoke/rotate it rather than relying on ignore rules.

OAuth client IDs and app identifiers are public identifiers embedded in the built app, not passwords. Ignoring them keeps them out of future source commits but does not encrypt or hide them inside an APK. Keep actual signing keys and client secrets private.

## Local Data Storage

- Device-only mode saves one JSON object using AsyncStorage under `@rho-tracker/data`, with app schema version 2, wallet version 3, trackers version 2, and habit data version 1.
- Signed-in accounts keep their existing separate envelopes at `@money-tracker/account/<encoded Google subject ID>`, with the complete Money and Habits dataset, dirty flag, revision ancestry, and last sync date. `@money-tracker/active-account` stores only the selected profile; no tokens. Each account has its own habit history.
- Balances, source selections, paid status, and recorded balance changes are saved together in one write. A failed save leaves both the balances and entries unchanged.
- If `@rho-tracker/data` is absent, migration reads the previous `@money-tracker/data` finance record and `@personal-tracker/habits` device habits. The older wallet/tracker keys are used only if the previous finance aggregate is absent. All old keys remain untouched as migration backups. Migration writes nothing until a successful edit. An invalid current aggregate never falls back to potentially stale backups.
- Legacy finance-only cloud snapshots restore with empty account habits. Device habits are copied only after confirmation. The Drive snapshot/cache envelope retains version 1, but its validated data payload is version 2; old clients reject this payload. Finance transformations operate only on Money and preserve Habits, and habit transformations preserve Money.
- Recurring entries are calculated when you view a year; only schedules and entries you explicitly change are stored. No background task is needed to generate them.
- The wallet contains `sources` (each with a stable `id`, `name`, and integer `amountMinor`), currency fixed to `IDR`, `updatedAt`, and `version`. Amounts remain in hundredths of a rupiah. No separate total is stored.
- Each tracker has `defaultSourceId`; saved entries can override `sourceId`. A paid entry's internal `applied` record remembers its signed balance change so edits, unpaying, and deletion can correct or reverse it without double-counting.
- Saving successfully updates both the stored data and the displayed balance.
- Data persists between app launches. Google sign-in and Drive sync are optional; no custom backend is required.
- This is app-private storage, not a user-visible JSON file in your Downloads folder.
- AsyncStorage is not encrypted. Clearing app data or uninstalling can delete your balance and trackers.
- When testing in Expo Go, data lives in Expo Go's storage rather than a separately installed Money Tracker app.

The balance functionality works without a backend. During development, Expo Go/dev clients need access to the development server to load JavaScript. The optional EAS preview profile produces an installable APK; a JavaScript export alone does not.

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
  components/AmountInput.js     Shared live IDR grouping and decimal input
  components/TrackerForm.js     Shared tracker form and fields
  components/TrackerEditor.js   Recurring item editing
  components/OccurrenceEditor.js Individual entry editing
  components/MoneySourcePicker.js Default and per-entry source selection
  screens/BalanceScreen.js      Main dashboard
  screens/MoneySourcesScreen.js Bank/cash source list and editing
  screens/TrackerScreen.js      Income/payment lists and entries
  screens/AccountScreen.js      Google sign-in, sync status and conflict choices
  hooks/useMoneyData.js         Shared application session and foreground sync
  hooks/useHabits.js            Habit view of the same account/session, no separate store
  storage/appStorage.js         Atomic Money + Habits device persistence and migration
  storage/moneyStorage.js       Legacy finance persistence, read during migration
  storage/cloudStorage.js       Per-account caches and active profile
  services/cloudSession.js      Offline-first account and sync controller
  services/cloudModel.js        Cloud/cache validation
  services/driveStorage.js      Private Drive JSON snapshot API
  services/googleAuth.js        Native sign-in and account verification
  config/google.js             Public OAuth IDs and runtime detection
  utils/finance.js              Linked balance updates and reversals
  utils/appData.js              Versioned aggregate and domain-preserving transformations
  utils/habits.js               Habit validation, schedules, and check-in history
  utils/money.js                Amount parsing and balance validation
  utils/trackers.js             Dates, recurrence and tracker validation
  theme.js                   Shared colors
tests/money.test.js           Validation, totals and migration tests
tests/finance.test.js         Linked balances, reversals and source validation
tests/trackers.test.js        Recurrence and tracker validation tests
tests/moneyStorage.test.js    Combined persistence, migration and failure protection
tests/trackerUi.test.js       Dashboard navigation and entry update handlers
tests/cloudSession.test.js    Account isolation, offline sync and conflict safety
tests/cloudStorage.test.js    Per-account envelope validation
tests/driveStorage.test.js    Drive requests, revision graphs and error handling
tests/googleAuth.test.js      Google identity, permissions and sanitized errors
tests/appConfig.test.js       Native OAuth configuration
tests/appData.test.js         Combined schema, migration, and failure protection
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

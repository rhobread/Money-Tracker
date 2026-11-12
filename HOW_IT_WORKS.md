# How Money Tracker Works

A guide to this project **without assuming you already know React**.

> **Start here:** The home screen is [src/screens/BalanceScreen.js](src/screens/BalanceScreen.js). It displays your current balance, Source of Income, and Payments.

## Contents

- [Where the app starts](#1-where-the-app-starts)
- [The tools we use](#2-the-tools-we-use)
- [Components and JSX](#3-components-and-jsx)
- [How to read a screen file](#4-how-to-read-a-screen-file)
- [How taps update the screen](#5-how-taps-update-the-screen)
- [Props, hooks, and refs](#6-props-hooks-and-refs)
- [How screens switch](#7-how-screens-switch)
- [How the balance is calculated](#8-how-the-balance-is-calculated)
- [How data is saved](#9-how-data-is-saved)
- [How repeating entries work](#10-how-repeating-entries-work)
- [Which file to edit](#11-which-file-to-edit)
- [Useful commands](#12-useful-commands)

## 1. Where The App Starts

The startup order is:

```text
index.js
    -> App.js
        -> src/screens/BalanceScreen.js
```

**[index.js](index.js)** tells Expo which component starts the app:

```javascript
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
```

**[App.js](App.js)** sets up the outer layout and displays the home screen:

```jsx
export default function App() {
	return (
		<SafeAreaProvider>
			<StatusBar style="dark" />
			<BalanceScreen />
		</SafeAreaProvider>
	);
}
```

- **`SafeAreaProvider`** supports keeping content clear of the phone's notch and system bars.
- **`StatusBar`** controls the appearance of the phone's top status bar.
- **`BalanceScreen`** is the home screen.

The home screen initially shows a **loading spinner** while it reads saved balance data. If loading fails, it shows an error and a **Try again** button instead of overwriting your data.

## 2. The Tools We Use

| Tool | What it does |
| --- | --- |
| **JavaScript** | The programming language used by this project. |
| **React** | Lets us describe interfaces using functions called components. |
| **React Native** | Provides mobile interface elements such as text, inputs, and tappable containers. |
| **Expo** | Provides tools to develop, run, and bundle the app. |
| **AsyncStorage** | Keeps saved data on the phone between launches. |

**This is not an HTML website.** React Native displays native interface elements rather than ordinary browser pages.

During development, `npm start` launches Expo's development server. Expo Go on your phone connects to it to load the app.

## 3. Components And JSX

A **component** is a function that describes part of the interface:

```jsx
function Greeting() {
	return <Text>Hello</Text>;
}
```

Writing `<Greeting />` displays that component. `BalanceScreen` works the same way, but returns an entire screen.

The HTML-looking syntax is called **JSX**. It lets us write interface elements alongside JavaScript.

| Component | Purpose |
| --- | --- |
| `View` | A container for other elements. |
| `Text` | Displays text. |
| `Pressable` | Something the user can tap. |
| `TextInput` | An input field. |
| `ScrollView` | A scrollable container. |
| `FlatList` | A scrollable list that renders rows as needed. |
| `Modal` | Displays an editor over the current screen. |

**Braces inside JSX contain JavaScript expressions:**

```jsx
<Text>{source.name}</Text>
```

This displays the value of `source.name`.

## 4. How To Read A Screen File

Open [BalanceScreen.js](src/screens/BalanceScreen.js) and read it in this order:

| Part | What to look for |
| --- | --- |
| **Imports** | Functions, interface components, and other files the screen uses. |
| **State and hooks** | Changing values, saved data, and loading/saving status. |
| **Functions** | Actions such as saving, deleting, and opening an editor. |
| **`return`** | The interface displayed on the phone. |
| **`styles`** | Colors, spacing, font sizes, and layout. |

For example, `style={styles.balanceCard}` applies the `balanceCard` style defined near the bottom of the file.

**Importing a screen does not display it.** It must also appear in the returned interface, such as `<TrackerScreen />`.

## 5. How Taps Update The Screen

React uses **state** for values that can change while the app runs.

Here is the actual state that controls which screen is open:

```javascript
const [page, setPage] = useState(null);
```

- **`page`** is the current value. It starts as `null`, meaning the dashboard.
- **`setPage(...)`** changes that value and tells React to update the interface.

The balance card handles a tap like this:

```jsx
onPress={() => setPage('sources')}
```

This selects the **Money Sources** screen instead of expanding a list on the dashboard.

The screen checks that value. This simplified example shows the pattern (the actual screen also passes data and save functions):

```jsx
if (page === 'sources') {
	return <MoneySourcesScreen onBack={() => setPage(null)} />;
}
```

**The key idea:** Change the state, and React updates the interface. You do not manually refresh the page or modify individual interface elements.

A state update makes React run the component again to work out what should be displayed. **It does not restart the whole app.**

> **State is not permanent storage.** `useState` alone does not save anything to the phone. The currently open screen is temporary interface state.

## 6. Props, Hooks, And Refs

### Props: Arguments For A Component

**Props** are values passed into a component, similar to function arguments:

```jsx
<TrackerScreen kind="income" onBack={goBack} />
```

- **`kind`** tells the component which items to display.
- **`onBack`** passes a function it can call when the user goes back.

A function passed to something else to call later is a **callback**. `onPress` runs when an element is tapped; `onSave` lets an editor ask its parent to save entered values.

### Hooks: Managing Data And Work

| Hook | Purpose in this app |
| --- | --- |
| `useState` | Holds changing values and updates the interface when they change. |
| `useEffect` | Runs work after rendering, including the initial storage load. |
| `useRef` | Holds a value without triggering an interface update; used to block repeated actions. |

`useMoneyData` is a **custom hook**: a reusable function built using React's hooks. The dashboard calls it once and passes data and save functions to the other screens. This gives balances and paid entries one shared source of truth and one save lock.

For example, this hook starts loading saved data when it is first mounted:

```javascript
useEffect(() => {
	reload();
}, []);
```

The empty `[]` means this effect does not rerun just because the screen's state changes.

## 7. How Screens Switch

**This app currently uses state to switch screens.** It does not use website URLs or a navigation/routing library.

The home screen stores:

```javascript
const [page, setPage] = useState(null);
```

| Value | What is shown |
| --- | --- |
| `null` | Balance dashboard. |
| `'sources'` | Money Sources, opened by tapping the balance card. |
| `'income'` | Source of Income. |
| `'payment'` | Payments. |

Tapping the balance card calls `setPage('sources')`, and the dashboard returns `MoneySourcesScreen`. Tapping an income/payment card sets the corresponding page and returns `TrackerScreen` instead.

**Income and Payments share the same screen code.** The `kind` prop tells it which list to show, avoiding duplicated code.

Going back to the dashboard sets `page` to `null`.

Inside `TrackerScreen`, **`selectedId`** determines whether you see the item list or one item's recurring entries. Going back from the entries returns to the list.

Editing forms appear in **modals**, over the current screen.

## 8. How The Balance Is Calculated

Your current balance is the **sum of your money sources**:

| Source | Amount |
| --- | ---: |
| Bank A | Rp1.000 |
| Bank B | Rp2.000 |
| **Current balance** | **Rp3.000** |

The app stores the individual sources, **not a separate editable total**.

```javascript
formatMoney(totalMinor(wallet.sources))
```

- **`totalMinor(...)`** adds the amounts.
- **`formatMoney(...)`** displays the result as Indonesian rupiah.

Amounts are stored as integers in **hundredths of a rupiah** to avoid common floating-point calculation errors:

```text
Displayed: Rp1.000,00
Stored:    amountMinor: 100000
```

Input and display conversion are handled by [money.js](src/utils/money.js). Only IDR is supported; no exchange-rate conversion takes place.

## 9. How Data Is Saved

Money data is separated into interface, state, calculation, and storage layers:

```text
BalanceScreen.js / MoneySourcesScreen.js / TrackerScreen.js
    Display data and handle taps
        |
        v
useMoneyData.js
    Shares the loaded wallet, trackers, and saving status
        |
        v
finance.js
    Validates changes and calculates balance adjustments
        |
        v
moneyStorage.js
    Saves wallet and trackers together as JSON using AsyncStorage
```

When you save a source:

1. The editor validates the entered name and amount.
2. The screen builds the updated source list.
3. The storage layer saves the wallet and trackers together as one JSON object.
4. After saving succeeds, the shared money state is updated.
5. React updates the displayed balance.

**`await`** waits for a storage operation to finish. **`try/catch`** handles failures. **`finally`** clears the saving flag whether the save succeeds or fails.

If saving fails, the previous list and balance remain unchanged. If loading fails, the app does not silently replace stored data with an empty wallet.

Marking an income/payment entry paid goes through the same hook. `finance.js` calculates the source balance adjustment, then both the new balance and paid status are saved in **one write**. A failed save cannot leave one updated without the other.

### What Is Stored Where?

| Storage key | Contents |
| --- | --- |
| `@money-tracker/data` | Current wallet and income/payment schedules, paid entries, source selections, and recorded balance changes. |
| `@money-tracker/wallet` | Older balance data, read only when migrating and kept untouched afterward. |
| `@money-tracker/trackers` | Older tracker data, read only when migrating and kept untouched afterward. |

On the first load after upgrading, older data is migrated in memory without writing anything. The first successful user change saves the combined record. Once that record exists, the app does not fall back to old backups if the current data cannot be read.

**`JSON.stringify(...)`** converts an object into a JSON string for saving. **`JSON.parse(...)`** turns that string back into a JavaScript value when loading.

> **Storage limits:** This is app-private storage, not a visible JSON file in Downloads. It persists between launches, but is not encrypted or backed up by this app. Clearing app storage or uninstalling can delete it. In Expo Go, the data lives within Expo Go's storage.

## 10. How Repeating Entries Work

A recurring item contains a **name, amount, repeat frequency, first due date, default money source**, and any entries you have manually changed.

For example:

| Setting | Value |
| --- | --- |
| Name | Kontrakan Fatra |
| Amount | Rp1.000.000 |
| Repeat | Monthly |
| First due date | 2026-01-05 |
| Default money source | Bank A |

The app calculates entries for January 5, February 5, March 5, and so on.

The calculations live in [trackers.js](src/utils/trackers.js). Entries are calculated for the selected year when viewed. **No background job is needed**, and thousands of untouched entries do not need to be saved.

| Frequency | Rule |
| --- | --- |
| Daily | Every day from the first due date. |
| Weekly | The same weekday each week. |
| Monthly | The same day number, using the last day of a shorter month when needed. |
| Yearly | The same month and day; February 29 uses February 28 in non-leap years. |

Year and month controls select which entries you view.

### Paid Status And Manual Changes

- Tap **Paid** to save the paid status and today's date. Income adds to its money source; payments subtract from it.
- Tap **Edit** to change an entry's amount, due date, paid status, paid date, or money source. A per-entry selection overrides the item's default.
- Uncheck **Paid** to mark it unpaid, clear its paid date, and reverse the recorded balance change.
- Unpaid entries past their due date show **Overdue**.

Manual changes are stored against the entry's **original scheduled date**, so they can be restored later, even if the repeat schedule changes. The entry also stays in that original scheduled year/month when filtering, even if you move its due date into another period.

### How Double-Counting Is Prevented

Each newly paid entry stores an internal **`applied` snapshot**: the actual source ID and signed amount already added or deducted. Saving the same paid entry again makes no additional balance change. Editing the paid amount applies only the difference. Selecting another source reverses the old source's change and applies the updated amount to the new one.

Paid entries keep their chosen source even if the item's default changes. The new default applies to entries that still inherit it. Deleting a recurring item reverses its recorded balance changes after confirmation. A money source cannot be deleted while items or entries still reference it.

**Older paid entries are preserved without changing balances**, because you may already have included them manually. They show a note. To explicitly include one now, save it as unpaid, then mark it paid again with a source selected. Editing its dates, amount, or source while it remains paid does not automatically count it.

> **Local tracking only:** These actions update your saved balances in the app. They do not connect to a bank or transfer actual money. Manually editing a money source sets its current balance; later reversals add or subtract the recorded amount from that current balance, rather than restoring an old balance.

## 11. Which File To Edit

| What you want to change | File |
| --- | --- |
| Outer setup and starting screen | [App.js](App.js) |
| Home screen, balance card, tracker cards | [BalanceScreen.js](src/screens/BalanceScreen.js) |
| Money source list and editing | [MoneySourcesScreen.js](src/screens/MoneySourcesScreen.js) |
| Income/payment lists, entries, year/month selection | [TrackerScreen.js](src/screens/TrackerScreen.js) |
| Bank/cash source editing | [SourceEditor.js](src/components/SourceEditor.js) |
| Recurring item editing | [TrackerEditor.js](src/components/TrackerEditor.js) |
| One entry's amount, due date, or paid details | [OccurrenceEditor.js](src/components/OccurrenceEditor.js) |
| Shared tracker form, fields, and checkbox | [TrackerForm.js](src/components/TrackerForm.js) |
| Default and per-entry source picker | [MoneySourcePicker.js](src/components/MoneySourcePicker.js) |
| Shared balance/tracker loading and saving state | [useMoneyData.js](src/hooks/useMoneyData.js) |
| Combined JSON storage and migration | [moneyStorage.js](src/storage/moneyStorage.js) |
| Balance adjustments, reversals, and source references | [finance.js](src/utils/finance.js) |
| Amount parsing, formatting, totals, validation | [money.js](src/utils/money.js) |
| Date validation and repeat calculations | [trackers.js](src/utils/trackers.js) |
| Shared colors | [theme.js](src/theme.js) |
| Automated checks | [tests/](tests/) |

## 12. Useful Commands

Run these from the project folder:

| Command | Purpose |
| --- | --- |
| `npm install` | Install dependencies after cloning or when dependencies change. |
| `npm start` | Start Expo, then open the QR code with a compatible Expo Go app. |
| `Ctrl+C` | Stop Expo in the terminal where it is running. |
| `npm test` | Run automated tests. |
| `npm run format` | Format JavaScript and JSON files using tabs. |
| `npm run format:check` | Check formatting without changing files. |

See [README.md](README.md) for full setup instructions and troubleshooting.

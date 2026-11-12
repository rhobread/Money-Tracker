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

Here is the actual state that controls whether your money sources are visible:

```javascript
const [showSources, setShowSources] = useState(false);
```

- **`showSources`** is the current value. It starts as `false`.
- **`setShowSources(...)`** changes that value and tells React to update the interface.

The balance card handles a tap like this:

```jsx
onPress={() => setShowSources((shown) => !shown)}
```

That switches **false to true**, or **true to false**.

The source section is only displayed when the value is true. This simplified example shows the pattern:

```jsx
{showSources && (
	<View>
		<Text>Money sources</Text>
	</View>
)}
```

**The key idea:** Change the state, and React updates the interface. You do not manually refresh the page or modify individual interface elements.

A state update makes React run the component again to work out what should be displayed. **It does not restart the whole app.**

> **State is not permanent storage.** `useState` alone does not save anything to the phone. Values such as the currently open screen and expanded source list are temporary interface state.

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

`useWallet` and `useTrackers` are **custom hooks**: reusable functions built using React's hooks. They keep storage and saving logic out of the screens.

For example, the wallet hook starts loading saved data when it is first mounted:

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
const [trackerKind, setTrackerKind] = useState(null);
```

| Value | What is shown |
| --- | --- |
| `null` | Balance dashboard. |
| `'income'` | Source of Income. |
| `'payment'` | Payments. |

Tapping a tracker card calls `setTrackerKind(...)`. When that value is set, `BalanceScreen` returns `TrackerScreen` instead of the dashboard interface.

**Income and Payments share the same screen code.** The `kind` prop tells it which list to show, avoiding duplicated code.

Going back sets `trackerKind` to `null`.

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

Balance data is separated into three layers:

```text
BalanceScreen.js
    Displays data and handles taps
        |
        v
useWallet.js
    Manages the loaded wallet and saving status
        |
        v
walletStorage.js
    Reads and writes JSON on the phone using AsyncStorage
```

When you save a source:

1. The editor validates the entered name and amount.
2. The screen builds the updated source list.
3. The storage layer saves the wallet as JSON.
4. After saving succeeds, the wallet state is updated.
5. React updates the displayed balance.

**`await`** waits for a storage operation to finish. **`try/catch`** handles failures. **`finally`** clears the saving flag whether the save succeeds or fails.

If saving fails, the previous list and balance remain unchanged. If loading fails, the app does not silently replace stored data with an empty wallet.

Income and Payments use the same approach through `useTrackers.js` and `trackerStorage.js`.

### What Is Stored Where?

| Storage key | Contents |
| --- | --- |
| `@money-tracker/wallet` | Your current bank/cash sources and balance-related data. |
| `@money-tracker/trackers` | Income/payment schedules and manually edited entries. |

**`JSON.stringify(...)`** converts an object into a JSON string for saving. **`JSON.parse(...)`** turns that string back into a JavaScript value when loading.

> **Storage limits:** This is app-private storage, not a visible JSON file in Downloads. It persists between launches, but is not encrypted or backed up by this app. Clearing app storage or uninstalling can delete it. In Expo Go, the data lives within Expo Go's storage.

## 10. How Repeating Entries Work

A recurring item contains a **name, amount, repeat frequency, first due date**, and any entries you have manually changed.

For example:

| Setting | Value |
| --- | --- |
| Name | Kontrakan Fatra |
| Amount | Rp1.000.000 |
| Repeat | Monthly |
| First due date | 2026-01-05 |

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

- Tap **Paid** to save the paid status and today's date.
- Tap **Edit** to change an entry's amount, due date, paid status, or paid date.
- Uncheck **Paid** to mark it unpaid and clear its paid date.
- Unpaid entries past their due date show **Overdue**.

Manual changes are stored against the entry's **original scheduled date**, so they can be restored later, even if the repeat schedule changes. The entry also stays in that original scheduled year/month when filtering, even if you move its due date into another period.

> **Tracking only:** Marking income or a payment as paid does not change your current balance, connect to a bank, or transfer money. Update balance sources separately.

## 11. Which File To Edit

| What you want to change | File |
| --- | --- |
| Outer setup and starting screen | [App.js](App.js) |
| Home screen, balance card, source list, tracker cards | [BalanceScreen.js](src/screens/BalanceScreen.js) |
| Income/payment lists, entries, year/month selection | [TrackerScreen.js](src/screens/TrackerScreen.js) |
| Bank/cash source editing | [SourceEditor.js](src/components/SourceEditor.js) |
| Recurring item editing | [TrackerEditor.js](src/components/TrackerEditor.js) |
| One entry's amount, due date, or paid details | [OccurrenceEditor.js](src/components/OccurrenceEditor.js) |
| Shared tracker form, fields, and checkbox | [TrackerForm.js](src/components/TrackerForm.js) |
| Balance loading and saving state | [useWallet.js](src/hooks/useWallet.js) |
| Income/payment loading and saving state | [useTrackers.js](src/hooks/useTrackers.js) |
| Balance JSON storage | [walletStorage.js](src/storage/walletStorage.js) |
| Income/payment JSON storage | [trackerStorage.js](src/storage/trackerStorage.js) |
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

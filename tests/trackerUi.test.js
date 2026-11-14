const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { transformFileSync } = require('@babel/core');
const {
	validateFinanceData,
	saveRecurringEntry,
	saveRecurringItem,
	deleteRecurringItem,
	updateMoneySources,
} = require('../src/utils/finance');

// Exercise screen handlers without a simulator; native components stay as plain elements.
function screen(modulePath, modules) {
	const states = [];
	const refs = [];
	let stateIndex;
	let refIndex;
	let layouts;
	const react = {
		useState(initial) {
			const index = stateIndex++;
			if (!(index in states))
				states[index] = typeof initial === 'function' ? initial() : initial;
			return [
				states[index],
				(value) => {
					states[index] = typeof value === 'function' ? value(states[index]) : value;
				},
			];
		},
		useRef(initial) {
			const index = refIndex++;
			return refs[index] ?? (refs[index] = { current: initial });
		},
		useEffect() {},
		useLayoutEffect(effect) {
			layouts.push(effect);
		},
	};
	const native = Object.fromEntries(
		[
			'ActivityIndicator',
			'FlatList',
			'Image',
			'KeyboardAvoidingView',
			'Modal',
			'Pressable',
			'ScrollView',
			'Text',
			'TextInput',
			'View',
		].map((name) => [name, name]),
	);
	native.Platform = { OS: 'android' };
	native.StyleSheet = { create: (value) => value };
	native.Alert = { alert() {} };
	native.BackHandler = { addEventListener: () => ({ remove() {} }) };
	Object.assign(native, modules['react-native']);
	const exports = {};
	const code = transformFileSync(require.resolve(modulePath), {
		babelrc: false,
		configFile: false,
		plugins: [
			['@babel/plugin-transform-react-jsx', { pragma: 'element', pragmaFrag: 'fragment' }],
			'@babel/plugin-transform-modules-commonjs',
		],
	}).code;
	vm.runInNewContext(code, {
		exports,
		element: (type, props, ...children) => ({ type, props: { ...props, children } }),
		fragment: 'Fragment',
		require: (name) => {
			if (name === 'react') return react;
			if (name === 'react-native') return native;
			if (name === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView' };
			if (name === '../theme') return { colors: {} };
			if (name in modules) return modules[name];
			if (name === './AmountInput') return { AmountInput: 'AmountInput' };
			if (name === '../utils/money') return require('../src/utils/money');
			if (name === '../utils/trackers') return require('../src/utils/trackers');
			if (name === '../utils/habits') return require('../src/utils/habits');
			throw new Error(`Unexpected import: ${name}`);
		},
	});
	return (props) => {
		stateIndex = 0;
		refIndex = 0;
		layouts = [];
		const name = modulePath.split('/').pop().replace('.js', '');
		const tree = exports[name](props);
		for (const effect of layouts) effect();
		return tree;
	};
}

function nodes(tree) {
	if (Array.isArray(tree)) return tree.flatMap(nodes);
	if (!tree || typeof tree !== 'object') return [];
	return [tree, ...nodes(tree.props?.children)];
}

function text(tree) {
	if (Array.isArray(tree)) return tree.map(text).join(' ');
	if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
	return tree ? text(tree.props?.children) : '';
}

function amountInput(initial = '') {
	let raw = initial;
	let caret;
	const render = screen('../src/components/AmountInput.js', {});
	const current = () => {
		const tree = render({
			value: raw,
			onChangeText: (next) => {
				raw = next;
			},
		});
		tree.props.ref.current = {
			setNativeProps: (props) => {
				caret = props.selection.start;
			},
		};
		return tree;
	};
	function edit(text, start, end = start, key) {
		const tree = current();
		tree.props.onSelectionChange({ nativeEvent: { selection: { start, end } } });
		if (key) tree.props.onKeyPress({ nativeEvent: { key } });
		tree.props.onChangeText(text);
		const next = current();
		return { raw, display: next.props.value, caret };
	}
	return { current, edit };
}

test('amount input groups digits as typed while passing ungrouped state to the parent', () => {
	const input = amountInput();
	for (const [typed, start, display, raw] of [
		['1', 0, '1', '1'],
		['10', 1, '10', '10'],
		['100', 2, '100', '100'],
		['1000', 3, '1.000', '1000'],
		['1.0000', 5, '10.000', '10000'],
	]) {
		const result = input.edit(typed, start, start, '0');
		assert.equal(result.display, display);
		assert.equal(result.raw, raw);
		assert.equal(result.caret, display.length);
	}
});

test('amount input preserves manual decimal comma and rejects a third fractional digit', () => {
	const input = amountInput('1000');
	assert.equal(input.edit('1.000,', 5, 5, ',').display, '1.000,');
	assert.equal(input.edit('1.000,5', 6, 6, '5').display, '1.000,5');
	assert.equal(input.edit('1.000,50', 7, 7, '0').raw, '1000,50');
	const rejected = input.edit('1.000,501', 8, 8, '1');
	assert.equal(rejected.raw, '1000,50');
	assert.equal(rejected.display, '1.000,50');
	assert.equal(rejected.caret, 8);
	assert.equal(require('../src/utils/money').parseAmount(rejected.raw), 100050);
});

test('amount input supports selection replacement, paste, leading comma, and clearing', () => {
	const input = amountInput('5800000,00');
	assert.equal(input.edit('2000', 0, 12).display, '2.000');
	assert.equal(input.edit('1.234.567,89', 0, 5).raw, '1234567,89');
	assert.equal(input.edit('', 0, 12).raw, '');
	const fraction = input.edit(',', 0, 0, ',');
	assert.equal(fraction.display, '0,');
	assert.equal(fraction.caret, 2);
	assert.equal(input.edit('0,5', 2, 2, '5').raw, '0,5');
});

test('amount input skips a deleted grouping dot and preserves a middle cursor across regrouping', () => {
	const input = amountInput('1000');
	const skip = input.edit('1000', 2, 2, 'Backspace');
	assert.equal(skip.raw, '1000');
	assert.equal(skip.display, '1.000');
	assert.equal(skip.caret, 1);
	const middle = input.edit('10.000', 1, 1, '0');
	assert.equal(middle.raw, '10000');
	assert.equal(middle.display, '10.000');
	assert.equal(middle.caret, 2);
	const removed = input.edit('10.00', 6, 6, 'Backspace');
	assert.equal(removed.raw, '1000');
	assert.equal(removed.display, '1.000');
	assert.equal(removed.caret, 5);
});

test('a phone decimal-dot key enters a manual comma, but pasted dots remain thousands separators', () => {
	const input = amountInput();
	assert.equal(input.edit('1.000', 0).raw, '1000');
	const decimal = input.edit('1.000.', 5, 5, '.');
	assert.equal(decimal.raw, '1000,');
	assert.equal(decimal.display, '1.000,');
	assert.equal(decimal.caret, 6);
	assert.equal(input.edit('1.000,5', 6, 6, '5').raw, '1000,5');
});

test('decimal-dot pastes keep their value and malformed separators never become another amount', () => {
	const input = amountInput();
	const pasted = input.edit('1250.50', 0);
	assert.equal(pasted.raw, '1250,50');
	assert.equal(pasted.display, '1.250,50');
	assert.equal(pasted.caret, 8);
	assert.equal(require('../src/utils/money').parseAmount(pasted.raw), 125050);
	const invalid = input.edit('1,2.3', 0, 8);
	assert.equal(invalid.raw, '1250,50');
	assert.equal(invalid.display, '1.250,50');
});

test('forward delete skips a grouping dot and the next delete can remove its following digit', () => {
	const input = amountInput('1000');
	const skip = input.edit('1000', 1, 1, 'Delete');
	assert.equal(skip.display, '1.000');
	assert.equal(skip.caret, 2);
	const remove = input.edit('1.00', 2, 2, 'Delete');
	assert.equal(remove.raw, '100');
	assert.equal(remove.caret, 1);
});

test('normalizing a removed leading zero does not move the cursor across remaining digits', () => {
	const input = amountInput('1234');
	const replacement = input.edit('0.234', 0, 1, '0');
	assert.equal(replacement.raw, '234');
	assert.equal(replacement.caret, 0);
	const typed = input.edit('5234', 0, 0, '5');
	assert.equal(typed.display, '5.234');
	assert.equal(typed.caret, 1);
});

test('source editor uses shared amount input and saves the exact ungrouped value', async () => {
	let saved;
	const render = screen('../src/components/SourceEditor.js', {});
	const props = {
		source: { id: 'a', name: 'Bank A', amountMinor: 125050 },
		saving: false,
		onClose: () => {},
		onSave: async (value) => {
			saved = value;
			return true;
		},
	};
	let tree = render(props);
	const input = nodes(tree).find((node) => node.type === 'AmountInput');
	assert.equal(input.props.value, '1250,50');
	input.props.onChangeText('2000,50');
	tree = render(props);
	await nodes(tree)
		.find((node) => node.props.accessibilityLabel === 'Save source')
		.props.onPress();
	assert.equal(saved.name, 'Bank A');
	assert.equal(saved.amountMinor, 200050);
});

test('dashboard opens separate money sources, income, and payment screens', () => {
	const renderScreen = screen('../src/screens/BalanceScreen.js', {
		'./TrackerScreen': { TrackerScreen: 'TrackerScreen' },
		'./MoneySourcesScreen': { MoneySourcesScreen: 'MoneySourcesScreen' },
		'./AccountScreen': { AccountScreen: 'AccountScreen' },
	});
	const render = () =>
		renderScreen({
			money: {
				data: { wallet: { sources: [] }, trackers: { version: 2, items: [] } },
				loading: false,
				saving: false,
			},
		});
	let tree = render();
	assert.doesNotMatch(text(tree), /Add source/);
	assert.match(text(tree), /Source of Income/);
	assert.match(text(tree), /Payments/);
	nodes(tree)
		.find((node) => node.props.accessibilityLabel === 'Current balance')
		.props.onPress();
	tree = render();
	assert.equal(tree.type, 'MoneySourcesScreen');
	assert.doesNotMatch(text(tree), /Source of Income/);
	tree.props.onBack();
	tree = render();
	nodes(tree)
		.find((node) => node.type === 'Pressable' && text(node).includes('Source of Income'))
		.props.onPress();
	tree = render();
	assert.equal(tree.type, 'TrackerScreen');
	assert.equal(tree.props.kind, 'income');
	tree.props.onBack();
	tree = render();
	nodes(tree)
		.find((node) => node.type === 'Pressable' && text(node).includes('Payments'))
		.props.onPress();
	assert.equal(render().props.kind, 'payment');
	render().props.onBack();
	nodes(render())
		.find((node) => node.props.accessibilityLabel === 'Open Google Drive account')
		.props.onPress();
	assert.equal(render().type, 'AccountScreen');
});

test('cloud conflicts force the account screen before displaying editable money screens', () => {
	const render = screen('../src/screens/BalanceScreen.js', {
		'./TrackerScreen': { TrackerScreen: 'TrackerScreen' },
		'./MoneySourcesScreen': { MoneySourcesScreen: 'MoneySourcesScreen' },
		'./AccountScreen': { AccountScreen: 'AccountScreen' },
	});
	assert.equal(
		render({
			money: {
				data: null,
				loading: false,
				saving: false,
				conflict: { heads: [] },
			},
		}).type,
		'AccountScreen',
	);
});

test('Rho Tracker opens Money and Habits using one shared account session', () => {
	const money = { data: null, loading: true };
	const habits = { data: null, loading: true };
	const render = screen('../src/screens/PersonalTrackerScreen.js', {
		'../hooks/useMoneyData': { useMoneyData: () => money },
		'../hooks/useHabits': {
			useHabits: (session) => {
				assert.equal(session, money);
				return habits;
			},
		},
		'./BalanceScreen': { BalanceScreen: 'BalanceScreen' },
		'./HabitScreen': { HabitScreen: 'HabitScreen' },
		'./AccountScreen': { AccountScreen: 'AccountScreen' },
		'../../assets/icon.png': 'bread-icon',
	});
	assert.match(text(render()), /Rho Tracker/);
	assert.equal(nodes(render()).find((node) => node.type === 'Image').props.source, 'bread-icon');
	nodes(render())
		.find((node) => node.props.accessibilityLabel === 'Open Money')
		.props.onPress();
	let tree = render();
	assert.equal(tree.type, 'BalanceScreen');
	assert.equal(tree.props.money, money);
	tree.props.onBack();
	nodes(render())
		.find((node) => node.props.accessibilityLabel === 'Open Habit Tracker')
		.props.onPress();
	tree = render();
	assert.equal(tree.type, 'HabitScreen');
	assert.equal(tree.props.habits, habits);
	tree.props.onBack();
	assert.match(text(render()), /Rho Tracker/);
});

test('Money dashboard provides a safe return to Rho Tracker', () => {
	let returned = 0;
	const render = screen('../src/screens/BalanceScreen.js', {
		'./TrackerScreen': { TrackerScreen: 'TrackerScreen' },
		'./MoneySourcesScreen': { MoneySourcesScreen: 'MoneySourcesScreen' },
		'./AccountScreen': { AccountScreen: 'AccountScreen' },
	});
	const money = { data: { wallet: { sources: [] }, trackers: { items: [] } }, saving: false };
	const props = { money, onBack: () => returned++ };
	const back = (tree) =>
		nodes(tree).find(
			(node) => node.type === 'Pressable' && text(node).includes('< Rho Tracker'),
		);
	back(render(props)).props.onPress();
	assert.equal(returned, 1);
	money.saving = true;
	assert.equal(back(render(props)).props.disabled, true);
});

test('home and habit navigation expose account status and route habit conflicts to resolution', () => {
	const money = { data: null, loading: false, account: { id: 'A' }, dirty: true };
	const render = screen('../src/screens/PersonalTrackerScreen.js', {
		'../hooks/useMoneyData': { useMoneyData: () => money },
		'../hooks/useHabits': { useHabits: () => ({}) },
		'./BalanceScreen': { BalanceScreen: 'BalanceScreen' },
		'./HabitScreen': { HabitScreen: 'HabitScreen' },
		'./AccountScreen': { AccountScreen: 'AccountScreen' },
		'../../assets/icon.png': 'bread-icon',
	});
	assert.match(text(render()), /changes waiting to sync/);
	nodes(render())
		.find((node) => node.props.accessibilityLabel === 'Open Google Drive account')
		.props.onPress();
	assert.equal(render().type, 'AccountScreen');
	render().props.onHome();
	nodes(render())
		.find((node) => node.props.accessibilityLabel === 'Open Habit Tracker')
		.props.onPress();
	assert.equal(render().type, 'HabitScreen');
	assert.equal(typeof render().props.onEditingChange, 'function');
	money.conflict = { heads: [] };
	assert.equal(render().type, 'AccountScreen');
	assert.equal(render().props.session, money);
});

function habitScreen(overrides = {}) {
	const calls = [];
	let confirmation;
	const habits = {
		data: {
			version: 1,
			habits: [
				{
					id: 'workout',
					name: 'Workout',
					kind: 'good',
					days: [1, 2, 4, 5],
					startDate: '2020-01-01',
					completions: {},
				},
			],
		},
		loading: false,
		saving: false,
		error: null,
		toggleDate: async (...args) => {
			calls.push(args);
			return { success: true };
		},
		removeHabit: async (id) => {
			calls.push(['delete', id]);
			return { success: true };
		},
		...overrides,
	};
	const renderScreen = screen('../src/screens/HabitScreen.js', {
		'./HabitScreen': { HabitScreen: 'HabitScreen' },
		'../components/HabitEditor': { HabitEditor: 'HabitEditor' },
		'react-native': {
			Alert: {
				alert: (...args) => {
					confirmation = args;
				},
			},
		},
	});
	return {
		habits,
		calls,
		render: (props = {}) => renderScreen({ habits, onBack() {}, ...props }),
		confirmation: () => confirmation,
	};
}

test('weekly habit checkboxes use scheduled dates and show a completed goal', async () => {
	const { shiftDate, weekStart } = require('../src/utils/habits');
	const { todayDate } = require('../src/utils/trackers');
	const ui = habitScreen();
	nodes(ui.render())
		.find((node) => node.props.accessibilityLabel === 'Previous week')
		.props.onPress();
	let tree = ui.render();
	const boxes = nodes(tree).filter((node) => node.props.accessibilityRole === 'checkbox');
	assert.equal(boxes.length, 4);
	assert.equal(
		boxes.every((node) => !node.props.disabled),
		true,
	);
	const monday = shiftDate(weekStart(todayDate()), -7);
	await boxes[0].props.onPress();
	assert.deepEqual(ui.calls, [['workout', monday]]);
	const habit = ui.habits.data.habits[0];
	for (const offset of [0, 1, 3, 4])
		habit.completions[shiftDate(monday, offset)] = '2026-11-13T10:00:00.000Z';
	tree = ui.render();
	assert.match(text(tree), /Goal completed! 4\/4 this week/);
	assert.match(text(tree), /Check-ins this week/);
	assert.equal(
		nodes(tree)
			.filter((node) => node.props.accessibilityRole === 'checkbox')
			.every((node) => node.props.accessibilityState.checked),
		true,
	);
});

test('future habit days stay locked and bad habits use avoided wording', async () => {
	const ui = habitScreen();
	ui.habits.data.habits[0].kind = 'bad';
	let tree = ui.render();
	assert.match(text(tree), /Check when you avoided it/);
	nodes(tree)
		.find((node) => node.props.accessibilityLabel === 'Next week')
		.props.onPress();
	tree = ui.render();
	const boxes = nodes(tree).filter((node) => node.props.accessibilityRole === 'checkbox');
	assert.equal(boxes.length, 4);
	assert.equal(
		boxes.every((node) => node.props.disabled),
		true,
	);
	assert.match(boxes[0].props.accessibilityLabel, /avoided/);
});

test('daily view shows only habits scheduled on the selected date', () => {
	const ui = habitScreen();
	ui.habits.data.habits[0].days = [1, 2, 3, 4, 5, 6, 0];
	nodes(ui.render())
		.find((node) => node.props.accessibilityRole === 'tab' && text(node) === 'Daily')
		.props.onPress();
	assert.equal(
		nodes(ui.render()).filter((node) => node.props.accessibilityRole === 'checkbox').length,
		1,
	);
	const day = new Date().getDay();
	ui.habits.data.habits[0].days = [(day + 1) % 7];
	assert.match(text(ui.render()), /No habits scheduled today/);
});

test('habit save errors remain visible and deletion requires confirmation', async () => {
	const ui = habitScreen({ toggleDate: async () => ({ success: false, error: 'Storage full' }) });
	nodes(ui.render())
		.find((node) => node.props.accessibilityLabel === 'Previous week')
		.props.onPress();
	await nodes(ui.render())
		.find((node) => node.props.accessibilityRole === 'checkbox')
		.props.onPress();
	assert.match(text(ui.render()), /Storage full/);
	nodes(ui.render())
		.find((node) => node.props.accessibilityLabel === 'Delete Workout')
		.props.onPress();
	assert.equal(ui.calls.length, 0);
	await ui
		.confirmation()[2]
		.find((choice) => choice.text === 'Delete')
		.onPress();
	assert.deepEqual(ui.calls, [['delete', 'workout']]);
	assert.doesNotMatch(text(ui.render()), /Storage full/);
});

test('successful habit settings saves clear an earlier checkbox error', async () => {
	const ui = habitScreen({
		toggleDate: async () => ({ success: false, error: 'Storage full' }),
		saveHabit: async () => ({ success: true }),
	});
	nodes(ui.render())
		.find((node) => node.props.accessibilityLabel === 'Previous week')
		.props.onPress();
	await nodes(ui.render())
		.find((node) => node.props.accessibilityRole === 'checkbox')
		.props.onPress();
	assert.match(text(ui.render()), /Storage full/);
	nodes(ui.render())
		.find((node) => node.props.accessibilityLabel === 'Edit Workout')
		.props.onPress();
	await nodes(ui.render())
		.find((node) => node.type === 'HabitEditor')
		.props.onSave(ui.habits.data.habits[0]);
	assert.doesNotMatch(text(ui.render()), /Storage full/);
});

test('unreadable habit data offers retry without allowing edits', () => {
	const ui = habitScreen({ data: null, error: 'Could not read saved habits.' });
	assert.match(text(ui.render()), /Could not read saved habits/);
	assert.match(text(ui.render()), /Try again/);
	assert.doesNotMatch(text(ui.render()), /Add habit/);
});

test('habit editors and delete confirmations pause shared sync and cancellation resumes it', () => {
	const ui = habitScreen();
	let paused;
	const props = {
		onEditingChange: (value) => {
			paused = value;
		},
	};
	assert.match(text(ui.render(props)), /Device only/);
	nodes(ui.render(props))
		.find((node) => node.props.accessibilityLabel === 'Edit Workout')
		.props.onPress();
	assert.equal(paused, false);
	let tree = ui.render(props);
	assert.equal(paused, true);
	nodes(tree)
		.find((node) => node.type === 'HabitEditor')
		.props.onClose();
	tree = ui.render(props);
	assert.equal(paused, false);
	nodes(tree)
		.find((node) => node.props.accessibilityLabel === 'Delete Workout')
		.props.onPress();
	ui.render(props);
	assert.equal(paused, true);
	ui.confirmation()[2]
		.find((choice) => choice.text === 'Cancel')
		.onPress();
	ui.render(props);
	assert.equal(paused, false);
	ui.habits.account = { id: 'A' };
	ui.habits.dirty = true;
	assert.match(text(ui.render(props)), /Waiting to sync habits/);
	ui.habits.syncError = 'Offline';
	assert.match(text(ui.render(props)), /sync needs attention/);
});

test('habit editor defaults to four workout days and saves simple good/bad settings', async () => {
	let saved;
	const render = screen('../src/components/HabitEditor.js', {
		'expo-crypto': { randomUUID: () => 'new-habit' },
		'./TrackerForm': {
			TrackerForm: 'TrackerForm',
			TrackerField: 'TrackerField',
			trackerFormStyles: {},
		},
	});
	const props = {
		saving: false,
		onSave: async (value) => {
			saved = value;
			return { success: true };
		},
		onClose() {},
	};
	let tree = render(props);
	assert.equal(
		nodes(tree).filter(
			(node) =>
				node.props.accessibilityRole === 'checkbox' &&
				node.props.accessibilityState.checked,
		).length,
		4,
	);
	nodes(tree)
		.find((node) => node.type === 'TrackerField')
		.props.onChangeText('Workout');
	await render(props).props.onSave();
	assert.equal(saved.id, 'new-habit');
	assert.equal(saved.name, 'Workout');
	assert.equal(saved.kind, 'good');
	assert.deepEqual(Array.from(saved.days), [1, 2, 4, 5]);
	tree = render(props);
	nodes(tree)
		.find(
			(node) =>
				node.props.accessibilityRole === 'radio' && text(node) === 'Avoid a bad habit',
		)
		.props.onPress();
	nodes(render(props))
		.find((node) => node.type === 'Pressable' && text(node) === 'Every day')
		.props.onPress();
	await render(props).props.onSave();
	assert.equal(saved.kind, 'bad');
	assert.equal(saved.days.length, 7);
});

test('habit editor keeps the form open on a failed save', async () => {
	const render = screen('../src/components/HabitEditor.js', {
		'expo-crypto': { randomUUID: () => 'new-habit' },
		'./TrackerForm': {
			TrackerForm: 'TrackerForm',
			TrackerField: 'TrackerField',
			trackerFormStyles: {},
		},
	});
	const tree = render({ onSave: async () => ({ success: false, error: 'Pick a day.' }) });
	await assert.rejects(tree.props.onSave(), /Pick a day/);
});

function accountScreen(overrides = {}, onHome) {
	const calls = [];
	let confirmation;
	const session = {
		account: { id: 'google-a', email: 'a@example.test', name: 'A' },
		saving: false,
		syncing: false,
		authenticating: false,
		dirty: true,
		lastSyncedAt: null,
		syncError: null,
		conflict: null,
		canImportGuest: false,
		canImportHabits: false,
		googleAvailability: { available: true, reason: null },
		signIn: async () => {
			calls.push(['signIn']);
			return true;
		},
		sync: async () => {
			calls.push(['sync']);
			return true;
		},
		importGuest: async () => {
			calls.push(['importGuest']);
			return true;
		},
		importGuestHabits: async () => {
			calls.push(['importGuestHabits']);
			return true;
		},
		signOut: async () => {
			calls.push(['signOut']);
			return true;
		},
		resolveConflict: async (...args) => {
			calls.push(['resolveConflict', ...args]);
			return true;
		},
		...overrides,
	};
	const render = screen('../src/screens/AccountScreen.js', {
		'react-native': {
			Alert: {
				alert: (...args) => {
					confirmation = args;
				},
			},
		},
		'react-native-nitro-google-signin': { GoogleSignInButton: 'GoogleSignInButton' },
	});
	const current = () =>
		render({
			session,
			onHome,
			onBack: () => {
				calls.push(['back']);
			},
		});
	return {
		current,
		calls,
		session,
		confirm: async (label) => confirmation[2].find((button) => button.text === label).onPress(),
		message: () => confirmation?.[1],
	};
}

test('account controls connect Google, sync manually, and confirm device data import', async () => {
	const ui = accountScreen({ canImportGuest: true });
	const tree = ui.current();
	const google = nodes(tree).find((node) => node.type === 'GoogleSignInButton');
	assert.equal(google.props.signInBehavior, 'none');
	await google.props.onPress();
	await nodes(tree)
		.find((node) => node.type === 'Pressable' && text(node) === 'Sync now')
		.props.onPress();
	nodes(tree)
		.find((node) => node.type === 'Pressable' && text(node) === 'Copy device-only data')
		.props.onPress();
	assert.match(ui.message(), /a@example\.test/);
	assert.equal(
		ui.calls.some(([action]) => action === 'importGuest'),
		false,
	);
	await ui.confirm('Copy data');
	assert.deepEqual(ui.calls, [['signIn'], ['sync'], ['importGuest']]);
	assert.match(text(tree), /Waiting to sync/);
});

test('existing money accounts can confirm habit-only import without replacing money', async () => {
	const ui = accountScreen({ canImportHabits: true, canImportGuest: false });
	const tree = ui.current();
	assert.match(text(tree), /Money and Habits/);
	nodes(tree)
		.find((node) => node.type === 'Pressable' && text(node) === 'Copy device-only habits')
		.props.onPress();
	assert.match(ui.message(), /a@example\.test/);
	assert.match(ui.message(), /balances and payments will not change/);
	assert.equal(ui.calls.length, 0);
	await ui.confirm('Copy habits');
	assert.deepEqual(ui.calls, [['importGuestHabits']]);
});

test('account conflict resolution confirms exact remote version and keeps signout available', async () => {
	const ui = accountScreen({
		conflict: {
			message: 'Choose a version.',
			heads: [{ revision: 'remote-123', createdAt: '2026-11-12T00:00:00.000Z' }],
		},
	});
	const tree = ui.current();
	nodes(tree)
		.find((node) => node.type === 'Pressable' && text(node) === '< Balance')
		.props.onPress();
	assert.equal(ui.calls.length, 0);
	nodes(tree)
		.find((node) => node.type === 'Pressable' && text(node).includes('Use Drive version:'))
		.props.onPress();
	assert.match(ui.message(), /unsynced edits/);
	await ui.confirm('Use Drive version');
	assert.deepEqual(ui.calls[0], ['resolveConflict', 'remote', 'remote-123']);
	nodes(tree)
		.find(
			(node) => node.type === 'Pressable' && text(node) === 'Sign out / use device-only data',
		)
		.props.onPress();
	assert.match(ui.message(), /Drive data is not deleted/);
	await ui.confirm('Sign out');
	assert.deepEqual(ui.calls[1], ['signOut']);
});

test('account conflicts allow leaving for Rho Tracker without exposing financial editors', () => {
	let homes = 0;
	const ui = accountScreen({ conflict: { heads: [] } }, () => homes++);
	const back = nodes(ui.current()).find(
		(node) => node.type === 'Pressable' && text(node) === '< Rho Tracker',
	);
	assert.equal(back.props.disabled, false);
	back.props.onPress();
	assert.equal(homes, 1);
	const render = screen('../src/screens/BalanceScreen.js', {
		'./TrackerScreen': { TrackerScreen: 'TrackerScreen' },
		'./MoneySourcesScreen': { MoneySourcesScreen: 'MoneySourcesScreen' },
		'./AccountScreen': { AccountScreen: 'AccountScreen' },
	});
	const props = { money: ui.session, onBack: () => homes++ };
	const tree = render(props);
	assert.equal(tree.type, 'AccountScreen');
	tree.props.onHome();
	assert.equal(homes, 2);
	assert.equal(render(props).type, 'AccountScreen');
	ui.session.saving = true;
	assert.equal(
		nodes(ui.current()).find(
			(node) => node.type === 'Pressable' && text(node) === '< Rho Tracker',
		).props.disabled,
		true,
	);
});

test('unconfigured Google sign-in leaves device-only mode usable without loading native buttons', () => {
	const ui = accountScreen({
		account: null,
		dirty: false,
		googleAvailability: { available: false, reason: 'Configure OAuth IDs and rebuild.' },
	});
	const tree = ui.current();
	assert.match(text(tree), /Device only/);
	assert.match(text(tree), /Configure OAuth/);
	assert.equal(
		nodes(tree).some((node) => node.type === 'GoogleSignInButton'),
		false,
	);
	assert.equal(
		nodes(tree).some(
			(node) => node.type === 'Pressable' && text(node) === 'Copy device-only data',
		),
		false,
	);
	nodes(tree)
		.find((node) => node.type === 'Pressable' && text(node) === '< Balance')
		.props.onPress();
	assert.deepEqual(ui.calls, [['back']]);
});

function trackerScreen(saveEntryOverride, nativeOverrides = {}) {
	let finance = validateFinanceData({
		version: 1,
		wallet: {
			version: 3,
			currency: 'IDR',
			updatedAt: null,
			sources: [
				{ id: 'bank-a', name: 'Bank A', amountMinor: 200000000 },
				{ id: 'bank-b', name: 'Bank B', amountMinor: 50000000 },
			],
		},
		trackers: {
			version: 2,
			items: [
				{
					id: 'rent',
					kind: 'income',
					name: 'Kontrakan Fatra',
					amountMinor: 100000000,
					frequency: 'monthly',
					startDate: '2026-01-01',
					defaultSourceId: 'bank-a',
					entries: {},
				},
				{
					id: 'bill',
					kind: 'payment',
					name: 'Electricity',
					amountMinor: 100,
					frequency: 'monthly',
					startDate: '2026-01-01',
					defaultSourceId: 'bank-a',
					entries: {},
				},
			],
		},
	});
	function commit(next) {
		finance = next;
		props.data = finance.trackers;
		props.sources = finance.wallet.sources;
		return true;
	}
	const props = {
		kind: 'income',
		data: finance.trackers,
		sources: finance.wallet.sources,
		saving: false,
		saveEntry:
			saveEntryOverride ??
			(async (id, key, entry) => commit(saveRecurringEntry(finance, id, key, entry))),
		saveTracker: async (tracker) => commit(saveRecurringItem(finance, tracker)),
		deleteTracker: async (id) => commit(deleteRecurringItem(finance, id)),
	};
	const render = screen('../src/screens/TrackerScreen.js', {
		'react-native': nativeOverrides,
		'../components/TrackerForm': { PaidCheckbox: 'PaidCheckbox' },
		'../components/TrackerEditor': { TrackerEditor: 'TrackerEditor' },
		'../components/OccurrenceEditor': { OccurrenceEditor: 'OccurrenceEditor' },
	});
	const current = () => render(props);
	const list = () => nodes(current()).find((node) => node.type === 'FlatList');
	return { props, current, list, getData: () => finance };
}

function openFirstItem(ui) {
	const list = ui.list();
	list.props.renderItem({ item: list.props.data[0] }).props.onPress();
	return ui.list();
}

test('tracker screens filter by kind; paid toggle saves today and edit supports custom dates', async () => {
	const ui = trackerScreen();
	let list = ui.list();
	assert.equal(list.props.data.length, 1);
	assert.equal(list.props.data[0].name, 'Kontrakan Fatra');
	list.props.renderItem({ item: list.props.data[0] }).props.onPress();
	list = ui.list();
	assert.equal(list.props.data.length, 12);
	const occurrence = list.props.data[0];
	let card = list.props.renderItem({ item: occurrence });
	assert.match(
		nodes(card).find((node) => node.type === 'PaidCheckbox').props.accessibilityLabel,
		/Kontrakan Fatra/,
	);
	await nodes(card)
		.find((node) => node.type === 'PaidCheckbox')
		.props.onPress();
	let saved = ui.props.data.items[0].entries[occurrence.key];
	assert.equal(saved.paid, true);
	assert.equal(saved.paidDate, require('../src/utils/trackers').todayDate());
	assert.equal(saved.sourceId, 'bank-a');
	assert.equal(ui.props.sources[0].amountMinor, 300000000);
	list = ui.list();
	card = list.props.renderItem({ item: list.props.data[0] });
	nodes(card)
		.find((node) => node.props.accessibilityLabel?.startsWith('Edit entry'))
		.props.onPress();
	const editor = nodes(ui.current()).find((node) => node.type === 'OccurrenceEditor');
	await editor.props.onSave({ ...saved, dueDate: '2026-02-15', paidDate: '2026-02-16' });
	saved = ui.props.data.items[0].entries[occurrence.key];
	assert.equal(saved.dueDate, '2026-02-15');
	assert.equal(ui.props.sources[0].amountMinor, 300000000);
	assert.equal(saved.paidDate, '2026-02-16');
	assert.equal(ui.props.data.items[1].id, 'bill');
	editor.props.onClose();
	list = ui.list();
	card = list.props.renderItem({
		item: list.props.data.find((item) => item.key === occurrence.key),
	});
	await nodes(card)
		.find((node) => node.type === 'PaidCheckbox')
		.props.onPress();
	saved = ui.props.data.items[0].entries[occurrence.key];
	assert.equal(saved.paid, false);
	assert.equal(saved.paidDate, null);
	assert.equal(saved.dueDate, '2026-02-15');
	assert.equal(ui.props.sources[0].amountMinor, 200000000);
});

test('failed paid saves leave the entry unpaid and show an error', async () => {
	const ui = trackerScreen(async () => {
		throw new Error('Storage full');
	});
	let list = ui.list();
	list.props.renderItem({ item: list.props.data[0] }).props.onPress();
	list = ui.list();
	const card = list.props.renderItem({ item: list.props.data[0] });
	await nodes(card)
		.find((node) => node.type === 'PaidCheckbox')
		.props.onPress();
	assert.equal(ui.list().props.data[0].paid, false);
	assert.match(text(ui.list().props.ListHeaderComponent), /Storage full/);
});

test('editing paid income moves only its amount to an overridden source', async () => {
	const ui = trackerScreen();
	let list = openFirstItem(ui);
	const key = list.props.data[0].key;
	await nodes(list.props.renderItem({ item: list.props.data[0] }))
		.find((node) => node.type === 'PaidCheckbox')
		.props.onPress();
	list = ui.list();
	nodes(list.props.renderItem({ item: list.props.data[0] }))
		.find((node) => node.props.accessibilityLabel?.startsWith('Edit entry'))
		.props.onPress();
	const editor = nodes(ui.current()).find((node) => node.type === 'OccurrenceEditor');
	assert.equal(editor.props.defaultSourceId, 'bank-a');
	assert.equal(editor.props.sources.length, 2);
	await editor.props.onSave({
		...editor.props.occurrence,
		sourceId: 'bank-b',
		amountMinor: 150000000,
	});
	assert.equal(ui.props.sources[0].amountMinor, 200000000);
	assert.equal(ui.props.sources[1].amountMinor, 200000000);
	assert.equal(ui.props.data.items[0].defaultSourceId, 'bank-a');
	editor.props.onClose();
	list = ui.list();
	const paid = list.props.data.find((entry) => entry.key === key);
	assert.match(text(list.props.renderItem({ item: paid })), /Bank B/);
	await nodes(list.props.renderItem({ item: paid }))
		.find((node) => node.type === 'PaidCheckbox')
		.props.onPress();
	assert.equal(ui.props.sources[1].amountMinor, 50000000);
});

test('payment checkboxes subtract once and unchecking refunds the original source', async () => {
	const ui = trackerScreen();
	ui.props.kind = 'payment';
	let list = openFirstItem(ui);
	const occurrence = list.props.data[0];
	await nodes(list.props.renderItem({ item: occurrence }))
		.find((node) => node.type === 'PaidCheckbox')
		.props.onPress();
	assert.equal(ui.props.sources[0].amountMinor, 199999900);
	await ui.props.saveTracker({ ...ui.props.data.items[1], defaultSourceId: 'bank-b' });
	list = ui.list();
	const paid = list.props.data.find((entry) => entry.key === occurrence.key);
	await nodes(list.props.renderItem({ item: paid }))
		.find((node) => node.type === 'PaidCheckbox')
		.props.onPress();
	assert.equal(ui.props.sources[0].amountMinor, 200000000);
	assert.equal(ui.props.sources[1].amountMinor, 50000000);
});

test('marking paid without a default opens the editor to select a source', async () => {
	const ui = trackerScreen();
	ui.props.data.items[0].defaultSourceId = null;
	const list = openFirstItem(ui);
	await nodes(list.props.renderItem({ item: list.props.data[0] }))
		.find((node) => node.type === 'PaidCheckbox')
		.props.onPress();
	const editor = nodes(ui.current()).find((node) => node.type === 'OccurrenceEditor');
	assert.equal(editor.props.initialPaid, true);
	assert.equal(ui.props.sources[0].amountMinor, 200000000);
	assert.equal(list.props.data[0].paid, false);
	await editor.props.onSave({
		...editor.props.occurrence,
		sourceId: 'bank-b',
		paid: true,
		paidDate: '2026-11-12',
	});
	assert.equal(ui.props.sources[1].amountMinor, 150000000);
});

test('tracker deletion warns about reversing paid balances and uses the linked delete action', async () => {
	let confirmation;
	const ui = trackerScreen(undefined, {
		Alert: {
			alert: (...args) => {
				confirmation = args;
			},
		},
	});
	const list = openFirstItem(ui);
	await nodes(list.props.renderItem({ item: list.props.data[0] }))
		.find((node) => node.type === 'PaidCheckbox')
		.props.onPress();
	nodes(ui.list().props.ListHeaderComponent)
		.find((node) => node.type === 'Pressable' && text(node) === 'Delete item')
		.props.onPress();
	assert.match(confirmation[1], /Balance changes.*reversed/);
	await confirmation[2].find((button) => button.text === 'Delete').onPress();
	assert.equal(ui.props.data.items.length, 1);
	assert.equal(ui.props.sources[0].amountMinor, 200000000);
});

test('money sources screen edits actual balances and surfaces linked-source deletion errors', async () => {
	const tracker = trackerScreen();
	let finance = tracker.getData();
	let confirmation;
	let backs = 0;
	const props = {
		wallet: finance.wallet,
		saving: false,
		onBack: () => {
			backs++;
		},
		updateSources: async (sources) => {
			finance = updateMoneySources(finance, sources);
			props.wallet = finance.wallet;
			return true;
		},
	};
	const render = screen('../src/screens/MoneySourcesScreen.js', {
		'../components/SourceEditor': { SourceEditor: 'SourceEditor' },
		'react-native': {
			Alert: {
				alert: (...args) => {
					confirmation = args;
				},
			},
		},
	});
	const current = () => render(props);
	const list = () => nodes(current()).find((node) => node.type === 'FlatList');
	nodes(list().props.ListHeaderComponent)
		.find((node) => node.type === 'Pressable' && text(node) === 'Add source')
		.props.onPress();
	const editor = nodes(current()).find((node) => node.type === 'SourceEditor');
	await editor.props.onSave({ name: 'Cash', amountMinor: 12300 });
	editor.props.onClose();
	assert.equal(props.wallet.sources.length, 3);
	const bank = list().props.data[0];
	nodes(list().props.renderItem({ item: bank }))
		.find((node) => node.props.accessibilityLabel === 'Delete Bank A')
		.props.onPress();
	await confirmation[2].find((button) => button.text === 'Delete').onPress();
	assert.equal(props.wallet.sources.length, 3);
	assert.match(text(list().props.ListHeaderComponent), /Clear or change/);
	nodes(list().props.ListHeaderComponent)
		.find((node) => node.type === 'Pressable' && text(node) === '< Balance')
		.props.onPress();
	assert.equal(backs, 1);
});

test('tracker editor includes the selected default source when saving main settings', async () => {
	let saved;
	const render = screen('../src/components/TrackerEditor.js', {
		'./TrackerForm': {
			TrackerForm: 'TrackerForm',
			TrackerField: 'TrackerField',
			trackerFormStyles: {},
		},
		'./MoneySourcePicker': { MoneySourcePicker: 'MoneySourcePicker' },
	});
	const props = {
		kind: 'income',
		sources: [{ id: 'bank-a', name: 'Bank A' }],
		saving: false,
		onSave: async (tracker) => {
			saved = tracker;
			return true;
		},
	};
	let tree = render(props);
	assert.equal(
		nodes(tree).find((node) => node.props.label === 'Amount (IDR)').props.inputComponent,
		'AmountInput',
	);
	nodes(tree)
		.find((node) => node.props.label === 'Name')
		.props.onChangeText('Salary');
	nodes(tree)
		.find((node) => node.props.label === 'Amount (IDR)')
		.props.onChangeText('5800000');
	nodes(tree)
		.find((node) => node.type === 'MoneySourcePicker')
		.props.onChange('bank-a');
	tree = render(props);
	await tree.props.onSave();
	assert.equal(saved.defaultSourceId, 'bank-a');
	assert.equal(saved.amountMinor, 580000000);
});

test('daily entries can be filtered by month and yearly entries ignore the old month filter', () => {
	const ui = trackerScreen();
	ui.props.data.items[0].frequency = 'daily';
	ui.props.data.items[0].startDate = '2020-01-01';
	let list = ui.list();
	list.props.renderItem({ item: list.props.data[0] }).props.onPress();
	list = ui.list();
	const currentMonth = String(new Date().getMonth() + 1).padStart(2, '0');
	assert.ok(list.props.data.length > 0);
	assert.ok(list.props.data.every((entry) => entry.key.slice(5, 7) === currentMonth));
	nodes(list.props.ListHeaderComponent)
		.find((node) => node.type === 'Pressable' && text(node) === 'All months')
		.props.onPress();
	assert.ok(ui.list().props.data.length >= 365);
	nodes(ui.list().props.ListHeaderComponent)
		.find((node) => node.type === 'Pressable' && text(node) === 'Feb')
		.props.onPress();
	assert.ok(ui.list().props.data.every((entry) => entry.key.slice(5, 7) === '02'));
	ui.props.data.items[0].frequency = 'yearly';
	assert.equal(ui.list().props.data.length, 1);
	assert.equal(ui.list().props.data[0].key.slice(5), '01-01');
});

test('tracker form blocks duplicate submissions and closing during a pending save', async () => {
	const render = screen('../src/components/TrackerForm.js', {});
	let writes = 0;
	let closes = 0;
	let finish;
	const tree = render({
		title: 'Add income',
		saving: false,
		onClose: () => {
			closes++;
		},
		onSave: () => {
			writes++;
			return new Promise((resolve) => {
				finish = resolve;
			});
		},
	});
	const save = nodes(tree).find((node) => node.type === 'Pressable' && text(node) === 'Save');
	const pending = save.props.onPress();
	await save.props.onPress();
	nodes(tree)
		.find((node) => node.type === 'Pressable' && text(node) === 'Cancel')
		.props.onPress();
	assert.equal(writes, 1);
	assert.equal(closes, 0);
	finish(true);
	await pending;
	assert.equal(closes, 1);
});

test('tracker form keeps errors visible instead of closing after a failed save', async () => {
	const render = screen('../src/components/TrackerForm.js', {});
	let closes = 0;
	const props = {
		title: 'Edit entry',
		saving: false,
		onClose: () => {
			closes++;
		},
		onSave: async () => {
			throw new Error('Invalid due date');
		},
	};
	const tree = render(props);
	await nodes(tree)
		.find((node) => node.type === 'Pressable' && text(node) === 'Save')
		.props.onPress();
	assert.equal(closes, 0);
	assert.match(text(render(props)), /Invalid due date/);
});

test('entry editor exposes paid date only when paid and submits the manually entered dates', async () => {
	const render = screen('../src/components/OccurrenceEditor.js', {
		'./TrackerForm': {
			TrackerForm: 'TrackerForm',
			TrackerField: 'TrackerField',
			PaidCheckbox: 'PaidCheckbox',
			trackerFormStyles: {},
		},
		'../utils/trackers': { todayDate: () => '2026-11-12', formatDate: (value) => value },
		'./MoneySourcePicker': { MoneySourcePicker: 'MoneySourcePicker' },
	});
	let saved;
	const props = {
		occurrence: {
			amountMinor: 580000000,
			dueDate: '2026-11-01',
			scheduledDate: '2026-11-01',
			paid: false,
			paidDate: null,
		},
		sources: [{ id: 'bank-b', name: 'Bank B' }],
		defaultSourceId: null,
		saving: false,
		onSave: async (value) => {
			saved = value;
			return true;
		},
	};
	let tree = render(props);
	assert.equal(
		nodes(tree).find((node) => node.props.label === 'Amount (IDR)').props.inputComponent,
		'AmountInput',
	);
	assert.equal(
		nodes(tree).some((node) => node.props.label === 'Paid date'),
		false,
	);
	nodes(tree)
		.find((node) => node.type === 'PaidCheckbox')
		.props.onPress();
	tree = render(props);
	nodes(tree)
		.find((node) => node.props.label === 'Paid date')
		.props.onChangeText('2026-11-10');
	nodes(tree)
		.find((node) => node.props.label === 'Due date')
		.props.onChangeText('2026-11-05');
	nodes(tree)
		.find((node) => node.type === 'MoneySourcePicker')
		.props.onChange('bank-b');
	tree = render(props);
	await tree.props.onSave();
	assert.equal(saved.paid, true);
	assert.equal(saved.paidDate, '2026-11-10');
	assert.equal(saved.dueDate, '2026-11-05');
	assert.equal(saved.amountMinor, 580000000);
	assert.equal(saved.sourceId, 'bank-b');
});

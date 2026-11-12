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
	const react = {
		useState(initial) {
			const index = stateIndex++;
			if (!(index in states)) states[index] = initial;
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
	};
	const native = Object.fromEntries(
		[
			'ActivityIndicator',
			'FlatList',
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
			if (name === '../utils/money') return require('../src/utils/money');
			if (name === '../utils/trackers') return require('../src/utils/trackers');
			throw new Error(`Unexpected import: ${name}`);
		},
	});
	return (props) => {
		stateIndex = 0;
		refIndex = 0;
		const name = modulePath.split('/').pop().replace('.js', '');
		return exports[name](props);
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

test('dashboard opens separate money sources, income, and payment screens', () => {
	const render = screen('../src/screens/BalanceScreen.js', {
		'../hooks/useMoneyData': {
			useMoneyData: () => ({
				data: { wallet: { sources: [] }, trackers: { version: 2, items: [] } },
				loading: false,
				saving: false,
			}),
		},
		'./TrackerScreen': { TrackerScreen: 'TrackerScreen' },
		'./MoneySourcesScreen': { MoneySourcesScreen: 'MoneySourcesScreen' },
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

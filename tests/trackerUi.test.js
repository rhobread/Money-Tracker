const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { transformFileSync } = require('@babel/core');

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

test('dashboard keeps sources hidden and opens separate income and payment screens', () => {
	const render = screen('../src/screens/BalanceScreen.js', {
		'../hooks/useWallet': {
			useWallet: () => ({ wallet: { sources: [] }, loading: false, saving: false }),
		},
		'../hooks/useTrackers': {
			useTrackers: () => ({ data: { version: 1, items: [] }, loading: false }),
		},
		'./TrackerScreen': { TrackerScreen: 'TrackerScreen' },
		'../components/SourceEditor': { SourceEditor: 'SourceEditor' },
	});
	let tree = render();
	assert.doesNotMatch(text(tree), /Add source/);
	assert.match(text(tree), /Source of Income/);
	assert.match(text(tree), /Payments/);
	nodes(tree)
		.find((node) => node.props.accessibilityLabel === 'Current balance')
		.props.onPress();
	tree = render();
	assert.match(text(tree), /Add source/);
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

function trackerScreen(updateItems) {
	const props = {
		kind: 'income',
		data: {
			version: 1,
			items: [
				{
					id: 'rent',
					kind: 'income',
					name: 'Kontrakan Fatra',
					amountMinor: 100000000,
					frequency: 'monthly',
					startDate: '2026-01-01',
					entries: {},
				},
				{
					id: 'bill',
					kind: 'payment',
					name: 'Electricity',
					amountMinor: 100,
					frequency: 'monthly',
					startDate: '2026-01-01',
					entries: {},
				},
			],
		},
		loading: false,
		saving: false,
		updateItems,
	};
	const render = screen('../src/screens/TrackerScreen.js', {
		'../components/TrackerForm': { PaidCheckbox: 'PaidCheckbox' },
		'../components/TrackerEditor': { TrackerEditor: 'TrackerEditor' },
		'../components/OccurrenceEditor': { OccurrenceEditor: 'OccurrenceEditor' },
	});
	const current = () => render(props);
	const list = () => nodes(current()).find((node) => node.type === 'FlatList');
	return { props, current, list };
}

test('tracker screens filter by kind; paid toggle saves today and edit supports custom dates', async () => {
	const ui = trackerScreen(async (items) => {
		ui.props.data = { version: 1, items };
		return true;
	});
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
	list = ui.list();
	card = list.props.renderItem({ item: list.props.data[0] });
	nodes(card)
		.find((node) => node.props.accessibilityLabel?.startsWith('Edit entry'))
		.props.onPress();
	const editor = nodes(ui.current()).find((node) => node.type === 'OccurrenceEditor');
	await editor.props.onSave({ ...saved, dueDate: '2026-02-15', paidDate: '2026-02-16' });
	saved = ui.props.data.items[0].entries[occurrence.key];
	assert.equal(saved.dueDate, '2026-02-15');
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

test('daily entries can be filtered by month and yearly entries ignore the old month filter', () => {
	const ui = trackerScreen(async () => true);
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
	tree = render(props);
	await tree.props.onSave();
	assert.equal(saved.paid, true);
	assert.equal(saved.paidDate, '2026-11-10');
	assert.equal(saved.dueDate, '2026-11-05');
	assert.equal(saved.amountMinor, 580000000);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { transformFileSync } = require('@babel/core');
const finance = require('../src/utils/finance');
const appData = require('../src/utils/appData');
const habits = require('../src/utils/habits');
const { createMoneySession } = require('../src/services/cloudSession');

function loadModule(path, modules, globals = {}) {
	const exports = {};
	const { code } = transformFileSync(require.resolve(path), {
		babelrc: false,
		configFile: false,
		plugins: ['@babel/plugin-transform-modules-commonjs'],
	});
	vm.runInNewContext(code, {
		...globals,
		exports,
		require(name) {
			if (name in modules) return modules[name];
			throw new Error(`Unexpected import: ${name}`);
		},
	});
	return exports;
}

const DATA = '@money-tracker/data';
const APP_DATA = '@rho-tracker/data';
const HABITS = '@personal-tracker/habits';
const WALLET = '@money-tracker/wallet';
const TRACKERS = '@money-tracker/trackers';
const key = '2024-01-31';
const item = {
	id: 'rent',
	name: 'Rent',
	kind: 'payment',
	amountMinor: 500,
	frequency: 'monthly',
	startDate: key,
	defaultSourceId: 'bank',
	entries: {},
};
const entry = {
	dueDate: key,
	paid: true,
	paidDate: '2024-02-01',
	amountMinor: 500,
	sourceId: null,
};
const initial = () =>
	finance.validateFinanceData({
		version: 1,
		wallet: {
			version: 3,
			currency: 'IDR',
			updatedAt: null,
			sources: [{ id: 'bank', name: 'Bank', amountMinor: 1000 }],
		},
		trackers: { version: 2, items: [] },
	});
const plain = (value) => JSON.parse(JSON.stringify(value));
const initialApp = () => appData.validateAppData(initial());
const habit = {
	id: 'walk',
	name: 'Walk',
	kind: 'good',
	days: [3],
	startDate: key,
	completions: {},
};
const completionTime = new Date('2024-01-31T12:00:00.000Z');

function storageHarness(initialValues = {}) {
	const values = new Map(Object.entries(initialValues));
	const reads = [];
	const writes = [];
	const native = {
		async getItem(key) {
			reads.push(key);
			return values.get(key) ?? null;
		},
		async setItem(key, value) {
			writes.push([key, value]);
			values.set(key, value);
		},
	};
	const api = loadModule('../src/storage/moneyStorage.js', {
		'@react-native-async-storage/async-storage': native,
		'../utils/finance': finance,
	});
	return { api, native, reads, writes, values };
}

test('empty storage loads a fresh normalized aggregate without writes', async () => {
	const storage = storageHarness();
	const data = await storage.api.loadMoneyData();
	assert.deepEqual(plain(data), {
		version: 1,
		wallet: { version: 3, currency: 'IDR', sources: [], updatedAt: null },
		trackers: { version: 2, items: [] },
	});
	data.wallet.sources.push({ id: 'temporary' });
	data.trackers.items.push(item);
	const again = await storage.api.loadMoneyData();
	assert.equal(again.wallet.sources.length, 0);
	assert.equal(again.trackers.items.length, 0);
	assert.deepEqual(storage.reads, [DATA, WALLET, TRACKERS, DATA, WALLET, TRACKERS]);
	assert.equal(storage.writes.length, 0);
});

test('all legacy wallet versions migrate exactly; paid tracker history never changes balances', async () => {
	const wallets = ['USD', 'EUR', 'GBP', 'PHP', 'INR', 'CAD', 'AUD'].map((currency) => ({
		version: 1,
		currency,
		balanceMinor: -29,
		updatedAt: '2026-11-11T00:00:00.000Z',
	}));
	wallets.push({ version: 2, currency: 'IDR', balanceMinor: -29, updatedAt: null });
	wallets.push({
		...initial().wallet,
		sources: [{ id: 'bank', name: 'Bank', amountMinor: -29 }],
	});
	const legacyItem = { ...item, entries: { [key]: { ...entry } } };
	delete legacyItem.defaultSourceId;
	delete legacyItem.entries[key].sourceId;
	for (const wallet of wallets) {
		const oldWallet = JSON.stringify(wallet);
		const oldTrackers = JSON.stringify({ version: 1, items: [legacyItem] });
		const storage = storageHarness({ [WALLET]: oldWallet, [TRACKERS]: oldTrackers });
		const data = await storage.api.loadMoneyData();
		assert.equal(data.wallet.version, 3);
		assert.equal(data.wallet.currency, 'IDR');
		assert.equal(data.wallet.sources[0].amountMinor, -29);
		assert.equal(data.wallet.updatedAt, wallet.updatedAt);
		assert.equal(data.trackers.version, 2);
		assert.deepEqual(plain(data.trackers.items[0].entries[key]), {
			...entry,
			sourceId: null,
			applied: null,
		});
		assert.equal(data.trackers.items[0].defaultSourceId, null);
		assert.equal(storage.writes.length, 0);
		await storage.api.saveMoneyData(data);
		assert.equal(storage.writes.length, 1);
		assert.equal(storage.writes[0][0], DATA);
		assert.equal(storage.values.get(WALLET), oldWallet);
		assert.equal(storage.values.get(TRACKERS), oldTrackers);
		assert.deepEqual(plain(await storage.api.loadMoneyData()), plain(data));
	}
});

test('each missing legacy key defaults independently, without migration writes', async () => {
	for (const values of [
		{ [WALLET]: JSON.stringify(initial().wallet) },
		{ [TRACKERS]: JSON.stringify({ version: 1, items: [{ ...item, defaultSourceId: null }] }) },
	]) {
		const storage = storageHarness(values);
		const data = await storage.api.loadMoneyData();
		assert.equal(data.wallet.sources.length, WALLET in values ? 1 : 0);
		assert.equal(data.trackers.items.length, TRACKERS in values ? 1 : 0);
		assert.equal(storage.writes.length, 0);
	}
});

test('existing aggregate is authoritative and never reads stale legacy keys', async () => {
	let data = finance.saveRecurringItem(initial(), item);
	data = finance.saveRecurringEntry(data, item.id, key, entry);
	const storage = storageHarness({
		[DATA]: JSON.stringify(data),
		[WALLET]: '{broken',
		[TRACKERS]: '{broken',
	});
	const loaded = await storage.api.loadMoneyData();
	assert.deepEqual(plain(loaded), data);
	assert.deepEqual(storage.reads, [DATA]);
	assert.equal(storage.writes.length, 0);
	const resaved = finance.saveRecurringEntry(loaded, item.id, key, entry);
	assert.equal(resaved.wallet.sources[0].amountMinor, 500);
	await storage.api.saveMoneyData(resaved);
	assert.equal(storage.writes.length, 1);
	assert.deepEqual(plain(await storage.api.loadMoneyData()), plain(resaved));
	assert.equal(storage.values.get(WALLET), '{broken');
});

test('paid source overrides, corrections, and reversals survive every save and restart', async () => {
	for (const kind of ['income', 'payment']) {
		const storage = storageHarness();
		let data = initial();
		data = finance.updateMoneySources(data, [
			...data.wallet.sources,
			{ id: 'cash', name: 'Cash', amountMinor: 2000 },
		]);
		data = finance.saveRecurringItem(data, { ...item, kind });
		async function restart(next) {
			await storage.api.saveMoneyData(next);
			return storage.api.loadMoneyData();
		}
		const sign = kind === 'income' ? 1 : -1;
		data = await restart(finance.saveRecurringEntry(data, item.id, key, entry));
		assert.equal(data.wallet.sources[0].amountMinor, 1000 + sign * 500);
		data = await restart(
			finance.saveRecurringItem(data, { ...data.trackers.items[0], defaultSourceId: 'cash' }),
		);
		assert.equal(data.trackers.items[0].entries[key].applied.sourceId, 'bank');
		data = await restart(
			finance.saveRecurringEntry(data, item.id, key, {
				...entry,
				sourceId: null,
				amountMinor: 750,
			}),
		);
		assert.equal(data.wallet.sources[0].amountMinor, 1000);
		assert.equal(data.wallet.sources[1].amountMinor, 2000 + sign * 750);
		assert.equal(data.trackers.items[0].entries[key].sourceId, 'cash');
		data = await restart(
			finance.updateMoneySources(
				data,
				data.wallet.sources.filter((source) => source.id !== 'bank'),
			),
		);
		assert.equal(data.wallet.sources.length, 1);
		data = await restart(
			finance.saveRecurringEntry(data, item.id, key, {
				...data.trackers.items[0].entries[key],
				paid: false,
				paidDate: null,
			}),
		);
		assert.equal(data.wallet.sources[0].amountMinor, 2000);
		data = await restart(
			finance.saveRecurringEntry(data, item.id, key, { ...entry, amountMinor: 750 }),
		);
		assert.equal(data.wallet.sources[0].amountMinor, 2000 + sign * 750);
		data = await restart(finance.deleteRecurringItem(data, item.id));
		assert.equal(data.wallet.sources[0].amountMinor, 2000);
		assert.equal(data.trackers.items.length, 0);
		assert.equal(storage.writes.length, 7);
		assert.ok(storage.writes.every(([key]) => key === DATA));
	}
});

test('corrupt aggregate throws without falling back or altering any stored keys', async () => {
	const missingReference = finance.saveRecurringItem(initial(), item);
	missingReference.wallet.sources = [];
	for (const raw of [
		'{broken',
		'null',
		'[]',
		'{}',
		'{"version":2}',
		JSON.stringify({ ...initial(), trackers: { version: 99, items: [] } }),
		JSON.stringify(missingReference),
	]) {
		const storage = storageHarness({ [DATA]: raw, [WALLET]: JSON.stringify(initial().wallet) });
		await assert.rejects(storage.api.loadMoneyData());
		assert.deepEqual(storage.reads, [DATA]);
		assert.equal(storage.writes.length, 0);
		assert.equal(storage.values.get(DATA), raw);
	}
});

test('corrupt legacy keys and storage read failures never cause fallback writes', async () => {
	for (const [key, raw] of [
		[WALLET, '{'],
		[TRACKERS, '{'],
		[WALLET, 'null'],
		[TRACKERS, '{"version":99}'],
	]) {
		const storage = storageHarness({ [key]: raw });
		await assert.rejects(storage.api.loadMoneyData());
		assert.equal(storage.writes.length, 0);
		assert.equal(storage.values.get(key), raw);
	}
	const storage = storageHarness();
	storage.native.getItem = async () => {
		throw new Error('Read failed');
	};
	await assert.rejects(storage.api.loadMoneyData(), /Read failed/);
	assert.equal(storage.writes.length, 0);
});

test('save validates before its sole aggregate write and propagates single-write failure', async () => {
	const storage = storageHarness({ [DATA]: JSON.stringify(initial()) });
	await assert.rejects(storage.api.saveMoneyData({ ...initial(), wallet: null }));
	assert.equal(storage.writes.length, 0);
	const before = storage.values.get(DATA);
	let attempts = 0;
	storage.native.setItem = async (key, value) => {
		attempts++;
		assert.equal(key, DATA);
		const stored = JSON.parse(value);
		assert.equal(stored.wallet.version, 3);
		assert.equal(stored.trackers.version, 2);
		throw new Error('Storage full');
	};
	await assert.rejects(storage.api.saveMoneyData(initial()), /Storage full/);
	assert.equal(attempts, 1);
	assert.equal(storage.values.get(DATA), before);
});

function appStorageHarness(initialValues = {}) {
	const storage = storageHarness(initialValues);
	const habitStorage = loadModule('../src/storage/habitStorage.js', {
		'@react-native-async-storage/async-storage': storage.native,
		'../utils/habits': habits,
	});
	const api = loadModule('../src/storage/appStorage.js', {
		'@react-native-async-storage/async-storage': storage.native,
		'./moneyStorage': storage.api,
		'./habitStorage': habitStorage,
		'../utils/appData': appData,
	});
	return { ...storage, api };
}

function hookHarness(storage, options = {}) {
	const states = [];
	const refs = [];
	const effects = [];
	const pendingEffects = new Set();
	const listeners = new Set();
	const timers = new Map();
	const creations = { auth: 0, drive: 0, session: 0 };
	let mounted = false;
	let clock = 0;
	let timerId = 0;
	let stateIndex;
	let refIndex;
	let effectIndex;
	const unexpected = () => {
		throw new Error('Signed-out hook must not access cloud storage, auth, or Drive');
	};
	const auth = options.auth ?? {
		availability: () => ({ available: false, reason: 'Test is signed out' }),
		signIn: unexpected,
		accessToken: unexpected,
		signOut: unexpected,
	};
	const cloudStorage = {
		loadActiveAccount: async () => null,
		loadAccountData: unexpected,
		saveAccountData: unexpected,
		saveActiveAccount: unexpected,
		...options.cloudStorage,
	};
	const react = {
		useState(initial) {
			const index = stateIndex++;
			if (!(index in states)) states[index] = initial;
			return [
				states[index],
				(next) => {
					states[index] = next;
				},
			];
		},
		useRef(initial) {
			const index = refIndex++;
			return refs[index] ?? (refs[index] = { current: initial });
		},
		useEffect(effect, dependencies) {
			const index = effectIndex++;
			const previous = effects[index];
			if (
				!previous ||
				dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))
			) {
				effects[index] = { effect, dependencies, cleanup: previous?.cleanup };
				pendingEffects.add(index);
			}
		},
	};
	function commitEffects() {
		for (const index of pendingEffects) {
			const effect = effects[index];
			effect.cleanup?.();
			effect.cleanup = effect.effect();
		}
		pendingEffects.clear();
	}
	const { useMoneyData } = loadModule(
		'../src/hooks/useMoneyData.js',
		{
			react,
			'react-native': {
				AppState: {
					addEventListener(event, listener) {
						assert.equal(event, 'change');
						listeners.add(listener);
						return { remove: () => listeners.delete(listener) };
					},
				},
			},
			'expo-crypto': { randomUUID: () => `test-revision-${++timerId}` },
			'../storage/appStorage': storage,
			'../storage/cloudStorage': cloudStorage,
			'../config/google': { getGoogleConfiguration: () => ({}) },
			'../services/googleAuth': {
				createGoogleAuth: () => {
					creations.auth++;
					return auth;
				},
			},
			'../services/driveStorage': {
				createDriveStorage: () => {
					creations.drive++;
					return options.drive ?? {};
				},
			},
			'../services/cloudSession': {
				createMoneySession: (dependencies) => {
					creations.session++;
					return options.session ?? createMoneySession(dependencies);
				},
			},
		},
		{
			setTimeout(callback, delay) {
				const id = ++timerId;
				timers.set(id, { callback, due: clock + delay });
				return id;
			},
			clearTimeout: (id) => timers.delete(id),
		},
	);
	return {
		creations,
		render(props) {
			stateIndex = 0;
			refIndex = 0;
			effectIndex = 0;
			const result = useMoneyData(props);
			if (mounted) commitEffects();
			return result;
		},
		mount() {
			mounted = true;
			commitEffects();
		},
		unmount() {
			for (const effect of effects) effect.cleanup?.();
			mounted = false;
		},
		appState(next) {
			for (const listener of listeners) listener(next);
		},
		advance(milliseconds) {
			const target = clock + milliseconds;
			while (true) {
				const next = [...timers].sort((a, b) => a[1].due - b[1].due)[0];
				if (!next || next[1].due > target) break;
				clock = next[1].due;
				timers.delete(next[0]);
				next[1].callback();
			}
			clock = target;
		},
		pendingTimers: () => timers.size,
		listenerCount: () => listeners.size,
	};
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
const mutations = (hook) => [
	() => hook.updateSources([]),
	() => hook.saveTracker(item),
	() => hook.saveEntry(item.id, key, entry),
	() => hook.deleteTracker(item.id),
	() => hook.saveHabit(habit),
	() => hook.removeHabit(habit.id),
	() => hook.toggleDate(habit.id, key, completionTime),
	() => hook.importGuestHabits(),
];

test('hook starts null, guards all writes before load and blocks duplicate loads', async () => {
	let finishAccount;
	let finishLoad;
	let accountLoads = 0;
	let loads = 0;
	let writes = 0;
	const hook = hookHarness(
		{
			loadAppData: () => {
				loads++;
				return new Promise((resolve) => {
					finishLoad = resolve;
				});
			},
			saveAppData: async () => {
				writes++;
			},
		},
		{
			cloudStorage: {
				loadActiveAccount: () =>
					new Promise((resolve) => {
						accountLoads++;
						finishAccount = resolve;
					}),
			},
		},
	);
	const current = hook.render();
	assert.equal(current.data, null);
	assert.equal(current.loading, true);
	for (const mutate of mutations(current)) assert.equal(await mutate(), false);
	hook.mount();
	assert.equal(await current.reload(), false);
	for (const mutate of mutations(current)) assert.equal(await mutate(), false);
	assert.equal(loads, 0, 'Guest loading waits for the active account marker');
	assert.equal(accountLoads, 1, 'Duplicate initialization must not reread the active marker');
	assert.equal(writes, 0);
	finishAccount(null);
	await Promise.resolve();
	assert.equal(loads, 1);
	assert.equal(writes, 0);
	finishLoad(initial());
	await flush();
	assert.equal(hook.render().loading, false);
	assert.deepEqual(hook.render().data, initialApp());
});

test('one synchronous shared save lock guards all mutations and reload; commit follows persistence', async () => {
	let finishSave;
	const writes = [];
	const hook = hookHarness({
		loadAppData: async () => initialApp(),
		saveAppData: (data) => {
			writes.push(data);
			return new Promise((resolve) => {
				finishSave = resolve;
			});
		},
	});
	hook.render();
	hook.mount();
	await flush();
	const current = hook.render();
	const committed = current.data;
	const pending = current.saveTracker(item);
	assert.equal(hook.render().saving, true);
	assert.equal(hook.render().data, committed);
	for (const mutate of mutations(current)) assert.equal(await mutate(), false);
	assert.equal(await current.reload(), false);
	assert.equal(writes.length, 1);
	finishSave();
	assert.equal(await pending, true);
	assert.equal(hook.render().saving, false);
	assert.equal(hook.render().data.trackers.items.length, 1);
});

test('habit mutations acquire the same persistence lock and preserve finance data', async () => {
	for (const action of ['saveHabit', 'removeHabit', 'toggleDate']) {
		const data = initialApp();
		data.habits.habits.push(habit);
		let finishSave;
		const writes = [];
		const hook = hookHarness({
			loadAppData: async () => data,
			saveAppData: (next) => {
				writes.push(next);
				return new Promise((resolve) => {
					finishSave = resolve;
				});
			},
		});
		hook.render();
		hook.mount();
		await flush();
		const current = hook.render();
		const committed = current.data;
		const args = {
			saveHabit: [{ ...habit, name: 'Changed habit' }],
			removeHabit: [habit.id],
			toggleDate: [habit.id, key, completionTime],
		};
		const pending = current[action](...args[action]);
		assert.equal(hook.render().saving, true, action);
		assert.equal(hook.render().data, committed, action);
		for (const mutate of mutations(current)) assert.equal(await mutate(), false, action);
		assert.equal(await current.reload(), false, action);
		assert.equal(writes.length, 1, action);
		assert.deepEqual(writes[0].wallet, committed.wallet, action);
		assert.deepEqual(writes[0].trackers, committed.trackers, action);
		finishSave();
		assert.equal(await pending, true, action);
		assert.equal(hook.render().saving, false, action);
		assert.equal(hook.render().data, writes[0], action);
		hook.unmount();
	}
});

test('stale callbacks always act on latest committed ref across all action types', async () => {
	const writes = [];
	const hook = hookHarness({
		loadAppData: async () => initialApp(),
		saveAppData: async (data) => {
			writes.push(data);
		},
	});
	hook.render();
	hook.mount();
	await flush();
	const stale = hook.render();
	assert.equal(await stale.saveHabit(habit), true);
	assert.equal(await stale.toggleDate(habit.id, key, completionTime), true);
	assert.equal(await stale.saveHabit({ ...habit, name: 'Evening walk', completions: {} }), true);
	const committedHabits = plain(hook.render().data.habits);
	assert.equal(committedHabits.habits[0].completions[key], completionTime.toISOString());
	assert.equal(await stale.saveTracker(item), true);
	assert.equal(await stale.saveEntry(item.id, key, entry), true);
	assert.equal(hook.render().data.wallet.sources[0].amountMinor, 500);
	assert.equal(await stale.saveEntry(item.id, key, entry), true);
	assert.equal(hook.render().data.wallet.sources[0].amountMinor, 500);
	assert.equal(await stale.saveEntry(item.id, key, { ...entry, amountMinor: 600 }), true);
	assert.equal(hook.render().data.wallet.sources[0].amountMinor, 400);
	assert.equal(await stale.saveTracker({ ...item, name: 'Changed settings', entries: {} }), true);
	assert.equal(hook.render().data.trackers.items[0].entries[key].amountMinor, 600);
	assert.equal(
		await stale.updateSources([{ id: 'bank', name: 'Bank', amountMinor: 2000 }]),
		true,
	);
	assert.equal(await stale.deleteTracker(item.id), true);
	assert.equal(hook.render().data.wallet.sources[0].amountMinor, 2600);
	assert.equal(hook.render().data.trackers.items.length, 0);
	assert.deepEqual(plain(hook.render().data.habits), committedHabits);
	assert.equal(writes.length, 10);
	for (const data of writes.slice(3)) {
		assert.equal(data.version, 2);
		assert.deepEqual(plain(data.habits), committedHabits);
	}
	assert.equal(await stale.removeHabit(habit.id), true);
	assert.equal(hook.render().data.habits.habits.length, 0);
	assert.equal(hook.render().data.wallet.sources[0].amountMinor, 2600);
	assert.equal(writes.length, 11);
});

test('validation and storage failures preserve both committed state and ref and unlock', async () => {
	let fail = true;
	let writes = 0;
	const hook = hookHarness({
		loadAppData: async () =>
			appData.validateAppData(finance.saveRecurringItem(initial(), item)),
		saveAppData: async () => {
			writes++;
			if (fail) throw new Error('Storage full');
		},
	});
	hook.render();
	hook.mount();
	await flush();
	const stale = hook.render();
	const committed = stale.data;
	await assert.rejects(stale.saveEntry(item.id, key, entry), /Storage full/);
	assert.equal(hook.render().data, committed);
	assert.equal(hook.render().saving, false);
	await assert.rejects(stale.saveEntry(item.id, key, { ...entry, amountMinor: -1 }), /Amount/);
	await assert.rejects(stale.updateSources([]), /before deleting/);
	assert.equal(writes, 1);
	assert.equal(hook.render().saving, false);
	fail = false;
	assert.equal(await stale.saveEntry(item.id, key, entry), true);
	assert.equal(hook.render().data.wallet.sources[0].amountMinor, 500);
	assert.equal(writes, 2);
});

test('load failure blocks all writes until reload success, including after prior successful load', async () => {
	let fail = true;
	let writes = 0;
	const hook = hookHarness({
		loadAppData: async () => {
			if (fail) throw new Error('Corrupt data');
			return initialApp();
		},
		saveAppData: async () => {
			writes++;
		},
	});
	hook.render();
	hook.mount();
	await flush();
	let current = hook.render();
	assert.equal(current.data, null);
	assert.equal(current.loading, false);
	assert.match(current.loadError, /Stored data has not been changed/);
	for (const mutate of mutations(current)) assert.equal(await mutate(), false);
	assert.equal(writes, 0);
	fail = false;
	assert.equal(await current.reload(), true);
	current = hook.render();
	assert.equal(current.loadError, null);
	const committed = current.data;
	fail = true;
	assert.equal(await current.reload(), false);
	current = hook.render();
	assert.equal(current.data, committed);
	for (const mutate of mutations(current)) assert.equal(await mutate(), false);
	assert.equal(writes, 0);
	fail = false;
	assert.equal(await current.reload(), true);
	assert.equal(await current.saveTracker(item), true);
});

test('hook migrates real legacy finance and habits together without modifying either backup', async () => {
	const oldMoney = JSON.stringify(initial());
	const oldHabits = JSON.stringify({ version: 1, habits: [habit] });
	const storage = appStorageHarness({ [DATA]: oldMoney, [HABITS]: oldHabits });
	const hook = hookHarness(storage.api);
	assert.equal(hook.render().data, null);
	assert.equal(storage.reads.length, 0);
	hook.mount();
	await flush();
	const current = hook.render();
	assert.equal(current.loadError, null);
	assert.equal(current.loading, false);
	assert.deepEqual(plain(current.data), {
		...initialApp(),
		habits: { version: 1, habits: [habit] },
	});
	assert.deepEqual(storage.reads, [APP_DATA, DATA, HABITS]);
	assert.equal(storage.writes.length, 0);
	assert.equal(await current.saveTracker(item), true);
	assert.equal(await current.saveEntry(item.id, key, entry), true);
	assert.equal(await current.toggleDate(habit.id, key, completionTime), true);
	assert.equal(storage.writes.length, 3);
	assert.ok(storage.writes.every(([key]) => key === APP_DATA));
	const stored = JSON.parse(storage.values.get(APP_DATA));
	assert.equal(stored.version, 2);
	assert.equal(stored.wallet.sources[0].amountMinor, 500);
	assert.equal(stored.trackers.items[0].entries[key].applied.amountMinor, -500);
	assert.equal(stored.habits.habits[0].completions[key], completionTime.toISOString());
	assert.equal(storage.values.get(DATA), oldMoney);
	assert.equal(storage.values.get(HABITS), oldHabits);
	assert.equal(await current.reload(), true);
	assert.deepEqual(plain(hook.render().data), stored);
	assert.equal(storage.writes.length, 3);
	hook.unmount();
});

test('real app storage and hook keep wallet/history atomic on failed save, retry and restart', async () => {
	const data = appData.validateAppData(finance.saveRecurringItem(initial(), item));
	data.habits.habits.push(habit);
	const storage = appStorageHarness({ [APP_DATA]: JSON.stringify(data) });
	const hook = hookHarness(storage.api);
	hook.render();
	hook.mount();
	await flush();
	const current = hook.render();
	const oldRaw = storage.values.get(APP_DATA);
	const setItem = storage.native.setItem;
	let attempts = 0;
	storage.native.setItem = async () => {
		attempts++;
		throw new Error('Disk full');
	};
	await assert.rejects(current.saveEntry(item.id, key, entry), /Disk full/);
	assert.equal(attempts, 1);
	assert.equal(storage.values.get(APP_DATA), oldRaw);
	assert.equal(hook.render().data.wallet.sources[0].amountMinor, 1000);
	assert.equal(hook.render().data.trackers.items[0].entries[key], undefined);
	storage.native.setItem = setItem;
	assert.equal(await current.saveEntry(item.id, key, entry), true);
	assert.equal(storage.writes.length, 1);
	assert.equal(storage.writes[0][0], APP_DATA);
	const stored = JSON.parse(storage.values.get(APP_DATA));
	assert.equal(stored.version, 2);
	assert.deepEqual(stored.habits, data.habits);
	assert.equal(stored.wallet.sources[0].amountMinor, 500);
	assert.equal(stored.trackers.items[0].entries[key].applied.amountMinor, -500);
	assert.equal(await current.reload(), true);
	assert.equal(hook.render().data.wallet.sources[0].amountMinor, 500);
	assert.equal(storage.writes.length, 1);
	const restarted = hookHarness(storage.api);
	restarted.render();
	restarted.mount();
	await flush();
	assert.equal(restarted.render().data.wallet.sources[0].amountMinor, 500);
	assert.deepEqual(plain(restarted.render().data.habits), data.habits);
	assert.equal(await restarted.render().saveEntry(item.id, key, entry), true);
	assert.equal(restarted.render().data.wallet.sources[0].amountMinor, 500);
	assert.deepEqual(plain(restarted.render().data.habits), data.habits);
});

test('corrupt aggregate cannot be overwritten through hook even when valid legacy backups exist', async () => {
	const storage = appStorageHarness({
		[APP_DATA]: '{broken',
		[DATA]: JSON.stringify(initial()),
		[WALLET]: JSON.stringify(initial().wallet),
	});
	const hook = hookHarness(storage.api);
	hook.render();
	hook.mount();
	await flush();
	const current = hook.render();
	assert.ok(current.loadError);
	for (const mutate of mutations(current)) assert.equal(await mutate(), false);
	assert.deepEqual(storage.reads, [APP_DATA]);
	assert.equal(storage.writes.length, 0);
	assert.equal(storage.values.get(APP_DATA), '{broken');
});

function adapterSession() {
	let state = {
		data: initialApp(),
		loading: true,
		loadError: null,
		account: { id: 'google-sub', email: 'person@example.com', name: 'Person' },
		revision: 'revision-1',
		conflict: null,
		dirty: true,
		syncing: false,
		authenticating: false,
		syncError: null,
	};
	const listeners = new Set();
	const calls = { initialize: 0, subscribe: 0, unsubscribe: 0, sync: 0 };
	function emit(patch) {
		state = { ...state, ...patch };
		for (const listener of listeners) listener(state);
	}
	return {
		calls,
		emit,
		getState: () => state,
		subscribe(listener) {
			calls.subscribe++;
			listeners.add(listener);
			return () => {
				calls.unsubscribe++;
				listeners.delete(listener);
			};
		},
		async initialize() {
			calls.initialize++;
			assert.equal(listeners.size, 1, 'Subscribe before initialization emits');
			emit({ loading: false });
		},
		async sync() {
			calls.sync++;
			emit({ syncing: true });
			emit({ syncing: false, dirty: false, lastSyncedAt: '2026-11-12T09:00:00.000Z' });
			return true;
		},
	};
}
const availableAuth = { availability: () => ({ available: true, reason: null }) };

test('hook projects combined snapshots and exposes habit actions from its shared session', async () => {
	const session = adapterSession();
	const calls = [];
	for (const name of ['saveHabit', 'removeHabit', 'toggleDate', 'importGuestHabits']) {
		session[name] = async (...args) => {
			calls.push([name, ...args]);
			return true;
		};
	}
	const hook = hookHarness({}, { session, auth: availableAuth });
	hook.render();
	hook.mount();
	const data = initialApp();
	data.habits.habits.push(habit);
	session.emit({ data, canImportHabits: true });
	const current = hook.render();
	assert.equal(current.data, data);
	assert.equal(current.canImportHabits, true);
	assert.equal(current.account.id, 'google-sub');
	for (const name of ['saveHabit', 'removeHabit', 'toggleDate', 'importGuestHabits'])
		assert.equal(current[name], session[name]);
	assert.equal(await current.saveHabit(habit), true);
	assert.equal(await current.removeHabit(habit.id), true);
	assert.equal(await current.toggleDate(habit.id, key, completionTime), true);
	assert.equal(await current.importGuestHabits(), true);
	assert.deepEqual(calls, [
		['saveHabit', habit],
		['removeHabit', habit.id],
		['toggleDate', habit.id, key, completionTime],
		['importGuestHabits'],
	]);
	hook.unmount();
});

test('hook subscribes before initialize, keeps one session, and cleans up lifecycle subscriptions', () => {
	const session = adapterSession();
	const hook = hookHarness({}, { session, auth: availableAuth });
	assert.equal(hook.render().loading, true);
	hook.mount();
	assert.equal(hook.render().loading, false);
	hook.render();
	assert.equal(session.calls.initialize, 1);
	assert.equal(session.calls.subscribe, 1);
	assert.deepEqual(hook.creations, { auth: 1, drive: 1, session: 1 });
	assert.equal(hook.listenerCount(), 1);
	assert.equal(hook.pendingTimers(), 1);
	hook.unmount();
	assert.equal(session.calls.unsubscribe, 1);
	assert.equal(hook.listenerCount(), 0);
	assert.equal(hook.pendingTimers(), 0);
	hook.advance(2000);
	hook.appState('active');
	assert.equal(session.calls.sync, 0);
});

test('hook debounces revisions once and acknowledgement emissions do not create a sync loop', async () => {
	const session = adapterSession();
	const hook = hookHarness({}, { session, auth: availableAuth });
	hook.render();
	hook.mount();
	hook.render();
	hook.advance(1000);
	session.emit({ revision: 'revision-2' });
	hook.render();
	hook.advance(1000);
	session.emit({ revision: 'revision-3' });
	hook.render();
	hook.advance(1499);
	assert.equal(session.calls.sync, 0);
	assert.equal(hook.pendingTimers(), 1);
	hook.advance(1);
	await flush();
	assert.equal(session.calls.sync, 1);
	assert.equal(hook.render().dirty, false);
	assert.equal(hook.pendingTimers(), 0);
	session.emit({ saving: false, syncing: false, lastSyncedAt: '2026-11-12T09:01:00.000Z' });
	hook.render();
	hook.advance(10000);
	assert.equal(session.calls.sync, 1);
	hook.unmount();
});

test('financial editor pause cancels revision sync and foreground sync reads the latest pause', async () => {
	const session = adapterSession();
	const hook = hookHarness({}, { session, auth: availableAuth });
	hook.render();
	hook.mount();
	hook.render();
	hook.advance(1000);
	hook.render({ pauseSync: true });
	assert.equal(hook.pendingTimers(), 0);
	session.emit({ revision: 'editor-revision' });
	hook.render({ pauseSync: true });
	hook.appState('background');
	hook.appState('active');
	hook.advance(5000);
	assert.equal(session.calls.sync, 0);
	hook.render({ pauseSync: false });
	assert.equal(hook.pendingTimers(), 1);
	hook.advance(1500);
	await flush();
	hook.render({ pauseSync: false });
	assert.equal(session.calls.sync, 1);
	hook.appState('inactive');
	assert.equal(session.calls.sync, 1);
	hook.appState('active');
	await flush();
	assert.equal(session.calls.sync, 2);
	hook.render({ pauseSync: true });
	hook.appState('active');
	assert.equal(
		session.calls.sync,
		2,
		'Existing foreground callback must not capture stale pause',
	);
	hook.unmount();
});

test('hook does not schedule automatic sync while loading, failed, conflicted, signed out, or unavailable', () => {
	for (const patch of [
		{ loading: true },
		{ loadError: 'Corrupt cache' },
		{ conflict: { heads: [] } },
		{ account: null },
	]) {
		const session = adapterSession();
		const hook = hookHarness({}, { session, auth: availableAuth });
		hook.render();
		hook.mount();
		session.emit(patch);
		hook.render();
		assert.equal(hook.pendingTimers(), 0, JSON.stringify(patch));
		hook.unmount();
	}
	const session = adapterSession();
	const hook = hookHarness({}, { session });
	hook.render();
	hook.mount();
	hook.render();
	hook.appState('active');
	assert.equal(hook.pendingTimers(), 0);
	assert.equal(session.calls.sync, 0);
	hook.unmount();
});

test('hook surfaces background account storage failure and preserves data until a successful retry', async () => {
	const account = { id: 'google-sub', email: 'person@example.com', name: 'Person' };
	let fail = true;
	let writes = 0;
	const hook = hookHarness(
		{ loadAppData: async () => initialApp() },
		{
			auth: { ...availableAuth, accessToken: async () => 'fake-access-token' },
			drive: { listHeads: async () => ({ heads: [], nodes: [] }) },
			cloudStorage: {
				loadActiveAccount: async () => account,
				loadAccountData: async () => ({
					version: 1,
					accountId: account.id,
					data: initial(),
					localRevision: null,
					baseRevision: null,
					dirty: false,
					lastSyncedAt: null,
					pendingParents: null,
				}),
				saveAccountData: async () => {
					writes++;
					if (fail) throw new Error('Private disk failure details');
				},
			},
		},
	);
	hook.render();
	hook.mount();
	await flush();
	const committed = hook.render().data;
	hook.advance(1500);
	await flush();
	let current = hook.render();
	assert.equal(writes, 1);
	assert.match(current.syncError, /Could not save sync status on this phone/);
	assert.doesNotMatch(current.syncError, /Private disk/);
	assert.equal(current.data, committed);
	assert.equal(current.saving, false);
	assert.equal(current.syncing, false);
	assert.equal(hook.pendingTimers(), 0);
	hook.appState('active');
	await flush();
	assert.equal(writes, 2);
	assert.match(hook.render().syncError, /Could not save sync status/);
	fail = false;
	assert.equal(await current.sync(), true);
	current = hook.render();
	assert.equal(writes, 3);
	assert.equal(current.syncError, null);
	assert.deepEqual(current.data, initialApp());
	hook.unmount();
});

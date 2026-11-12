const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { transformFileSync } = require('@babel/core');
const finance = require('../src/utils/finance');

function loadModule(path, modules) {
	const exports = {};
	const { code } = transformFileSync(require.resolve(path), {
		babelrc: false,
		configFile: false,
		plugins: ['@babel/plugin-transform-modules-commonjs'],
	});
	vm.runInNewContext(code, {
		exports,
		require(name) {
			if (name in modules) return modules[name];
			throw new Error(`Unexpected import: ${name}`);
		},
	});
	return exports;
}

const DATA = '@money-tracker/data';
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

function hookHarness(storage) {
	const states = [];
	const refs = [];
	const effects = [];
	let stateIndex;
	let refIndex;
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
		useEffect(effect) {
			if (!effects.length) effects.push(effect);
		},
	};
	const { useMoneyData } = loadModule('../src/hooks/useMoneyData.js', {
		react,
		'../storage/moneyStorage': storage,
		'../utils/finance': finance,
	});
	return {
		render() {
			stateIndex = 0;
			refIndex = 0;
			return useMoneyData();
		},
		mount() {
			effects[0]();
		},
	};
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
const mutations = (hook) => [
	() => hook.updateSources([]),
	() => hook.saveTracker(item),
	() => hook.saveEntry(item.id, key, entry),
	() => hook.deleteTracker(item.id),
];

test('hook starts null, guards all writes before load and blocks duplicate loads', async () => {
	let finishLoad;
	let loads = 0;
	let writes = 0;
	const hook = hookHarness({
		loadMoneyData: () => {
			loads++;
			return new Promise((resolve) => {
				finishLoad = resolve;
			});
		},
		saveMoneyData: async () => {
			writes++;
		},
	});
	const current = hook.render();
	assert.equal(current.data, null);
	assert.equal(current.loading, true);
	for (const mutate of mutations(current)) assert.equal(await mutate(), false);
	hook.mount();
	assert.equal(await current.reload(), false);
	for (const mutate of mutations(current)) assert.equal(await mutate(), false);
	assert.equal(loads, 1);
	assert.equal(writes, 0);
	finishLoad(initial());
	await flush();
	assert.equal(hook.render().loading, false);
	assert.deepEqual(hook.render().data, initial());
});

test('one synchronous shared save lock guards all mutations and reload; commit follows persistence', async () => {
	let finishSave;
	const writes = [];
	const hook = hookHarness({
		loadMoneyData: async () => initial(),
		saveMoneyData: (data) => {
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

test('stale callbacks always act on latest committed ref across all action types', async () => {
	const writes = [];
	const hook = hookHarness({
		loadMoneyData: async () => initial(),
		saveMoneyData: async (data) => {
			writes.push(data);
		},
	});
	hook.render();
	hook.mount();
	await flush();
	const stale = hook.render();
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
	assert.equal(writes.length, 7);
});

test('validation and storage failures preserve both committed state and ref and unlock', async () => {
	let fail = true;
	let writes = 0;
	const hook = hookHarness({
		loadMoneyData: async () => finance.saveRecurringItem(initial(), item),
		saveMoneyData: async () => {
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
		loadMoneyData: async () => {
			if (fail) throw new Error('Corrupt data');
			return initial();
		},
		saveMoneyData: async () => {
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

test('real aggregate storage and hook keep wallet/history atomic on failed save, retry and restart', async () => {
	const data = finance.saveRecurringItem(initial(), item);
	const storage = storageHarness({ [DATA]: JSON.stringify(data) });
	const hook = hookHarness(storage.api);
	hook.render();
	hook.mount();
	await flush();
	const current = hook.render();
	const oldRaw = storage.values.get(DATA);
	const setItem = storage.native.setItem;
	let attempts = 0;
	storage.native.setItem = async () => {
		attempts++;
		throw new Error('Disk full');
	};
	await assert.rejects(current.saveEntry(item.id, key, entry), /Disk full/);
	assert.equal(attempts, 1);
	assert.equal(storage.values.get(DATA), oldRaw);
	assert.equal(hook.render().data.wallet.sources[0].amountMinor, 1000);
	assert.equal(hook.render().data.trackers.items[0].entries[key], undefined);
	storage.native.setItem = setItem;
	assert.equal(await current.saveEntry(item.id, key, entry), true);
	assert.equal(storage.writes.length, 1);
	const stored = JSON.parse(storage.values.get(DATA));
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
	assert.equal(await restarted.render().saveEntry(item.id, key, entry), true);
	assert.equal(restarted.render().data.wallet.sources[0].amountMinor, 500);
});

test('corrupt aggregate cannot be overwritten through hook even when valid legacy backups exist', async () => {
	const storage = storageHarness({
		[DATA]: '{broken',
		[WALLET]: JSON.stringify(initial().wallet),
	});
	const hook = hookHarness(storage.api);
	hook.render();
	hook.mount();
	await flush();
	const current = hook.render();
	assert.ok(current.loadError);
	for (const mutate of mutations(current)) assert.equal(await mutate(), false);
	assert.deepEqual(storage.reads, [DATA]);
	assert.equal(storage.writes.length, 0);
	assert.equal(storage.values.get(DATA), '{broken');
});

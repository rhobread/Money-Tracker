const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
	validateFinanceData,
	updateMoneySources,
	saveRecurringItem,
	saveRecurringEntry,
	deleteRecurringItem,
} = require('../src/utils/finance');
const { totalMinor } = require('../src/utils/money');
const { effectiveSourceId } = require('../src/utils/trackers');

const key = '2024-01-31';
const item = (changes = {}) => ({
	id: 'rent',
	name: 'Rent',
	kind: 'payment',
	amountMinor: 500,
	frequency: 'monthly',
	startDate: key,
	defaultSourceId: 'bank',
	entries: {},
	...changes,
});
const entry = (changes = {}) => ({
	dueDate: key,
	paid: true,
	paidDate: '2024-02-01',
	amountMinor: 500,
	sourceId: null,
	...changes,
});
const initial = (kind = 'payment') =>
	validateFinanceData({
		version: 1,
		wallet: {
			version: 3,
			currency: 'IDR',
			updatedAt: null,
			sources: [
				{ id: 'bank', name: 'Bank', amountMinor: 1000 },
				{ id: 'cash', name: 'Cash', amountMinor: 200 },
			],
		},
		trackers: { version: 2, items: [item({ kind })] },
	});
const balances = (data) => data.wallet.sources.map((source) => source.amountMinor);
const savedEntry = (data, date = key) => data.trackers.items[0].entries[date];
function freeze(value) {
	if (value && typeof value === 'object') {
		Object.values(value).forEach(freeze);
		Object.freeze(value);
	}
	return value;
}

test('income adds, payment subtracts, totals follow, snapshots pin the effective source', () => {
	for (const [kind, sign] of [
		['income', 1],
		['payment', -1],
	]) {
		const before = freeze(initial(kind));
		const next = saveRecurringEntry(before, 'rent', key, entry());
		assert.deepEqual(balances(next), [1000 + sign * 500, 200]);
		assert.equal(totalMinor(next.wallet.sources), 1200 + sign * 500);
		assert.deepEqual(savedEntry(next).applied, { sourceId: 'bank', amountMinor: sign * 500 });
		assert.equal(savedEntry(next).sourceId, 'bank');
		assert.ok(Number.isFinite(Date.parse(next.wallet.updatedAt)));
		assert.deepEqual(balances(before), [1000, 200]);
		assert.equal(before.trackers.items[0].entries[key], undefined);
	}
});

test('repeat paid saves, date-only edits and restart are idempotent and ignore editor snapshots', () => {
	let current = saveRecurringEntry(initial(), 'rent', key, entry({ applied: 'untrusted' }));
	const timestamp = current.wallet.updatedAt;
	current = validateFinanceData(JSON.parse(JSON.stringify(current)));
	for (let index = 0; index < 4; index++) {
		current = saveRecurringEntry(current, 'rent', key, {
			...savedEntry(current),
			dueDate: '2024-02-02',
			paidDate: '2024-02-03',
			applied: { sourceId: 'cash', amountMinor: 999999 },
		});
		assert.deepEqual(balances(current), [500, 200]);
		assert.equal(current.wallet.updatedAt, timestamp);
		assert.deepEqual(savedEntry(current).applied, { sourceId: 'bank', amountMinor: -500 });
	}
});

test('amount and source changes refund the old posting and apply only the new posting', () => {
	for (const [kind, sign] of [
		['income', 1],
		['payment', -1],
	]) {
		let current = saveRecurringEntry(initial(kind), 'rent', key, entry());
		current = saveRecurringEntry(current, 'rent', key, entry({ amountMinor: 700 }));
		assert.deepEqual(balances(current), [1000 + sign * 700, 200]);
		current = saveRecurringEntry(
			current,
			'rent',
			key,
			entry({ sourceId: 'cash', amountMinor: 800 }),
		);
		assert.deepEqual(balances(current), [1000, 200 + sign * 800]);
		current = saveRecurringEntry(
			current,
			'rent',
			key,
			entry({
				paid: false,
				paidDate: null,
				sourceId: 'cash',
				amountMinor: 800,
			}),
		);
		assert.deepEqual(balances(current), [1000, 200]);
		assert.equal(savedEntry(current).applied, null);
		current = saveRecurringEntry(
			current,
			'rent',
			key,
			entry({
				paid: false,
				paidDate: null,
				sourceId: 'cash',
				amountMinor: 800,
			}),
		);
		assert.deepEqual(balances(current), [1000, 200]);
	}
});

test('default edits preserve paid history, overrides and settings edits preserve all entries', () => {
	let current = saveRecurringEntry(initial(), 'rent', key, entry());
	current = saveRecurringEntry(
		current,
		'rent',
		'2024-02-29',
		entry({
			paid: false,
			paidDate: null,
			sourceId: 'bank',
		}),
	);
	const entries = current.trackers.items[0].entries;
	const timestamp = current.wallet.updatedAt;
	current = saveRecurringItem(
		current,
		item({
			defaultSourceId: 'cash',
			name: ' Rent updated ',
			amountMinor: 900,
			frequency: 'yearly',
			startDate: '2025-03-01',
			entries: { garbage: true },
		}),
	);
	assert.deepEqual(current.trackers.items[0].entries, entries);
	assert.equal(current.trackers.items[0].name, 'Rent updated');
	assert.deepEqual(balances(current), [500, 200]);
	assert.equal(current.wallet.updatedAt, timestamp);
	assert.equal(effectiveSourceId(current.trackers.items[0], savedEntry(current)), 'bank');
	current = saveRecurringEntry(current, 'rent', key, savedEntry(current));
	assert.deepEqual(balances(current), [500, 200]);
	current = saveRecurringEntry(current, 'rent', '2024-03-31', entry());
	assert.deepEqual(balances(current), [500, -300]);
	assert.equal(savedEntry(current, '2024-03-31').sourceId, 'cash');
	current = saveRecurringEntry(current, 'rent', key, entry({ sourceId: null }));
	assert.deepEqual(balances(current), [1000, -800]);
	assert.equal(savedEntry(current).sourceId, 'cash');
});

test('legacy paid/null entries never post during migration or paid edits; unpay/recheck posts', () => {
	const original = initial('income');
	const legacy = item({ kind: 'income', entries: { [key]: entry() } });
	delete legacy.defaultSourceId;
	delete legacy.entries[key].sourceId;
	let current = validateFinanceData({ ...original, trackers: { version: 1, items: [legacy] } });
	assert.deepEqual(balances(current), [1000, 200]);
	assert.equal(savedEntry(current).applied, null);
	assert.equal(savedEntry(current).sourceId, null);
	assert.equal(current.trackers.items[0].defaultSourceId, null);
	current = saveRecurringItem(current, item({ kind: 'income', defaultSourceId: 'cash' }));
	current = saveRecurringEntry(
		current,
		'rent',
		key,
		entry({
			amountMinor: 900,
			sourceId: 'bank',
			dueDate: '2024-02-02',
			paidDate: '2024-02-04',
		}),
	);
	assert.deepEqual(balances(current), [1000, 200]);
	assert.equal(savedEntry(current).applied, null);
	const roundtrip = validateFinanceData(JSON.parse(JSON.stringify(current)));
	assert.deepEqual(roundtrip, current);
	current = saveRecurringEntry(current, 'rent', key, entry({ paid: false, paidDate: null }));
	assert.deepEqual(balances(current), [1000, 200]);
	current = saveRecurringEntry(current, 'rent', key, entry({ amountMinor: 900 }));
	assert.deepEqual(balances(current), [1000, 1100]);
	assert.equal(savedEntry(current).sourceId, 'cash');
});

test('new item ignores incoming history and an existing item cannot change kind', () => {
	const before = freeze(initial());
	const next = saveRecurringItem(
		before,
		item({ id: 'salary', kind: 'income', entries: { [key]: entry() } }),
	);
	assert.deepEqual(next.trackers.items[1].entries, {});
	assert.deepEqual(balances(next), [1000, 200]);
	assert.throws(() => saveRecurringItem(before, item({ kind: 'income' })), /cannot change/);
	assert.throws(() => saveRecurringItem(before, item({ name: ' ' })), /Name/);
	assert.throws(() => saveRecurringItem(before, item({ startDate: '2024-02-30' })), /date/);
});

test('manual balance edits are absolute, future transactions use only their posting delta', () => {
	let current = saveRecurringEntry(initial(), 'rent', key, entry());
	current = updateMoneySources(current, [
		{ id: 'bank', name: 'Renamed bank', amountMinor: 3000 },
		{ id: 'cash', name: 'Cash', amountMinor: -50 },
	]);
	assert.deepEqual(balances(current), [3000, -50]);
	assert.deepEqual(savedEntry(current).applied, { sourceId: 'bank', amountMinor: -500 });
	current = saveRecurringEntry(current, 'rent', key, savedEntry(current));
	assert.deepEqual(balances(current), [3000, -50]);
	current = saveRecurringEntry(current, 'rent', key, entry({ paid: false, paidDate: null }));
	assert.deepEqual(balances(current), [3500, -50]);
});

test('delete reverses only applied entries across sources, ignoring legacy and unpaid history', () => {
	for (const kind of ['income', 'payment']) {
		let current = initial(kind);
		current.trackers.items[0].entries['2024-03-31'] = {
			...entry(),
			sourceId: null,
			applied: null,
		};
		current = saveRecurringEntry(current, 'rent', key, entry());
		current = saveRecurringEntry(
			current,
			'rent',
			'2024-02-29',
			entry({ sourceId: 'cash', amountMinor: 200 }),
		);
		current = deleteRecurringItem(current, 'rent');
		assert.deepEqual(balances(current), [1000, 200]);
		assert.deepEqual(current.trackers.items, []);
		assert.throws(() => deleteRecurringItem(current, 'missing'), /could not be found/);
	}
});

test('source deletion is blocked for default, unpaid override, legacy override and applied history', () => {
	for (const mode of ['default', 'unpaid', 'legacy', 'applied']) {
		let current = initial();
		if (mode !== 'default') {
			current = saveRecurringItem(current, item({ defaultSourceId: null }));
			if (mode === 'legacy') {
				current.trackers.items[0].entries[key] = {
					...entry({ sourceId: 'bank' }),
					applied: null,
				};
			} else {
				current = saveRecurringEntry(
					current,
					'rent',
					key,
					entry({
						sourceId: 'bank',
						paid: mode === 'applied',
						paidDate: mode === 'applied' ? key : null,
					}),
				);
			}
		}
		const before = JSON.stringify(current);
		assert.throws(
			() => updateMoneySources(current, current.wallet.sources.slice(1)),
			/before deleting/,
		);
		assert.equal(JSON.stringify(current), before);
	}
	const cleared = saveRecurringItem(initial(), item({ defaultSourceId: null }));
	assert.equal(updateMoneySources(cleared, []).wallet.sources.length, 0);
});

test('missing source cannot post, references must exist even when not currently effective', () => {
	const current = saveRecurringItem(initial(), item({ defaultSourceId: null }));
	assert.throws(() => saveRecurringEntry(current, 'rent', key, entry()), /Choose an existing/);
	assert.throws(
		() => saveRecurringEntry(current, 'rent', key, entry({ sourceId: 'gone' })),
		/existing money source/,
	);
	assert.throws(
		() =>
			saveRecurringEntry(
				current,
				'rent',
				key,
				entry({
					paid: false,
					paidDate: null,
					sourceId: 'gone',
				}),
			),
		/missing money source/,
	);
	assert.throws(
		() => saveRecurringItem(current, item({ defaultSourceId: 'gone' })),
		/missing money source/,
	);
	assert.throws(() => saveRecurringEntry(current, 'missing', key, entry()), /could not be found/);
});

test('aggregate rejects malformed posting snapshots and inconsistent or missing references', () => {
	const valid = saveRecurringEntry(initial(), 'rent', key, entry());
	for (const change of [
		{ paid: false, paidDate: null },
		{ amountMinor: 501 },
		{ sourceId: 'cash' },
		{ sourceId: null },
		{ sourceId: 'gone', applied: { sourceId: 'gone', amountMinor: -500 } },
		{ applied: { sourceId: 'bank', amountMinor: 500 } },
		{ applied: { sourceId: 'bank', amountMinor: -500.1 } },
		{ applied: { sourceId: 'bank', amountMinor: Number.MIN_SAFE_INTEGER } },
		{ applied: undefined },
		{ applied: [] },
		{ applied: {} },
	]) {
		const bad = JSON.parse(JSON.stringify(valid));
		Object.assign(bad.trackers.items[0].entries[key], change);
		assert.throws(() => validateFinanceData(bad), JSON.stringify(change));
	}
	for (const bad of [null, {}, { ...valid, version: 2 }, { ...valid, wallet: null }]) {
		assert.throws(() => validateFinanceData(bad));
	}
});

test('negative balances and zero postings are valid; zero history is pinned and reversible', () => {
	let current = saveRecurringEntry(
		initial(),
		'rent',
		key,
		entry({ sourceId: 'cash', amountMinor: 300 }),
	);
	assert.deepEqual(balances(current), [1000, -100]);
	current = saveRecurringEntry(current, 'rent', '2024-02-29', entry({ amountMinor: 0 }));
	assert.deepEqual(savedEntry(current, '2024-02-29').applied, {
		sourceId: 'bank',
		amountMinor: 0,
	});
	assert.deepEqual(balances(deleteRecurringItem(current, 'rent')), [1000, 200]);
});

test('source bound overflow and reversal overflow fail without partial changes', () => {
	for (const [kind, limit] of [
		['income', 999999999999],
		['payment', -999999999999],
	]) {
		let current = initial(kind);
		current.wallet.sources[0].amountMinor = limit;
		freeze(current);
		const before = JSON.stringify(current);
		assert.throws(
			() => saveRecurringEntry(current, 'rent', key, entry({ amountMinor: 1 })),
			/smaller/,
		);
		assert.equal(JSON.stringify(current), before);
	}
	let current = saveRecurringEntry(initial(), 'rent', key, entry());
	current = updateMoneySources(current, [
		{ id: 'bank', name: 'Bank', amountMinor: 999999999999 },
		{ id: 'cash', name: 'Cash', amountMinor: 200 },
	]);
	freeze(current);
	const before = JSON.stringify(current);
	assert.throws(() => deleteRecurringItem(current, 'rent'), /smaller/);
	assert.throws(
		() => saveRecurringEntry(current, 'rent', key, entry({ sourceId: 'cash' })),
		/smaller/,
	);
	assert.equal(JSON.stringify(current), before);
});

test('exact total overflow fails even when each individual source fits its bound', () => {
	const max = 999999999999n;
	const sources = Array.from({ length: 9007 }, (_, index) => ({
		id: `s${index}`,
		name: 'Bank',
		amountMinor: Number(max),
	}));
	sources.push({
		id: 'bank',
		name: 'Target',
		amountMinor: Number(BigInt(Number.MAX_SAFE_INTEGER) - 9007n * max),
	});
	const current = validateFinanceData({
		...initial('income'),
		wallet: { ...initial().wallet, sources },
	});
	assert.equal(totalMinor(current.wallet.sources), Number.MAX_SAFE_INTEGER);
	freeze(current);
	const before = JSON.stringify(current);
	assert.throws(
		() => saveRecurringEntry(current, 'rent', key, entry({ amountMinor: 1 })),
		/total amount is too large/,
	);
	assert.equal(JSON.stringify(current), before);
});

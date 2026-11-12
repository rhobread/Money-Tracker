const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const {
	FREQUENCIES,
	todayDate,
	isValidDate,
	formatDate,
	validateTracker,
	validateTrackersData,
	occurrencesForYear,
	setOccurrence,
	createTrackerId,
} = require('../src/utils/trackers');

const tracker = (changes = {}) => ({
	id: 'rent',
	name: 'Rent',
	kind: 'income',
	amountMinor: 12300,
	frequency: 'monthly',
	startDate: '2024-01-31',
	entries: {},
	...changes,
});
const entry = (changes = {}) => ({
	dueDate: '2024-02-15',
	paid: true,
	paidDate: '2024-02-16',
	amountMinor: 500,
	...changes,
});
const keys = (value, year) => occurrencesForYear(value, year).map((item) => item.key);

test('date-only validation rejects rollover dates, times and unsupported years', () => {
	assert.deepEqual(FREQUENCIES, ['daily', 'weekly', 'monthly', 'yearly']);
	for (const value of ['1900-01-01', '2000-02-29', '2024-02-29', '9999-12-31'])
		assert.equal(isValidDate(value), true, value);
	for (const value of [
		'1900-02-29',
		'2023-02-29',
		'2024-04-31',
		'2024-00-01',
		'2024-13-01',
		'2024-01-00',
		'2024-01-32',
		'1899-12-31',
		'10000-01-01',
		'2024-1-01',
		'2024-01-01T00:00:00Z',
		' 2024-01-01',
		'',
		null,
		20240101,
	]) {
		assert.equal(isValidDate(value), false, String(value));
	}
	assert.equal(formatDate('2024-02-29'), '29 Februari 2024');
	assert.throws(() => formatDate('2024-02-30'), /YYYY-MM-DD/);
	const now = new Date();
	assert.equal(
		todayDate(),
		`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
	);
});

test('daily generation is bounded to the requested year and starts on the first due date', () => {
	const daily = tracker({ frequency: 'daily', startDate: '1900-01-01' });
	assert.equal(keys(daily, 2024).length, 366);
	assert.equal(keys(daily, 2025).length, 365);
	assert.equal(keys(daily, 9999).length, 365);
	assert.equal(keys(daily, 9999).at(-1), '9999-12-31');
	assert.deepEqual(keys(tracker({ frequency: 'daily', startDate: '2024-12-30' }), 2024), [
		'2024-12-30',
		'2024-12-31',
	]);
	assert.deepEqual(keys(tracker({ startDate: '2025-01-01' }), 2024), []);
	assert.deepEqual(daily.entries, {});
});

test('weekly generation keeps the weekday anchored across year and leap boundaries', () => {
	const weekly = tracker({ frequency: 'weekly', startDate: '2023-12-29' });
	const dates = keys(weekly, 2024);
	assert.equal(dates[0], '2024-01-05');
	assert.equal(dates.at(-1), '2024-12-27');
	assert.equal(dates.length, 52);
	assert.ok(dates.every((date) => new Date(`${date}T00:00:00Z`).getUTCDay() === 5));
	assert.deepEqual(keys(tracker({ frequency: 'weekly', startDate: '9999-12-30' }), 9999), [
		'9999-12-30',
	]);
});

test('monthly recurrence clamps short months and restores the original day', () => {
	assert.deepEqual(keys(tracker(), 2024), [
		'2024-01-31',
		'2024-02-29',
		'2024-03-31',
		'2024-04-30',
		'2024-05-31',
		'2024-06-30',
		'2024-07-31',
		'2024-08-31',
		'2024-09-30',
		'2024-10-31',
		'2024-11-30',
		'2024-12-31',
	]);
	assert.equal(keys(tracker({ startDate: '2023-01-31' }), 2023)[1], '2023-02-28');
	assert.deepEqual(keys(tracker({ startDate: '2024-11-30' }), 2024), [
		'2024-11-30',
		'2024-12-30',
	]);
	assert.deepEqual(keys(tracker({ startDate: '9999-12-31' }), 9999), ['9999-12-31']);
});

test('yearly leap-day recurrence clamps February and restores leap day', () => {
	const yearly = tracker({ frequency: 'yearly', startDate: '2024-02-29' });
	assert.deepEqual(keys(yearly, 2023), []);
	assert.deepEqual(keys(yearly, 2024), ['2024-02-29']);
	assert.deepEqual(keys(yearly, 2025), ['2025-02-28']);
	assert.deepEqual(keys(yearly, 2028), ['2028-02-29']);
	assert.deepEqual(keys(yearly, 2100), ['2100-02-28']);
});

test('override amount, due date and paid history survive schedule edits and unchecking', () => {
	const original = tracker();
	const saved = setOccurrence(original, '2024-01-31', entry({ dueDate: '2025-01-02' }));
	assert.deepEqual(original.entries, {});
	let occurrences = occurrencesForYear(saved, 2024);
	assert.equal(occurrences.length, 12);
	assert.deepEqual(occurrences.at(-1), {
		key: '2024-01-31',
		scheduledDate: '2024-01-31',
		...entry({ dueDate: '2025-01-02' }),
	});
	assert.equal(
		occurrencesForYear(saved, 2025).some((item) => item.key === '2024-01-31'),
		false,
	);
	const edited = validateTracker({
		...saved,
		frequency: 'yearly',
		startDate: '2026-06-01',
		amountMinor: 999,
	});
	assert.deepEqual(keys(edited, 2024), ['2024-01-31']);
	const unchecked = setOccurrence(edited, '2024-01-31', {
		...saved.entries['2024-01-31'],
		paid: false,
		paidDate: null,
	});
	occurrences = occurrencesForYear(unchecked, 2024);
	assert.equal(occurrences[0].amountMinor, 500);
	assert.equal(occurrences[0].dueDate, '2025-01-02');
	assert.equal(occurrences[0].paid, false);
	assert.equal(occurrences[0].paidDate, null);
	assert.equal(saved.entries['2024-01-31'].paid, true);
	assert.equal(occurrencesForYear(edited, 2026)[0].amountMinor, 999);
});

test('saved entries are sorted by due date then nominal key, including off-series dates', () => {
	const value = tracker({
		startDate: '2027-01-01',
		entries: {
			'2024-03-02': entry({ dueDate: '2024-02-01' }),
			'2024-01-01': entry({ dueDate: '2024-02-01' }),
			'2024-12-01': entry({ dueDate: '2023-12-01' }),
		},
	});
	assert.deepEqual(keys(value, 2024), ['2024-12-01', '2024-01-01', '2024-03-02']);
});

test('tracker validation normalizes copies and rejects invalid required fields', () => {
	const value = tracker({ id: ' rent ', name: '  Rent  ', entries: { '2024-01-31': entry() } });
	const normalized = validateTracker(value);
	assert.equal(normalized.id, 'rent');
	assert.equal(normalized.name, 'Rent');
	assert.notEqual(normalized.entries, value.entries);
	assert.notEqual(normalized.entries['2024-01-31'], value.entries['2024-01-31']);
	for (const changes of [
		{ id: '' },
		{ id: 1 },
		{ name: ' ' },
		{ name: 'a'.repeat(81) },
		{ kind: 'expense' },
		{ kind: null },
		{ frequency: 'fortnightly' },
		{ startDate: '2024-02-30' },
		{ entries: null },
		{ entries: [] },
		{ entries: { invalid: entry() } },
		{ entries: { '2024-01-01': null } },
	]) {
		assert.throws(() => validateTracker(tracker(changes)), JSON.stringify(changes));
	}
	for (const amountMinor of [
		-1,
		0.1,
		NaN,
		Infinity,
		1e12,
		Number.MAX_SAFE_INTEGER,
		'100',
		null,
	]) {
		assert.throws(() => validateTracker(tracker({ amountMinor })), /Amount/);
		assert.throws(
			() => setOccurrence(tracker(), '2024-01-31', entry({ amountMinor })),
			/Amount/,
		);
	}
	for (const amountMinor of [0, 999999999999])
		assert.equal(
			validateTracker(tracker({ kind: 'payment', amountMinor })).amountMinor,
			amountMinor,
		);
	for (const year of [1899, 10000, 2024.5, '2024', NaN])
		assert.throws(() => occurrencesForYear(tracker(), year), /Year/);
});

test('entry validation requires real dates, explicit boolean paid and consistent paid date', () => {
	for (const changes of [
		{ dueDate: '2024-04-31' },
		{ paid: 'true' },
		{ paid: 0 },
		{ paidDate: null },
		{ paidDate: '2023-02-29' },
		{ paidDate: undefined },
		{ paid: false, paidDate: '2024-02-16' },
		{ paid: false, paidDate: undefined },
	]) {
		assert.throws(
			() => setOccurrence(tracker(), '2024-01-31', entry(changes)),
			JSON.stringify(changes),
		);
	}
	assert.throws(() => setOccurrence(tracker(), '2024-02-30', entry()), /Scheduled date/);
	assert.throws(() => setOccurrence(tracker(), '__proto__', entry()), /Scheduled date/);
	assert.doesNotThrow(() =>
		setOccurrence(tracker(), '2024-01-31', entry({ paid: false, paidDate: null })),
	);
});

test('versioned validation enforces unique normalized IDs and full tracker validation', () => {
	assert.deepEqual(validateTrackersData({ version: 1, items: [] }), { version: 1, items: [] });
	for (const value of [
		null,
		{},
		{ version: 2, items: [] },
		{ version: 1, items: {} },
		{ version: 1, items: [tracker(), tracker({ id: ' rent ' })] },
		{ version: 1, items: [tracker({ amountMinor: -1 })] },
	]) {
		assert.throws(() => validateTrackersData(value));
	}
});

test('locally generated IDs avoid collisions even when clock and random repeat', () => {
	const originalNow = Date.now;
	const originalRandom = Math.random;
	Date.now = () => 123;
	Math.random = () => 0.5;
	try {
		const first = createTrackerId([]);
		const second = createTrackerId([{ id: first }]);
		const third = createTrackerId([{ id: first }, { id: second }]);
		assert.equal(new Set([first, second, third]).size, 3);
	} finally {
		Date.now = originalNow;
		Math.random = originalRandom;
	}
});

test('calendar recurrence has no timezone or DST drift and today uses the local date', () => {
	const modulePath = JSON.stringify(require.resolve('../src/utils/trackers'));
	const code = `const RealDate = Date; global.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : ['2026-01-01T00:30:00Z'])); } }; const t = require(${modulePath}); console.log(JSON.stringify({today:t.todayDate(), dates:t.occurrencesForYear(${JSON.stringify(tracker({ frequency: 'daily', startDate: '2024-03-09' }))},2024).map(x=>x.key)}));`;
	const results = ['UTC', 'America/New_York', 'Asia/Jakarta'].map((TZ) =>
		JSON.parse(
			execFileSync(process.execPath, ['-e', code], {
				env: { ...process.env, TZ },
				encoding: 'utf8',
			}),
		),
	);
	assert.equal(results[0].today, '2026-01-01');
	assert.equal(results[1].today, '2025-12-31');
	assert.equal(results[2].today, '2026-01-01');
	assert.deepEqual(results[0].dates, results[1].dates);
	assert.deepEqual(results[0].dates, results[2].dates);
	assert.deepEqual(results[1].dates.slice(0, 3), ['2024-03-09', '2024-03-10', '2024-03-11']);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const {
	WEEKDAYS,
	DEFAULT_HABIT_DAYS,
	todayDate,
	isValidDate,
	validateHabitData,
	createEmptyHabitData,
	habitDaysForWeek,
	weekStart,
	shiftDate,
	upsertHabit,
	deleteHabit,
	toggleHabitDate,
} = require('../src/utils/habits');

const habit = (changes = {}) => ({
	id: 'workout',
	name: 'Workout',
	kind: 'good',
	days: [1, 2, 4, 5],
	startDate: '2024-01-01',
	completions: {},
	...changes,
});
const data = (changes) => ({ version: 1, habits: [habit(changes)] });
const now = new Date('2024-03-12T12:34:56.789Z');

test('weekday order, workout defaults, shared local date helpers and fresh empty data', () => {
	assert.deepEqual(WEEKDAYS, [
		{ day: 1, label: 'Mon' },
		{ day: 2, label: 'Tue' },
		{ day: 3, label: 'Wed' },
		{ day: 4, label: 'Thu' },
		{ day: 5, label: 'Fri' },
		{ day: 6, label: 'Sat' },
		{ day: 0, label: 'Sun' },
	]);
	assert.deepEqual(DEFAULT_HABIT_DAYS, [1, 2, 4, 5]);
	assert.equal(todayDate, require('../src/utils/trackers').todayDate);
	assert.equal(isValidDate, require('../src/utils/trackers').isValidDate);
	const first = createEmptyHabitData();
	first.habits.push(habit());
	assert.deepEqual(createEmptyHabitData(), { version: 1, habits: [] });
	const created = upsertHabit(createEmptyHabitData(), { name: 'Workout', kind: 'good' });
	assert.deepEqual(created.habits[0].days, DEFAULT_HABIT_DAYS);
	assert.equal(created.habits[0].startDate, todayDate());
	assert.match(created.habits[0].id, /^habit-/);
	assert.deepEqual(created.habits[0].completions, {});
	assert.deepEqual(
		upsertHabit(createEmptyHabitData(), { name: 'Smoking', kind: 'bad' }).habits[0].days,
		[1, 2, 3, 4, 5, 6, 0],
	);
});

test('weekly checklist is Mon-Sun, honors start date and supports daily checklists', () => {
	assert.deepEqual(habitDaysForWeek(habit(), '2024-03-10'), [
		'2024-03-04',
		'2024-03-05',
		'2024-03-07',
		'2024-03-08',
	]);
	assert.deepEqual(habitDaysForWeek(habit({ startDate: '2024-03-06' }), '2024-03-10'), [
		'2024-03-07',
		'2024-03-08',
	]);
	assert.deepEqual(habitDaysForWeek(habit({ startDate: '2024-03-11' }), '2024-03-10'), []);
	const daily = habit({ days: [0, 6, 5, 4, 3, 2, 1] });
	assert.deepEqual(habitDaysForWeek(daily, '2024-03-10'), [
		'2024-03-04',
		'2024-03-05',
		'2024-03-06',
		'2024-03-07',
		'2024-03-08',
		'2024-03-09',
		'2024-03-10',
	]);
	assert.ok(habitDaysForWeek(daily, '2024-03-10').includes('2024-03-06'));
	assert.equal(habitDaysForWeek(habit(), '2024-03-10').includes('2024-03-06'), false);
});

test('calendar helpers cross leap days, months and years, with bounded valid dates', () => {
	assert.equal(weekStart('2025-01-01'), '2024-12-30');
	assert.equal(weekStart('2024-12-30'), '2024-12-30');
	assert.equal(weekStart('1900-01-01'), '1900-01-01');
	assert.equal(shiftDate('2024-02-28', 1), '2024-02-29');
	assert.equal(shiftDate('2024-02-29', 1), '2024-03-01');
	assert.equal(shiftDate('2024-01-01', -1), '2023-12-31');
	assert.equal(shiftDate('2024-12-31', 1), '2025-01-01');
	assert.equal(shiftDate('2024-02-29', 0), '2024-02-29');
	assert.deepEqual(habitDaysForWeek(habit(), '2025-01-01'), [
		'2024-12-30',
		'2024-12-31',
		'2025-01-02',
		'2025-01-03',
	]);
	assert.deepEqual(habitDaysForWeek(habit({ days: [0, 1, 5, 6] }), '9999-12-31'), [
		'9999-12-27',
		'9999-12-31',
	]);
	for (const date of ['2023-02-29', '2024-04-31', '2024-1-01', '1899-12-31', null]) {
		assert.throws(() => shiftDate(date, 1), /YYYY-MM-DD/);
		assert.throws(() => weekStart(date), /YYYY-MM-DD/);
		assert.throws(() => habitDaysForWeek(habit(), date), /YYYY-MM-DD/);
	}
	for (const days of [0.5, '1', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
		assert.throws(() => shiftDate('2024-01-01', days), /whole number/);
	assert.throws(() => shiftDate('1900-01-01', -1), /1900 and 9999/);
	assert.throws(() => shiftDate('9999-12-31', 1), /1900 and 9999/);
	assert.throws(() => shiftDate('2024-01-01', Number.MAX_SAFE_INTEGER), /1900 and 9999/);
});

test('validation normalizes detached copies and preserves off-schedule historical completions', () => {
	const input = data({
		id: ' workout ',
		name: ' Workout ',
		days: [0, 5, 1],
		startDate: '2025-01-01',
		completions: { '2024-03-12': now.toISOString() },
	});
	const result = validateHabitData(input);
	assert.equal(result.habits[0].id, 'workout');
	assert.equal(result.habits[0].name, 'Workout');
	assert.deepEqual(result.habits[0].days, [1, 5, 0]);
	assert.deepEqual(result.habits[0].completions, input.habits[0].completions);
	result.habits[0].days.push(6);
	delete result.habits[0].completions['2024-03-12'];
	assert.deepEqual(input.habits[0].days, [0, 5, 1]);
	assert.equal(input.habits[0].completions['2024-03-12'], now.toISOString());
});

test('corrupt versions, habits, duplicate IDs, schedules, dates and timestamps are rejected', () => {
	for (const value of [
		null,
		[],
		{},
		{ version: 2, habits: [] },
		{ version: 1, habits: null },
		{ version: 1, habits: [habit(), habit({ id: ' workout ' })] },
		{ version: 1, habits: Array(1) },
	])
		assert.throws(() => validateHabitData(value));
	for (const changes of [
		{ id: '' },
		{ id: 12 },
		{ name: ' ' },
		{ name: 'a'.repeat(81) },
		{ kind: 'neutral' },
		{ days: [] },
		{ days: null },
		{ days: [1, 1] },
		{ days: [7] },
		{ days: [-1] },
		{ days: [1.5] },
		{ days: ['1'] },
		{ days: Array(1) },
		{ startDate: '2024-02-30' },
		{ completions: null },
		{ completions: [] },
		{ completions: { __invalid__: now.toISOString() } },
		{ completions: { '2024-02-30': now.toISOString() } },
	])
		assert.throws(() => validateHabitData(data(changes)), JSON.stringify(changes));
	for (const timestamp of [
		null,
		false,
		12,
		'',
		'not a date',
		'2024-03-12',
		'2024-02-30T12:34:56.789Z',
		'2024-03-12T25:34:56.789Z',
		'2024-03-12T12:34:56Z',
		'2024-03-12T12:34:56.789+00:00',
	]) {
		assert.throws(
			() => validateHabitData(data({ completions: { '2024-03-12': timestamp } })),
			/timestamp/,
		);
	}
});

test('settings edits preserve all history and order, cannot reinterpret kind, and do not mutate input', () => {
	const original = toggleHabitDate(data(), 'workout', '2024-03-12', now);
	const before = JSON.stringify(original);
	const edited = upsertHabit(original, {
		...habit(),
		name: 'Gym',
		days: [3],
		startDate: '2025-01-01',
		completions: {},
	});
	assert.equal(edited.habits.length, 1);
	assert.equal(edited.habits[0].name, 'Gym');
	assert.deepEqual(edited.habits[0].completions, { '2024-03-12': now.toISOString() });
	assert.deepEqual(habitDaysForWeek(edited.habits[0], '2024-03-12'), []);
	assert.throws(() => upsertHabit(original, habit({ kind: 'bad' })), /kind cannot be changed/);
	assert.equal(JSON.stringify(original), before);
	const added = upsertHabit(edited, habit({ id: 'reading', name: 'Reading' }));
	assert.deepEqual(
		added.habits.map(({ id }) => id),
		['workout', 'reading'],
	);
	assert.deepEqual(
		deleteHabit(added, 'workout').habits.map(({ id }) => id),
		['reading'],
	);
	assert.equal(added.habits.length, 2);
	assert.throws(() => deleteHabit(added, 'missing'), /not found/);
	assert.throws(() => upsertHabit(added, habit({ days: null })), /weekdays/);
	assert.throws(() => upsertHabit(null, habit()));
});

test('generated IDs remain unique under repeated clock and randomness', () => {
	const originalNow = Date.now;
	const originalRandom = Math.random;
	Date.now = () => 123;
	Math.random = () => 0.5;
	try {
		let value = createEmptyHabitData();
		for (let i = 0; i < 3; i++) value = upsertHabit(value, { name: 'Workout', kind: 'good' });
		assert.equal(new Set(value.habits.map(({ id }) => id)).size, 3);
	} finally {
		Date.now = originalNow;
		Math.random = originalRandom;
	}
});

test('checking good means done and checking bad means avoided; undo removes date and recheck records new instant', () => {
	for (const kind of ['good', 'bad']) {
		const original = data({ kind });
		const checked = toggleHabitDate(original, 'workout', '2024-03-12', now);
		assert.deepEqual(checked.habits[0].completions, { '2024-03-12': now.toISOString() });
		assert.deepEqual(original.habits[0].completions, {});
		const unchecked = toggleHabitDate(checked, 'workout', '2024-03-12', now);
		assert.deepEqual(unchecked.habits[0].completions, {});
		const later = new Date('2024-03-12T12:35:01.123Z');
		assert.equal(
			toggleHabitDate(unchecked, 'workout', '2024-03-12', later).habits[0].completions[
				'2024-03-12'
			],
			later.toISOString(),
		);
		const backfill = toggleHabitDate(checked, 'workout', '2024-03-11', now);
		assert.deepEqual(backfill.habits[0].completions, {
			'2024-03-11': now.toISOString(),
			'2024-03-12': now.toISOString(),
		});
	}
});

test('toggles reject missing habits, future dates, pre-start, off-schedule and invalid dates/times', () => {
	assert.throws(() => toggleHabitDate(data(), 'missing', '2024-03-12', now), /not found/);
	assert.throws(() => toggleHabitDate(data(), 'workout', '2024-03-14', now), /Future/);
	assert.throws(
		() => toggleHabitDate(data({ startDate: '2024-03-12' }), 'workout', '2024-03-11', now),
		/before/,
	);
	assert.throws(() => toggleHabitDate(data(), 'workout', '2024-03-06', now), /not scheduled/);
	assert.throws(() => toggleHabitDate(data(), 'workout', '2024-02-30', now), /YYYY-MM-DD/);
	for (const invalid of [null, '2024-03-12', new Date(NaN), new Date('10000-01-01')])
		assert.throws(
			() => toggleHabitDate(data(), 'workout', '2024-03-12', invalid),
			/valid Date/,
		);
	const checked = toggleHabitDate(data(), 'workout', '2024-03-12', now);
	const edited = upsertHabit(checked, habit({ days: [1] }));
	assert.throws(() => toggleHabitDate(edited, 'workout', '2024-03-12', now), /not scheduled/);
});

test('DST, local midnight, leap day and year crossing work in multiple device timezones', () => {
	const modulePath = JSON.stringify(require.resolve('../src/utils/habits'));
	const script = `
		const RealDate = Date;
		global.Date = class extends RealDate {
			constructor(...args) { super(...(args.length ? args : ['2026-01-01T00:30:00Z'])); }
		};
		const h = require(${modulePath});
		const habit = ${JSON.stringify(habit({ days: [0, 1, 2, 3, 4, 5, 6] }))};
		const data = {version: 1, habits: [habit]};
		const local = h.todayDate();
		let futureRejected = false;
		try { h.toggleHabitDate(data, habit.id, h.shiftDate(local, 1)); }
		catch (e) { futureRejected = /Future/.test(e.message); }
		console.log(JSON.stringify({
			today: local,
			checked: h.toggleHabitDate(data, habit.id, local).habits[0].completions,
			futureRejected,
			weeks: ['2024-03-10', '2024-11-03', '2024-02-29', '2025-01-01']
				.map(date => h.habitDaysForWeek(habit, date)),
			shifts: ['2024-03-10', '2024-11-03'].map(date => h.shiftDate(date, 1)),
		}));
	`;
	const results = ['UTC', 'America/New_York', 'Asia/Jakarta', 'Pacific/Kiritimati'].map((TZ) =>
		JSON.parse(
			execFileSync(process.execPath, ['-e', script], {
				env: { ...process.env, TZ },
				encoding: 'utf8',
			}),
		),
	);
	assert.deepEqual(
		results.map(({ today }) => today),
		['2026-01-01', '2025-12-31', '2026-01-01', '2026-01-01'],
	);
	for (const result of results) {
		assert.deepEqual(result.weeks, results[0].weeks);
		assert.equal(result.weeks[0].length, 7);
		assert.equal(result.weeks[1].length, 7);
		assert.ok(result.weeks[2].includes('2024-02-29'));
		assert.equal(result.weeks[3][0], '2024-12-30');
		assert.deepEqual(result.shifts, ['2024-03-11', '2024-11-04']);
		assert.equal(result.futureRejected, true);
		assert.deepEqual(result.checked, { [result.today]: '2026-01-01T00:30:00.000Z' });
	}
});

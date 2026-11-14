const { todayDate, isValidDate } = require('./trackers');

const WEEKDAYS = Object.freeze(
	[
		{ day: 1, label: 'Mon' },
		{ day: 2, label: 'Tue' },
		{ day: 3, label: 'Wed' },
		{ day: 4, label: 'Thu' },
		{ day: 5, label: 'Fri' },
		{ day: 6, label: 'Sat' },
		{ day: 0, label: 'Sun' },
	].map(Object.freeze),
);
const DEFAULT_HABIT_DAYS = Object.freeze([1, 2, 4, 5]);
const DAY_MS = 86400000;

function isRecord(value) {
	return (
		value !== null &&
		typeof value === 'object' &&
		!Array.isArray(value) &&
		Object.prototype.toString.call(value) === '[object Object]'
	);
}

function calendarDate(value) {
	if (!isValidDate(value))
		throw new Error('Date must be a valid date in YYYY-MM-DD format (1900-9999).');
	const [year, month, day] = value.split('-').map(Number);
	// UTC represents calendar arithmetic only, not the local completion instant.
	return new Date(Date.UTC(year, month - 1, day));
}

function shiftDate(date, days) {
	const value = calendarDate(date);
	if (!Number.isSafeInteger(days)) throw new Error('Day shift must be a whole number.');
	value.setTime(value.getTime() + days * DAY_MS);
	if (
		!Number.isFinite(value.getTime()) ||
		value.getUTCFullYear() < 1900 ||
		value.getUTCFullYear() > 9999
	)
		throw new Error('Shifted date must be between 1900 and 9999.');
	return value.toISOString().slice(0, 10);
}

function weekStart(date) {
	return shiftDate(date, -((calendarDate(date).getUTCDay() + 6) % 7));
}

function validateHabit(value) {
	if (!isRecord(value)) throw new Error('Habit must be an object.');
	if (typeof value.id !== 'string' || !value.id.trim()) throw new Error('Habit ID is required.');
	if (typeof value.name !== 'string' || !value.name.trim() || value.name.trim().length > 80)
		throw new Error('Name must contain between 1 and 80 characters.');
	if (!['good', 'bad'].includes(value.kind)) throw new Error('Kind must be good or bad.');
	if (!Array.isArray(value.days) || value.days.length < 1 || value.days.length > 7)
		throw new Error('Choose between 1 and 7 weekdays.');
	const days = new Set();
	for (const day of value.days) {
		if (!Number.isInteger(day) || day < 0 || day > 6 || days.has(day))
			throw new Error('Weekdays must be unique whole numbers from 0 to 6.');
		days.add(day);
	}
	calendarDate(value.startDate);
	if (!isRecord(value.completions)) throw new Error('Completions must be an object.');
	const completions = {};
	for (const [date, timestamp] of Object.entries(value.completions)) {
		calendarDate(date);
		if (
			typeof timestamp !== 'string' ||
			!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(timestamp) ||
			!Number.isFinite(Date.parse(timestamp)) ||
			new Date(timestamp).toISOString() !== timestamp
		)
			throw new Error('Completion timestamp must be a valid UTC ISO timestamp.');
		// History may precede an edited start date or fall off an edited weekday schedule.
		completions[date] = timestamp;
	}
	return {
		id: value.id.trim(),
		name: value.name.trim(),
		kind: value.kind,
		days: WEEKDAYS.filter(({ day }) => days.has(day)).map(({ day }) => day),
		startDate: value.startDate,
		completions,
	};
}

function createEmptyHabitData() {
	return { version: 1, habits: [] };
}

function validateHabitData(value) {
	if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.habits))
		throw new Error('Habit data must contain version 1 and a habits list.');
	const ids = new Set();
	const habits = [];
	for (const item of value.habits) {
		const habit = validateHabit(item);
		if (ids.has(habit.id)) throw new Error('Habit IDs must be unique.');
		ids.add(habit.id);
		habits.push(habit);
	}
	return { version: 1, habits };
}

function habitDaysForWeek(value, anchorDate) {
	const habit = validateHabit(value);
	const monday = weekStart(anchorDate);
	return WEEKDAYS.filter(({ day }) => habit.days.includes(day))
		.map(({ day }) => {
			const offset = (day + 6) % 7;
			// The final supported week may extend beyond year 9999.
			if (calendarDate(monday).getTime() + offset * DAY_MS > Date.UTC(9999, 11, 31))
				return null;
			return shiftDate(monday, offset);
		})
		.filter((date) => date !== null && date >= habit.startDate);
}

function upsertHabit(data, value) {
	const next = validateHabitData(data);
	if (!isRecord(value)) throw new Error('Habit must be an object.');
	let id = value.id;
	if (id === undefined) {
		const base = `habit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
		id = base;
		let suffix = 1;
		while (next.habits.some((habit) => habit.id === id)) id = `${base}-${suffix++}`;
	}
	if (typeof id !== 'string' || !id.trim()) throw new Error('Habit ID is required.');
	const index = next.habits.findIndex((habit) => habit.id === id.trim());
	const previous = next.habits[index];
	if (previous && value.kind !== previous.kind)
		throw new Error('Habit kind cannot be changed. Create a new habit instead.');
	const habit = validateHabit({
		...value,
		id,
		days:
			value.days === undefined && !previous
				? value.kind === 'bad'
					? WEEKDAYS.map(({ day }) => day)
					: DEFAULT_HABIT_DAYS
				: value.days,
		startDate: value.startDate === undefined && !previous ? todayDate() : value.startDate,
		// Settings never replace history; only toggleHabitDate records completions.
		completions: previous?.completions ?? {},
	});
	if (previous) next.habits[index] = habit;
	else next.habits.push(habit);
	return next;
}

function deleteHabit(data, id) {
	const next = validateHabitData(data);
	if (!next.habits.some((habit) => habit.id === id)) throw new Error('Habit not found.');
	next.habits = next.habits.filter((habit) => habit.id !== id);
	return next;
}

function toggleHabitDate(data, id, date, now = new Date()) {
	const next = validateHabitData(data);
	const habit = next.habits.find((item) => item.id === id);
	if (!habit) throw new Error('Habit not found.');
	const day = calendarDate(date).getUTCDay();
	if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
		throw new Error('Current time must be a valid Date (1900-9999).');
	const localToday = `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
	if (!isValidDate(localToday) || !isValidDate(now.toISOString().slice(0, 10)))
		throw new Error('Current time must be a valid Date (1900-9999).');
	if (date > localToday) throw new Error('Future dates cannot be checked.');
	if (date < habit.startDate) throw new Error('Date is before the habit start date.');
	if (!habit.days.includes(day)) throw new Error('Habit is not scheduled on this date.');
	// For bad habits, checked means avoided, not indulged.
	if (Object.prototype.hasOwnProperty.call(habit.completions, date))
		delete habit.completions[date];
	else habit.completions[date] = now.toISOString();
	return next;
}

module.exports = {
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
};

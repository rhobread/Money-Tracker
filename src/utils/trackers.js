const FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'];
const DAY_MS = 86400000;
const MONTHS = [
	'Januari',
	'Februari',
	'Maret',
	'April',
	'Mei',
	'Juni',
	'Juli',
	'Agustus',
	'September',
	'Oktober',
	'November',
	'Desember',
];

function dateString(year, month, day) {
	return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function todayDate() {
	const now = new Date();
	return dateString(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

function isValidDate(value) {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const [year, month, day] = value.split('-').map(Number);
	if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1) return false;
	return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function requireDate(value, label) {
	if (!isValidDate(value))
		throw new Error(`${label} must be a valid date in YYYY-MM-DD format (1900-9999).`);
	return value;
}

function formatDate(value) {
	requireDate(value, 'Date');
	const [year, month, day] = value.split('-').map(Number);
	return `${day} ${MONTHS[month - 1]} ${year}`;
}

function isRecord(value) {
	return (
		value !== null &&
		typeof value === 'object' &&
		!Array.isArray(value) &&
		Object.prototype.toString.call(value) === '[object Object]'
	);
}

function requireAmount(value) {
	if (!Number.isSafeInteger(value) || value < 0 || value >= 1e12) {
		throw new Error('Amount must be 0 or more and less than Rp10.000.000.000.');
	}
	return value;
}

function validateEntry(value) {
	if (!isRecord(value)) throw new Error('Saved entry must be an object.');
	const dueDate = requireDate(value.dueDate, 'Due date');
	if (typeof value.paid !== 'boolean') throw new Error('Paid must be true or false.');
	if (value.paid) requireDate(value.paidDate, 'Paid date');
	else if (value.paidDate !== null) throw new Error('An unpaid entry must have no paid date.');
	return {
		dueDate,
		paid: value.paid,
		paidDate: value.paidDate,
		amountMinor: requireAmount(value.amountMinor),
	};
}

function validateTracker(value) {
	if (!isRecord(value)) throw new Error('Tracker must be an object.');
	if (typeof value.id !== 'string' || !value.id.trim())
		throw new Error('Tracker ID is required.');
	if (typeof value.name !== 'string' || !value.name.trim() || value.name.trim().length > 80) {
		throw new Error('Name must contain between 1 and 80 characters.');
	}
	if (!['income', 'payment'].includes(value.kind))
		throw new Error('Kind must be income or payment.');
	if (!FREQUENCIES.includes(value.frequency))
		throw new Error('Choose a supported repeat frequency.');
	const startDate = requireDate(value.startDate, 'First due date');
	if (!isRecord(value.entries)) throw new Error('Saved entries must be an object.');
	const entries = {};
	for (const [key, entry] of Object.entries(value.entries)) {
		requireDate(key, 'Scheduled date');
		entries[key] = validateEntry(entry);
	}
	return {
		id: value.id.trim(),
		name: value.name.trim(),
		kind: value.kind,
		amountMinor: requireAmount(value.amountMinor),
		frequency: value.frequency,
		startDate,
		entries,
	};
}

function validateTrackersData(value) {
	if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.items)) {
		throw new Error('Tracker data must contain version 1 and an items list.');
	}
	const ids = new Set();
	const items = value.items.map((item) => {
		const tracker = validateTracker(item);
		if (ids.has(tracker.id)) throw new Error('Tracker IDs must be unique.');
		ids.add(tracker.id);
		return tracker;
	});
	return { version: 1, items };
}

function occurrencesForYear(value, year) {
	const tracker = validateTracker(value);
	if (!Number.isInteger(year) || year < 1900 || year > 9999) {
		throw new Error('Year must be a whole number between 1900 and 9999.');
	}
	const [startYear, startMonth, startDay] = tracker.startDate.split('-').map(Number);
	const keys = new Set();
	if (year >= startYear) {
		if (tracker.frequency === 'daily' || tracker.frequency === 'weekly') {
			// UTC is used only as calendar arithmetic, never as a local due-date instant.
			const start = Date.UTC(startYear, startMonth - 1, startDay);
			const first = Date.UTC(year, 0, 1);
			const end = Date.UTC(year + 1, 0, 1);
			const step = (tracker.frequency === 'daily' ? 1 : 7) * DAY_MS;
			for (
				let time = start + Math.max(0, Math.ceil((first - start) / step)) * step;
				time < end;
				time += step
			) {
				const date = new Date(time);
				keys.add(dateString(year, date.getUTCMonth() + 1, date.getUTCDate()));
			}
		} else {
			const months =
				tracker.frequency === 'monthly'
					? Array.from({ length: 12 }, (_, index) => index + 1)
					: [startMonth];
			for (const month of months) {
				const day = Math.min(startDay, new Date(Date.UTC(year, month, 0)).getUTCDate());
				const key = dateString(year, month, day);
				if (key >= tracker.startDate) keys.add(key);
			}
		}
	}
	// Overrides are history, including nominal dates no longer in the edited series.
	for (const key of Object.keys(tracker.entries)) {
		if (Number(key.slice(0, 4)) === year) keys.add(key);
	}
	return Array.from(keys, (key) => ({
		key,
		scheduledDate: key,
		...(tracker.entries[key] ?? {
			dueDate: key,
			paid: false,
			paidDate: null,
			amountMinor: tracker.amountMinor,
		}),
	})).sort((a, b) =>
		a.dueDate < b.dueDate
			? -1
			: a.dueDate > b.dueDate
				? 1
				: a.key < b.key
					? -1
					: a.key > b.key
						? 1
						: 0,
	);
}

function setOccurrence(tracker, key, entry) {
	requireDate(key, 'Scheduled date');
	const normalized = validateTracker(tracker);
	return validateTracker({ ...normalized, entries: { ...normalized.entries, [key]: entry } });
}

function createTrackerId(existing) {
	const ids = new Set(existing.map((item) => item.id));
	const base = `tracker-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
	let id = base;
	let suffix = 1;
	while (ids.has(id)) id = `${base}-${suffix++}`;
	return id;
}

module.exports = {
	FREQUENCIES,
	todayDate,
	isValidDate,
	formatDate,
	validateTracker,
	validateTrackersData,
	occurrencesForYear,
	setOccurrence,
	createTrackerId,
};

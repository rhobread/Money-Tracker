const { validateWallet } = require('./money');
const {
	validateTracker,
	validateTrackersData,
	setOccurrence,
	effectiveSourceId,
} = require('./trackers');

function validateFinanceData(value) {
	if (!value || value.version !== 1) {
		throw new Error('Money data must contain version 1, a wallet and trackers.');
	}
	const wallet = validateWallet(value.wallet);
	const trackers = validateTrackersData(value.trackers);
	const ids = new Set(wallet.sources.map((source) => source.id));
	function requireSource(id) {
		if (id !== null && !ids.has(id)) {
			throw new Error(
				'A recurring item still references a missing money source. Clear or change its default and entry sources before deleting that source.',
			);
		}
	}
	for (const tracker of trackers.items) {
		requireSource(tracker.defaultSourceId);
		for (const entry of Object.values(tracker.entries)) {
			requireSource(entry.sourceId);
			if (entry.applied !== null) requireSource(entry.applied.sourceId);
		}
	}
	return { version: 1, wallet, trackers };
}

function updateMoneySources(data, sources) {
	const current = validateFinanceData(data);
	return validateFinanceData({
		...current,
		wallet: { ...current.wallet, sources, updatedAt: new Date().toISOString() },
	});
}

function saveRecurringItem(data, tracker) {
	const current = validateFinanceData(data);
	const settings = validateTracker({ ...tracker, entries: {} });
	const existing = current.trackers.items.find((item) => item.id === settings.id);
	if (existing && existing.kind !== settings.kind) {
		throw new Error('An existing recurring item cannot change between income and payment.');
	}
	const next = { ...settings, entries: existing?.entries ?? {} };
	const items = existing
		? current.trackers.items.map((item) => (item.id === next.id ? next : item))
		: [...current.trackers.items, next];
	return validateFinanceData({ ...current, trackers: { version: 2, items } });
}

function applyDeltas(current, trackers, previous, next) {
	const deltas = new Map();
	for (const [snapshots, sign] of [
		[previous, -1n],
		[next, 1n],
	]) {
		for (const snapshot of snapshots) {
			if (snapshot === null) continue;
			deltas.set(
				snapshot.sourceId,
				(deltas.get(snapshot.sourceId) ?? 0n) + sign * BigInt(snapshot.amountMinor),
			);
		}
	}
	let changed = false;
	const sources = current.wallet.sources.map((source) => {
		const delta = deltas.get(source.id) ?? 0n;
		if (delta === 0n) return source;
		const amount = BigInt(source.amountMinor) + delta;
		if (amount <= -1000000000000n || amount >= 1000000000000n) {
			throw new Error('The resulting money source amount must be smaller than 10 billion.');
		}
		changed = true;
		return { ...source, amountMinor: Number(amount) };
	});
	return validateFinanceData({
		...current,
		trackers,
		wallet: {
			...current.wallet,
			sources,
			updatedAt: changed ? new Date().toISOString() : current.wallet.updatedAt,
		},
	});
}

function saveRecurringEntry(data, trackerId, key, entry) {
	const current = validateFinanceData(data);
	const tracker = current.trackers.items.find((item) => item.id === trackerId);
	if (!tracker) throw new Error('Recurring item could not be found.');
	const previous = tracker.entries[key];
	// Snapshots are transaction-owned, never trusted from an editor or stale UI closure.
	let nextTracker = setOccurrence(tracker, key, { ...entry, applied: null });
	let next = nextTracker.entries[key];
	if (next.paid && (!previous?.paid || previous.applied !== null)) {
		const sourceId = effectiveSourceId(tracker, next);
		if (sourceId === null || !current.wallet.sources.some((source) => source.id === sourceId)) {
			throw new Error('Choose an existing money source before marking this entry paid.');
		}
		next = {
			...next,
			sourceId,
			applied: {
				sourceId,
				amountMinor:
					tracker.kind === 'income' || next.amountMinor === 0
						? next.amountMinor
						: -next.amountMinor,
			},
		};
		nextTracker = setOccurrence(tracker, key, next);
	}
	return applyDeltas(
		current,
		{
			version: 2,
			items: current.trackers.items.map((item) =>
				item.id === trackerId ? nextTracker : item,
			),
		},
		[previous?.applied ?? null],
		[next.applied],
	);
}

function deleteRecurringItem(data, id) {
	const current = validateFinanceData(data);
	const tracker = current.trackers.items.find((item) => item.id === id);
	if (!tracker) throw new Error('Recurring item could not be found.');
	return applyDeltas(
		current,
		{
			version: 2,
			items: current.trackers.items.filter((item) => item.id !== id),
		},
		Object.values(tracker.entries).map((entry) => entry.applied),
		[],
	);
}

module.exports = {
	validateFinanceData,
	updateMoneySources,
	saveRecurringItem,
	saveRecurringEntry,
	deleteRecurringItem,
};

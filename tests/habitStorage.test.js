const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { transformFileSync } = require('@babel/core');
const habits = require('../src/utils/habits');

const KEY = '@personal-tracker/habits';
const NOW = new Date('2024-03-12T12:34:56.789Z');
const item = {
	id: 'workout',
	name: 'Workout',
	kind: 'good',
	days: [1, 2, 4, 5],
	startDate: '2024-01-01',
	completions: {},
};
const initial = () => habits.upsertHabit(habits.createEmptyHabitData(), item);
const plain = (value) => JSON.parse(JSON.stringify(value));

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
	const api = loadModule('../src/storage/habitStorage.js', {
		'@react-native-async-storage/async-storage': native,
		'../utils/habits': habits,
	});
	return { values, reads, writes, native, api };
}

function loadAdapter() {
	return loadModule('../src/hooks/useHabits.js', {
		'../utils/habits': habits,
	}).useHabits;
}

function sessionStub(overrides = {}) {
	return {
		data: { habits: initial() },
		loading: false,
		saving: false,
		conflict: null,
		loadError: null,
		account: { id: 'account-a' },
		dirty: false,
		lastSyncedAt: NOW.toISOString(),
		syncError: null,
		reload: async () => true,
		saveHabit: async () => true,
		removeHabit: async () => true,
		toggleDate: async () => true,
		...overrides,
	};
}

const mutations = (hook) => [
	() => hook.saveHabit(item),
	() => hook.removeHabit(item.id),
	() => hook.toggleDate(item.id, '2024-03-12', NOW),
];
function assertFailure(result, pattern) {
	assert.equal(result.success, false);
	assert.equal(typeof result.error, 'string');
	assert.ok(result.error.length > 0);
	if (pattern) assert.match(result.error, pattern);
}
const assertSuccess = (result) => assert.deepEqual(plain(result), { success: true });

test('empty storage reads only device habit key, returns fresh data, and never writes defaults', async () => {
	const storage = storageHarness({ '@money-tracker/data': 'do not read money' });
	const first = await storage.api.loadHabitData();
	assert.deepEqual(first, { version: 1, habits: [] });
	first.habits.push(item);
	assert.deepEqual(await storage.api.loadHabitData(), { version: 1, habits: [] });
	assert.deepEqual(storage.reads, [KEY, KEY]);
	assert.equal(storage.writes.length, 0);
	assert.equal(storage.values.get('@money-tracker/data'), 'do not read money');
});

test('storage is injectable per call, validates before one write, and round-trips normalized data', async () => {
	const primary = storageHarness();
	const injected = storageHarness();
	const data = initial();
	data.habits[0].name = ' Workout ';
	await primary.api.saveHabitData(data, injected.native);
	assert.deepEqual(await primary.api.loadHabitData(injected.native), initial());
	assert.equal(primary.reads.length, 0);
	assert.equal(primary.writes.length, 0);
	assert.equal(injected.writes.length, 1);
	assert.equal(injected.writes[0][0], KEY);
	assert.equal(JSON.parse(injected.writes[0][1]).version, 1);
	await assert.rejects(primary.api.saveHabitData({ version: 2, habits: [] }, injected.native));
	assert.equal(injected.writes.length, 1);
});

test('completions, actual timestamps, schedule edits and undo survive every restart', async () => {
	const storage = storageHarness();
	async function restart(data) {
		await storage.api.saveHabitData(data);
		return storage.api.loadHabitData();
	}
	for (const kind of ['good', 'bad']) {
		let data = await restart(
			habits.upsertHabit(habits.createEmptyHabitData(), { ...item, kind }),
		);
		data = await restart(habits.toggleHabitDate(data, item.id, '2024-03-12', NOW));
		assert.equal(data.habits[0].completions['2024-03-12'], NOW.toISOString());
		data = await restart(
			habits.upsertHabit(data, { ...item, kind, days: [1], completions: {} }),
		);
		assert.equal(data.habits[0].completions['2024-03-12'], NOW.toISOString());
		data = await restart(habits.upsertHabit(data, { ...item, kind }));
		data = await restart(habits.toggleHabitDate(data, item.id, '2024-03-12', NOW));
		assert.deepEqual(data.habits[0].completions, {});
		assert.deepEqual(
			await restart(habits.deleteHabit(data, item.id)),
			habits.createEmptyHabitData(),
		);
	}
	assert.equal(storage.writes.length, 12);
	assert.ok(storage.writes.every(([key]) => key === KEY));
});

test('corrupt storage and read failures reject without overwriting or falling back to money keys', async () => {
	for (const raw of [
		'{broken',
		'null',
		'[]',
		'{}',
		'{"version":99,"habits":[]}',
		JSON.stringify({ ...initial(), habits: [{ ...item, days: [9] }] }),
		JSON.stringify({
			...initial(),
			habits: [{ ...item, completions: { '2024-03-12': false } }],
		}),
	]) {
		const storage = storageHarness({ [KEY]: raw, '@money-tracker/data': '{}' });
		await assert.rejects(storage.api.loadHabitData());
		assert.deepEqual(storage.reads, [KEY]);
		assert.equal(storage.writes.length, 0);
		assert.equal(storage.values.get(KEY), raw);
	}
	const storage = storageHarness();
	storage.native.getItem = async () => {
		throw new Error('Read failed');
	};
	await assert.rejects(storage.api.loadHabitData(), /Read failed/);
	assert.equal(storage.writes.length, 0);
});

test('write failure propagates without removing or replacing the previous stored data', async () => {
	const raw = JSON.stringify(initial());
	const storage = storageHarness({ [KEY]: raw });
	let attempts = 0;
	storage.native.setItem = async (key) => {
		attempts++;
		assert.equal(key, KEY);
		throw new Error('Disk full');
	};
	await assert.rejects(storage.api.saveHabitData(habits.createEmptyHabitData()), /Disk full/);
	assert.equal(attempts, 1);
	assert.equal(storage.values.get(KEY), raw);
});

test('adapter projects shared habit data and account sync state, keeping reload unchanged', async () => {
	const useHabits = loadAdapter();
	let reloads = 0;
	const session = sessionStub({
		dirty: true,
		syncError: 'Cloud sync is unavailable.',
		reload: async () => {
			reloads++;
			return false;
		},
	});
	const current = useHabits(session);
	assert.deepEqual(
		Object.keys(current).sort(),
		[
			'data',
			'loading',
			'saving',
			'error',
			'account',
			'dirty',
			'lastSyncedAt',
			'syncError',
			'reload',
			'saveHabit',
			'removeHabit',
			'toggleDate',
		].sort(),
	);
	assert.equal(current.data, session.data.habits);
	assert.equal(current.loading, session.loading);
	assert.equal(current.saving, false);
	assert.equal(current.error, session.loadError);
	assert.equal(current.account, session.account);
	assert.equal(current.dirty, session.dirty);
	assert.equal(current.lastSyncedAt, session.lastSyncedAt);
	assert.equal(current.syncError, session.syncError);
	assert.equal(current.reload, session.reload);
	assert.equal(reloads, 0);
	assert.equal(await current.reload(), false);
	assert.equal(reloads, 1);
});

test('adapter delegates every mutation with original arguments and wraps successful booleans', async () => {
	const useHabits = loadAdapter();
	const calls = [];
	const session = sessionStub({
		saveHabit: (...args) => {
			calls.push(['saveHabit', args]);
			return true;
		},
		removeHabit: async (...args) => {
			calls.push(['removeHabit', args]);
			return true;
		},
		toggleDate: async (...args) => {
			calls.push(['toggleDate', args]);
			return true;
		},
	});
	const current = useHabits(session);
	const before = plain(session.data);
	for (const mutate of mutations(current)) assertSuccess(await mutate());
	assert.deepEqual(calls, [
		['saveHabit', [item]],
		['removeHabit', [item.id]],
		['toggleDate', [item.id, '2024-03-12', NOW]],
	]);
	assert.equal(calls[0][1][0], item);
	assert.equal(calls[2][1][2], NOW);
	assert.equal(current.data, session.data.habits);
	assert.deepEqual(session.data, before);
});

test('adapter turns false mutation results into nonempty errors without changing shared data', async () => {
	const useHabits = loadAdapter();
	for (const result of [false, Promise.resolve(false)]) {
		let calls = 0;
		const reject = () => {
			calls++;
			return result;
		};
		const session = sessionStub({ saveHabit: reject, removeHabit: reject, toggleDate: reject });
		const current = useHabits(session);
		const before = plain(session.data);
		for (const mutate of mutations(current)) assertFailure(await mutate());
		assert.equal(calls, 3);
		assert.equal(current.data, session.data.habits);
		assert.deepEqual(session.data, before);
		assert.equal(useHabits(session).saving, false);
		assert.equal(useHabits(session).error, null);
	}
});

test('adapter catches synchronous throws and rejected mutations without exposing storage details', async () => {
	const useHabits = loadAdapter();
	for (const cause of [new Error('Private disk error: secret-path'), 'secret-path', null]) {
		for (const asynchronous of [false, true]) {
			const reject = () => {
				if (asynchronous) return Promise.reject(cause);
				throw cause;
			};
			const session = sessionStub({
				saveHabit: reject,
				removeHabit: reject,
				toggleDate: reject,
			});
			const current = useHabits(session);
			const before = plain(session.data);
			for (const mutate of mutations(current)) {
				const result = await mutate();
				assertFailure(result);
				assert.doesNotMatch(result.error, /Private disk|secret-path/);
			}
			assert.deepEqual(session.data, before);
			assert.equal(useHabits(session).error, session.loadError);
		}
	}
});

test('adapter projects saving, conflicts and load errors as blocked while loading stays session-owned', () => {
	const useHabits = loadAdapter();
	for (const [overrides, saving] of [
		[{}, false],
		[{ saving: true }, true],
		[{ conflict: { heads: ['local', 'remote'] } }, true],
		[{ loadError: 'Could not load account data.' }, true],
		[{ saving: true, conflict: {}, loadError: 'Reload required.' }, true],
		[{ loading: true, data: null }, false],
	]) {
		const session = sessionStub(overrides);
		const current = useHabits(session);
		assert.equal(current.saving, saving);
		assert.equal(current.loading, session.loading);
		assert.equal(current.error, session.loadError);
		assert.equal(current.data, session.data?.habits ?? null);
		assert.equal(current.reload, session.reload);
	}
});

test('adapter reflects updated data and switched accounts on the next call without retained state', async () => {
	const useHabits = loadAdapter();
	const session = sessionStub();
	const first = useHabits(session);
	const updated = habits.toggleHabitDate(initial(), item.id, '2024-03-12', NOW);
	session.data = { habits: updated };
	session.dirty = true;
	session.lastSyncedAt = null;
	const next = useHabits(session);
	assert.equal(next.data, updated);
	assert.equal(next.dirty, true);
	assert.equal(next.lastSyncedAt, null);
	assert.deepEqual(first.data.habits[0].completions, {});
	let saves = 0;
	const other = sessionStub({
		account: { id: 'account-b' },
		data: { habits: habits.createEmptyHabitData() },
		saveHabit: async () => {
			saves++;
			return true;
		},
	});
	const switched = useHabits(other);
	assert.equal(switched.account, other.account);
	assert.equal(switched.data, other.data.habits);
	assert.equal(switched.dirty, false);
	assertSuccess(await switched.saveHabit(item));
	assert.equal(saves, 1);
	for (const data of [null, undefined, {}, { habits: null }]) {
		const cleared = useHabits(sessionStub({ account: null, data }));
		assert.equal(cleared.data, null);
		assert.equal(cleared.account, null);
	}
});

test('adapter performs no independent storage reads, writes, effects or automatic session calls', () => {
	// The loader provides no React, storage, native or cloud modules to start side effects.
	const useHabits = loadAdapter();
	const unexpected = () => assert.fail('Rendering the adapter must not call session operations');
	const session = sessionStub({
		reload: unexpected,
		saveHabit: unexpected,
		removeHabit: unexpected,
		toggleDate: unexpected,
	});
	for (let render = 0; render < 3; render++) {
		assert.equal(useHabits(session).data, session.data.habits);
	}
});

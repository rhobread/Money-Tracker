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
const flush = () => new Promise((resolve) => setImmediate(resolve));

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
			throw new Error(`Unexpected import (habits must stay device-only): ${name}`);
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

function hookHarness(storage) {
	const states = [];
	const refs = [];
	const effects = [];
	let stateIndex;
	let refIndex;
	let effectIndex;
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
			assert.deepEqual(plain(dependencies), []);
			effects[index] ??= { effect, cleanup: null };
		},
	};
	const { useHabits } = loadModule('../src/hooks/useHabits.js', {
		react,
		'../storage/habitStorage': storage,
		'../utils/habits': habits,
	});
	return {
		render(options) {
			stateIndex = refIndex = effectIndex = 0;
			return useHabits(options);
		},
		mount() {
			for (const effect of effects) effect.cleanup = effect.effect();
		},
		unmount() {
			for (const effect of effects) effect.cleanup?.();
		},
	};
}

async function mountedHook(storage) {
	const hook = hookHarness(storage);
	hook.render();
	hook.mount();
	await flush();
	return hook;
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

test('hook starts null, blocks all actions before load and synchronously blocks duplicate reloads', async () => {
	let finishLoad;
	let reads = 0;
	let writes = 0;
	const hook = hookHarness({
		loadHabitData() {
			reads++;
			return new Promise((resolve) => {
				finishLoad = resolve;
			});
		},
		async saveHabitData() {
			writes++;
		},
	});
	const current = hook.render();
	assert.deepEqual(
		Object.keys(current).sort(),
		[
			'data',
			'loading',
			'saving',
			'error',
			'reload',
			'saveHabit',
			'removeHabit',
			'toggleDate',
		].sort(),
	);
	assert.equal(current.data, null);
	assert.equal(current.loading, true);
	assert.equal(current.saving, false);
	assert.equal(current.error, null);
	for (const mutate of mutations(current)) assertFailure(await mutate());
	hook.mount();
	assertFailure(await current.reload(), /in progress/);
	for (const mutate of mutations(current)) assertFailure(await mutate(), /in progress/);
	assert.equal(reads, 1);
	assert.equal(writes, 0);
	finishLoad(initial());
	await flush();
	assert.equal(hook.render().loading, false);
	assert.deepEqual(hook.render().data, initial());
});

test('one shared synchronous lock guards all actions and reload with no premature state update', async () => {
	let finishSave;
	const writes = [];
	const hook = await mountedHook({
		loadHabitData: async () => initial(),
		saveHabitData(data) {
			writes.push(data);
			return new Promise((resolve) => {
				finishSave = resolve;
			});
		},
	});
	const stale = hook.render();
	const committed = stale.data;
	const pending = stale.toggleDate(item.id, '2024-03-12', NOW);
	for (const mutate of mutations(stale)) assertFailure(await mutate(), /in progress/);
	assertFailure(await stale.reload(), /in progress/);
	assert.equal(writes.length, 1);
	assert.equal(hook.render().saving, true);
	assert.equal(hook.render().data, committed);
	assert.deepEqual(committed.habits[0].completions, {});
	finishSave();
	assertSuccess(await pending);
	assert.equal(hook.render().saving, false);
	assert.equal(hook.render().data.habits[0].completions['2024-03-12'], NOW.toISOString());
});

test('stale callbacks read latest committed data across saves, toggles, history edits and removal', async () => {
	const storage = storageHarness();
	const hook = await mountedHook(storage.api);
	const stale = hook.render();
	assertSuccess(await stale.saveHabit(item));
	assertSuccess(await stale.toggleDate(item.id, '2024-03-12', NOW));
	assertSuccess(await stale.saveHabit({ ...item, days: [1], name: 'Gym' }));
	assert.equal(hook.render().data.habits[0].name, 'Gym');
	assert.equal(hook.render().data.habits[0].completions['2024-03-12'], NOW.toISOString());
	assertSuccess(await stale.saveHabit({ ...item, id: 'reading', name: 'Read' }));
	assertSuccess(await stale.removeHabit(item.id));
	assert.deepEqual(
		hook.render().data.habits.map(({ id }) => id),
		['reading'],
	);
	assert.equal(storage.writes.length, 5);
	assertSuccess(await stale.reload());
	assert.equal(storage.writes.length, 5);
	const restarted = await mountedHook(storage.api);
	assert.deepEqual(restarted.render().data, hook.render().data);
});

test('validation and save failures retain previous data, return errors, unlock and permit retry', async () => {
	const storage = storageHarness({ [KEY]: JSON.stringify(initial()) });
	const hook = await mountedHook(storage.api);
	const stale = hook.render();
	const committed = stale.data;
	const setItem = storage.native.setItem;
	storage.native.setItem = async () => {
		throw new Error('Private disk error');
	};
	assertFailure(await stale.toggleDate(item.id, '2024-03-12', NOW), /Could not save/);
	assert.equal(hook.render().data, committed);
	assert.equal(hook.render().saving, false);
	assert.doesNotMatch(hook.render().error, /Private disk/);
	assert.deepEqual(JSON.parse(storage.values.get(KEY)), initial());
	assertFailure(await stale.saveHabit({ ...item, days: [] }), /weekdays/);
	assertFailure(await stale.toggleDate('missing', '2024-03-12', NOW), /not found/);
	assertFailure(await stale.removeHabit('missing'), /not found/);
	assert.equal(hook.render().data, committed);
	assert.equal(hook.render().saving, false);
	assert.equal(storage.writes.length, 0);
	storage.native.setItem = setItem;
	assertSuccess(await stale.toggleDate(item.id, '2024-03-12', NOW));
	assert.equal(hook.render().error, null);
	assert.equal(storage.writes.length, 1);
	const restarted = await mountedHook(storage.api);
	assert.equal(restarted.render().data.habits[0].completions['2024-03-12'], NOW.toISOString());
	assertSuccess(await restarted.render().toggleDate(item.id, '2024-03-12', NOW));
	assert.deepEqual((await storage.api.loadHabitData()).habits[0].completions, {});
});

test('load errors block every write until successful reload, even after prior successful load', async () => {
	const storage = storageHarness({ [KEY]: '{corrupt' });
	const hook = await mountedHook(storage.api);
	const stale = hook.render();
	assert.equal(stale.data, null);
	assert.equal(stale.loading, false);
	assert.match(stale.error, /Stored data has not been changed/);
	for (const mutate of mutations(stale)) assertFailure(await mutate(), /Load habits/);
	assert.equal(storage.values.get(KEY), '{corrupt');
	assert.equal(storage.writes.length, 0);
	storage.values.set(KEY, JSON.stringify(initial()));
	assertSuccess(await stale.reload());
	const committed = hook.render().data;
	storage.values.set(KEY, '{corrupt again');
	assertFailure(await stale.reload(), /Could not load/);
	assert.equal(hook.render().data, committed);
	for (const mutate of mutations(stale)) assertFailure(await mutate(), /Load habits/);
	assert.match(hook.render().error, /Stored data has not been changed/);
	assert.equal(storage.writes.length, 0);
	storage.values.set(KEY, JSON.stringify(initial()));
	assertSuccess(await stale.reload());
	assert.equal(hook.render().error, null);
	assertSuccess(await stale.toggleDate(item.id, '2024-03-12', NOW));
	assert.equal(storage.writes.length, 1);
});

test('reload retains data until load completes and guards writes before the next render', async () => {
	let finishLoad;
	let load = async () => initial();
	const storage = { loadHabitData: () => load(), saveHabitData: async () => {} };
	const hook = await mountedHook(storage);
	const stale = hook.render();
	const committed = stale.data;
	load = () =>
		new Promise((resolve) => {
			finishLoad = resolve;
		});
	const pending = stale.reload();
	for (const mutate of mutations(stale)) assertFailure(await mutate(), /in progress/);
	assert.equal(hook.render().data, committed);
	assert.equal(hook.render().loading, true);
	finishLoad(habits.createEmptyHabitData());
	assertSuccess(await pending);
	assert.deepEqual(hook.render().data, habits.createEmptyHabitData());
});

test('injected hook storage is captured once; effect replay does not duplicate in-flight loads', async () => {
	let finishLoad;
	let loads = 0;
	const injected = {
		loadHabitData() {
			loads++;
			return new Promise((resolve) => {
				finishLoad = resolve;
			});
		},
		saveHabitData: async () => {},
	};
	const unexpected = () => {
		throw new Error('Must use injected storage');
	};
	const hook = hookHarness({ loadHabitData: unexpected, saveHabitData: unexpected });
	hook.render({ storage: injected });
	hook.mount();
	hook.unmount();
	hook.mount();
	assert.equal(loads, 1);
	finishLoad(initial());
	await flush();
	assert.deepEqual(hook.render().data, initial());
	assertSuccess(await hook.render().removeHabit(item.id));
	hook.unmount();
	assertFailure(await hook.render().saveHabit(item), /not mounted/);
});

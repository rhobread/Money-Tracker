const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { transformFileSync } = require('@babel/core');
const trackers = require('../src/utils/trackers');

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

const item = {
	id: 'rent',
	name: 'Rent',
	kind: 'income',
	amountMinor: 12300,
	frequency: 'monthly',
	startDate: '2024-01-31',
	entries: {
		'2024-01-31': {
			dueDate: '2024-02-01',
			paid: true,
			paidDate: '2024-02-03',
			amountMinor: 12000,
		},
	},
};
const plain = (value) => JSON.parse(JSON.stringify(value));

function storageHarness(initial = null) {
	let stored = initial;
	const reads = [];
	const writes = [];
	const native = {
		async getItem(key) {
			reads.push(key);
			return stored;
		},
		async setItem(key, value) {
			writes.push([key, value]);
			stored = value;
		},
	};
	const api = loadModule('../src/storage/trackerStorage.js', {
		'@react-native-async-storage/async-storage': native,
		'../utils/trackers': trackers,
	});
	return { api, native, reads, writes, stored: () => stored };
}

test('tracker storage starts empty without writes and uses only its independent key', async () => {
	const storage = storageHarness();
	const first = await storage.api.loadTrackers();
	first.items.push(item);
	assert.deepEqual(plain(await storage.api.loadTrackers()), { version: 1, items: [] });
	assert.deepEqual(storage.reads, ['@money-tracker/trackers', '@money-tracker/trackers']);
	assert.equal(storage.writes.length, 0);
	assert.equal(storage.stored(), null);
});

test('tracker storage roundtrips manual overrides and rejects invalid writes', async () => {
	const storage = storageHarness();
	await storage.api.saveTrackers({ version: 1, items: [item] });
	assert.equal(storage.writes[0][0], '@money-tracker/trackers');
	assert.deepEqual(plain(await storage.api.loadTrackers()), { version: 1, items: [item] });
	await assert.rejects(
		storage.api.saveTrackers({ version: 1, items: [{ ...item, amountMinor: -1 }] }),
		/Amount/,
	);
	assert.equal(storage.writes.length, 1);
});

test('corrupt and unsupported stored data is never overwritten on load', async () => {
	for (const bad of [
		'{broken',
		'null',
		'{"version":2,"items":[]}',
		JSON.stringify({ version: 1, items: [item, item] }),
		JSON.stringify({
			version: 1,
			items: [{ ...item, entries: { '2024-02-30': item.entries['2024-01-31'] } }],
		}),
	]) {
		const storage = storageHarness(bad);
		await assert.rejects(storage.api.loadTrackers());
		assert.equal(storage.stored(), bad);
		assert.equal(storage.writes.length, 0);
	}
});

test('storage surfaces read and write failures without fallback writes', async () => {
	const storage = storageHarness();
	storage.native.getItem = async () => {
		throw new Error('Read failed');
	};
	await assert.rejects(storage.api.loadTrackers(), /Read failed/);
	storage.native.setItem = async () => {
		throw new Error('Storage full');
	};
	await assert.rejects(storage.api.saveTrackers({ version: 1, items: [item] }), /Storage full/);
	assert.equal(storage.writes.length, 0);
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
	const { useTrackers } = loadModule('../src/hooks/useTrackers.js', {
		react,
		'../storage/trackerStorage': storage,
		'../utils/trackers': trackers,
	});
	return {
		render() {
			stateIndex = 0;
			refIndex = 0;
			return useTrackers();
		},
		mount() {
			effects[0]();
		},
	};
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('hook blocks writes until loaded, synchronously blocks duplicate saves and commits only on success', async () => {
	let finishLoad;
	let finishSave;
	const writes = [];
	const hook = hookHarness({
		loadTrackers: () =>
			new Promise((resolve) => {
				finishLoad = resolve;
			}),
		saveTrackers: (data) => {
			writes.push(data);
			return new Promise((resolve) => {
				finishSave = resolve;
			});
		},
	});
	let current = hook.render();
	assert.equal(current.loading, true);
	assert.deepEqual(plain(current.data), { version: 1, items: [] });
	assert.equal(await current.updateItems([item]), false);
	hook.mount();
	assert.equal(await current.updateItems([item]), false);
	assert.equal(await current.reload(), false);
	finishLoad({ version: 1, items: [] });
	await flush();
	current = hook.render();
	assert.equal(current.loading, false);
	const pending = current.updateItems([item]);
	assert.equal(await current.updateItems([]), false);
	assert.equal(await current.reload(), false);
	assert.equal(hook.render().saving, true);
	assert.equal(hook.render().data.items.length, 0);
	assert.equal(writes.length, 1);
	finishSave();
	assert.equal(await pending, true);
	current = hook.render();
	assert.equal(current.saving, false);
	assert.deepEqual(current.data, { version: 1, items: [item] });
});

test('hook preserves committed data on failed save and unlocks after save or validation errors', async () => {
	let fail = true;
	let writes = 0;
	const hook = hookHarness({
		loadTrackers: async () => ({ version: 1, items: [item] }),
		saveTrackers: async () => {
			writes++;
			if (fail) throw new Error('Storage full');
		},
	});
	hook.render();
	hook.mount();
	await flush();
	let current = hook.render();
	await assert.rejects(current.updateItems([]), /Storage full/);
	current = hook.render();
	assert.deepEqual(current.data.items, [item]);
	assert.equal(current.saving, false);
	await assert.rejects(current.updateItems([{ ...item, amountMinor: -1 }]), /Amount/);
	assert.equal(writes, 1);
	assert.equal(hook.render().saving, false);
	fail = false;
	assert.equal(await current.updateItems([]), true);
	assert.equal(hook.render().data.items.length, 0);
});

test('hook load failure blocks writes until successful explicit reload', async () => {
	let fail = true;
	let writes = 0;
	const hook = hookHarness({
		loadTrackers: async () => {
			if (fail) throw new Error('Corrupt data');
			return { version: 1, items: [item] };
		},
		saveTrackers: async () => {
			writes++;
		},
	});
	hook.render();
	hook.mount();
	await flush();
	let current = hook.render();
	assert.equal(current.loading, false);
	assert.match(current.loadError, /Stored data has not been changed/);
	assert.equal(await current.updateItems([]), false);
	assert.equal(writes, 0);
	fail = false;
	assert.equal(await current.reload(), true);
	current = hook.render();
	assert.equal(current.loadError, null);
	assert.equal(current.data.items[0].id, 'rent');
	assert.equal(await current.updateItems([]), true);
});

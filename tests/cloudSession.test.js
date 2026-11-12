const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMoneySession } = require('../src/services/cloudSession');
const finance = require('../src/utils/finance');
const model = require('../src/services/cloudModel');

const clone = (value) => JSON.parse(JSON.stringify(value));
const DATE = '2026-11-12T00:00:00.000Z';
const profiles = {
	A: { id: 'A', email: 'a@example.test', name: 'A' },
	B: { id: 'B', email: 'b@example.test', name: 'B' },
};
const offline = () => Object.assign(new Error('offline secret-token'), { code: 'network' });
function data(amount = 1000) {
	return finance.validateFinanceData({
		...model.emptyData(),
		wallet: {
			...model.emptyData().wallet,
			sources: [{ id: 'bank', name: 'Bank', amountMinor: amount }],
		},
	});
}
const tracker = {
	id: 'rent',
	name: 'Rent',
	kind: 'payment',
	amountMinor: 500,
	frequency: 'monthly',
	startDate: '2026-01-01',
	defaultSourceId: 'bank',
	entries: {},
};
const entry = {
	dueDate: '2026-01-01',
	paid: true,
	paidDate: '2026-01-01',
	amountMinor: 500,
	sourceId: null,
};
function snapshot(accountId, revision, parents = [], value = data()) {
	return { version: 1, accountId, revision, parents, updatedAt: DATE, data: clone(value) };
}
function record(
	accountId,
	value = data(),
	revision = null,
	dirty = false,
	baseRevision = revision,
) {
	return {
		version: 1,
		accountId,
		data: clone(value),
		localRevision: revision,
		baseRevision,
		dirty,
		lastSyncedAt: baseRevision ? DATE : null,
		pendingParents: null,
	};
}
function harness({ guest = data(44), active = null, records = [], snapshots = [] } = {}) {
	const accounts = new Map(records.map((value) => [value.accountId, clone(value)]));
	const files = new Map(
		snapshots.map((value) => [`${value.accountId}:${value.revision}`, clone(value)]),
	);
	const writes = [];
	let selected = 'A';
	let nativeSignouts = 0;
	const storage = {
		async loadActiveAccount() {
			return clone(active);
		},
		async saveActiveAccount(value) {
			active = clone(value);
		},
		async loadAccountData(id) {
			return accounts.has(id) ? clone(accounts.get(id)) : null;
		},
		async saveAccountData(id, value) {
			writes.push(clone(value));
			accounts.set(id, clone(value));
		},
		async loadMoneyData() {
			return clone(guest);
		},
		async saveMoneyData(value) {
			guest = clone(value);
		},
	};
	const auth = {
		async signIn() {
			return profiles[selected];
		},
		async accessToken(expected) {
			assert.equal(expected, selected);
			return 'secret-token';
		},
		async signOut() {
			nativeSignouts++;
		},
	};
	let posts = 0;
	const drive = {
		async listHeads(id) {
			const nodes = [...files.values()]
				.filter((value) => value.accountId === id)
				.map((value) => ({
					revision: value.revision,
					parents: value.parents,
					fileId: `file-${value.revision}`,
					createdAt: DATE,
				}));
			const parents = new Set(nodes.flatMap((node) => node.parents));
			return clone({ nodes, heads: nodes.filter((node) => !parents.has(node.revision)) });
		},
		async readSnapshot(id, token, node) {
			return clone(files.get(`${id}:${node.revision}`));
		},
		async writeSnapshot(id, token, value) {
			posts++;
			files.set(`${id}:${value.revision}`, clone(value));
			return {
				revision: value.revision,
				parents: value.parents,
				fileId: `file-${value.revision}`,
				createdAt: DATE,
			};
		},
	};
	let counter = 0;
	let clock = DATE;
	const createSession = (overrides = {}) =>
		createMoneySession({
			storage,
			auth,
			drive,
			createRevision: () => `local-${++counter}`,
			now: () => clock,
			...overrides,
		});
	const session = createSession();
	return {
		session,
		createSession,
		setTime(value) {
			clock = value;
		},
		storage,
		auth,
		drive,
		accounts,
		files,
		writes,
		select(id) {
			selected = id;
		},
		add(value) {
			files.set(`${value.accountId}:${value.revision}`, clone(value));
		},
		get guest() {
			return guest;
		},
		get active() {
			return active;
		},
		get posts() {
			return posts;
		},
		get nativeSignouts() {
			return nativeSignouts;
		},
	};
}

test('initialize is offline, loads only active account cache, and missing/corrupt cache blocks edits', async () => {
	for (const records of [[], [{ ...record('A'), accountId: 'B' }]]) {
		const h = harness({ active: profiles.A, records });
		h.drive.listHeads = async () => {
			throw new Error('must not call Drive');
		};
		assert.equal(await h.session.initialize(), false);
		assert.equal(h.session.getState().data, null);
		assert.ok(h.session.getState().loadError);
		assert.equal(await h.session.updateSources([]), false);
		assert.equal(h.writes.length, 0);
		assert.equal(await h.session.signOut(), true);
		assert.deepEqual(h.session.getState().data, data(44));
	}
	const h = harness({ active: profiles.A, records: [record('A', data(23), 'r1')] });
	h.auth.accessToken = async () => {
		throw new Error('must not authenticate');
	};
	assert.equal(await h.session.initialize(), true);
	assert.equal(h.session.getState().data.wallet.sources[0].amountMinor, 23);
});

test('sign-in automatically restores sole cloud head without replaying paid amounts', async () => {
	const paid = finance.saveRecurringEntry(
		finance.saveRecurringItem(data(), tracker),
		'rent',
		'2026-01-01',
		entry,
	);
	const h = harness({ snapshots: [snapshot('A', 'r1', [], paid)] });
	await h.session.initialize();
	assert.equal(await h.session.signIn(), true);
	assert.deepEqual(h.session.getState().data, paid);
	assert.equal(h.session.getState().data.wallet.sources[0].amountMinor, 500);
	assert.equal(h.session.getState().dirty, false);
	assert.equal(h.session.getState().canImportGuest, false);
	assert.equal(h.posts, 0);
	assert.equal(await h.session.sync(), true);
	assert.equal(h.session.getState().data.wallet.sources[0].amountMinor, 500);
	h.add(
		snapshot('A', 'r2', ['r1'], {
			...paid,
			wallet: { ...paid.wallet, sources: [{ id: 'bank', name: 'Bank', amountMinor: 200 }] },
		}),
	);
	assert.equal(await h.session.sync(), true);
	assert.equal(h.session.getState().data.wallet.sources[0].amountMinor, 200);
	assert.equal(h.posts, 0);
});

test('guest import is explicit, survives a clean automatic sync, and keeps guest intact', async () => {
	const h = harness();
	await h.session.initialize();
	await h.session.signIn();
	assert.deepEqual(h.session.getState().data, model.emptyData());
	assert.equal(h.session.getState().canImportGuest, true);
	assert.equal(h.posts, 0);
	await h.session.sync();
	assert.equal(h.session.getState().canImportGuest, true);
	assert.equal(await h.session.importGuest(), true);
	assert.equal(h.session.getState().dirty, true);
	assert.deepEqual(h.session.getState().data, data(44));
	assert.deepEqual(h.guest, data(44));
	await h.session.sync();
	assert.equal(h.posts, 1);
	assert.equal(h.session.getState().dirty, false);
	assert.equal(await h.session.importGuest(), false);
});

test('A/B account switching and logout never copy previous account or guest data implicitly', async () => {
	const h = harness({
		snapshots: [snapshot('A', 'a1', [], data(10)), snapshot('B', 'b1', [], data(20))],
	});
	await h.session.initialize();
	await h.session.signIn();
	await h.session.updateSources(data(11).wallet.sources);
	const a = clone(h.accounts.get('A'));
	h.select('B');
	await h.session.signIn();
	assert.equal(h.session.getState().account.id, 'B');
	assert.deepEqual(h.session.getState().data, data(20));
	assert.deepEqual(h.accounts.get('A'), a);
	await h.session.signOut();
	assert.deepEqual(h.session.getState().data, data(44));
	assert.equal(h.active, null);
	assert.equal(h.nativeSignouts, 1);
	h.select('A');
	await h.session.signIn();
	assert.equal(h.session.getState().dirty, true);
	assert.equal(h.session.getState().data.wallet.sources[0].amountMinor, 11);
});

test('failed target account write or active marker write leaves current in-memory account unchanged', async () => {
	for (const failMarker of [false, true]) {
		const h = harness({ snapshots: [snapshot('A', 'a1'), snapshot('B', 'b1', [], data(2))] });
		await h.session.initialize();
		await h.session.signIn();
		const before = h.session.getState().data;
		h.select('B');
		if (failMarker)
			h.storage.saveActiveAccount = async () => {
				throw new Error('marker full');
			};
		else
			h.storage.saveAccountData = async () => {
				throw new Error('disk full');
			};
		await assert.rejects(h.session.signIn(), /full/);
		assert.equal(h.session.getState().account.id, 'A');
		assert.equal(h.session.getState().data, before);
		assert.equal(h.session.getState().saving, false);
		assert.equal(h.active.id, 'A');
	}
});

test('cached account activates offline; first account with failed cloud read never activates empty', async () => {
	for (const cached of [false, true]) {
		const h = harness({ records: cached ? [record('A', data(9), 'r1')] : [] });
		await h.session.initialize();
		h.drive.listHeads = async () => {
			throw offline();
		};
		assert.equal(await h.session.signIn(), cached);
		assert.equal(h.session.getState().account?.id ?? null, cached ? 'A' : null);
		assert.ok(h.session.getState().syncError);
		assert.doesNotMatch(h.session.getState().syncError, /secret-token/);
		assert.equal(h.writes.length, cached ? 1 : 0);
	}
});

test('cached offline activation also accepts an untyped injected network rejection', async () => {
	const h = harness({ records: [record('A', data(8), 'r1')] });
	await h.session.initialize();
	h.auth.accessToken = async () => {
		throw new Error('offline SECRET');
	};
	assert.equal(await h.session.signIn(), true);
	assert.equal(h.session.getState().account.id, 'A');
	assert.deepEqual(h.session.getState().data, data(8));
	assert.doesNotMatch(h.session.getState().syncError, /SECRET/);
	assert.equal(h.posts, 0);
});

test('offline local edits persist once, then upload immutable snapshot with base parent', async () => {
	const h = harness({ snapshots: [snapshot('A', 'r1')] });
	await h.session.initialize();
	await h.session.signIn();
	const lists = h.drive.listHeads;
	h.drive.listHeads = async () => {
		throw offline();
	};
	const writes = h.writes.length;
	await h.session.updateSources(data(55).wallet.sources);
	assert.equal(h.writes.length, writes + 1);
	assert.equal(h.accounts.get('A').dirty, true);
	assert.equal(await h.session.sync(), false);
	assert.equal(h.session.getState().dirty, true);
	assert.equal(h.session.getState().saving, false);
	await h.session.saveTracker(tracker);
	h.drive.listHeads = lists;
	assert.equal(await h.session.sync(), true);
	assert.equal(h.posts, 1);
	const saved = h.files.get(`A:${h.session.getState().revision}`);
	assert.deepEqual(saved.parents, ['r1']);
	assert.equal(saved.data.wallet.sources[0].amountMinor, 55);
	assert.equal(h.session.getState().dirty, false);
});

test('financial validation and failed account persistence never partially apply balance/history', async () => {
	const h = harness({
		snapshots: [snapshot('A', 'r1', [], finance.saveRecurringItem(data(), tracker))],
	});
	await h.session.initialize();
	await h.session.signIn();
	const before = h.session.getState();
	const save = h.storage.saveAccountData;
	let writes = 0;
	h.storage.saveAccountData = async () => {
		writes++;
		throw new Error('disk full');
	};
	await assert.rejects(h.session.saveEntry('rent', '2026-01-01', entry), /disk full/);
	assert.equal(h.session.getState().data, before.data);
	assert.equal(h.session.getState().revision, before.revision);
	assert.equal(h.session.getState().dirty, before.dirty);
	assert.equal(writes, 1);
	await assert.rejects(h.session.updateSources([]), /references/);
	assert.equal(writes, 1);
	h.storage.saveAccountData = save;
	await h.session.saveEntry('rent', '2026-01-01', entry);
	assert.equal(h.session.getState().data.wallet.sources[0].amountMinor, 500);
	assert.equal(
		h.session.getState().data.trackers.items[0].entries['2026-01-01'].applied.amountMinor,
		-500,
	);
});

test('corrupt cloud bodies and account mismatches block sync without resetting or uploading', async () => {
	for (const bad of [{ version: 999 }, snapshot('B', 'r1'), snapshot('A', 'wrong')]) {
		const h = harness({
			active: profiles.A,
			records: [record('A', data(9), 'r1', true, null)],
			snapshots: [snapshot('A', 'r1')],
		});
		await h.session.initialize();
		h.drive.readSnapshot = async () => bad;
		const before = h.session.getState().data;
		assert.equal(await h.session.sync(), false);
		assert.equal(h.session.getState().data, before);
		assert.equal(h.posts, 0);
		assert.equal(h.writes.length, 0);
	}
});

test('dirty divergence and concurrent branches never upload before explicit choice', async () => {
	const h = harness({ snapshots: [snapshot('A', 'r1')] });
	await h.session.initialize();
	await h.session.signIn();
	await h.session.updateSources(data(21).wallet.sources);
	h.add(snapshot('A', 'r2', ['r1'], data(22)));
	assert.equal(await h.session.sync(), false);
	assert.ok(h.session.getState().conflict);
	assert.equal(h.posts, 0);
	assert.equal(await h.session.updateSources([]), false);
	assert.equal(await h.session.resolveConflict('local'), true);
	assert.deepEqual(h.accounts.get('A').pendingParents, ['r2']);
	assert.equal(await h.session.sync(), true);
	assert.equal(h.posts, 1);
	assert.deepEqual([...h.files.values()].at(-1).parents, ['r2']);
	assert.equal(h.session.getState().data.wallet.sources[0].amountMinor, 21);
});

test('post-upload re-list catches first-create race and later child races without dropping branches', async () => {
	for (const root of [true, false]) {
		const h = harness({ snapshots: root ? [] : [snapshot('A', 'r1')] });
		await h.session.initialize();
		await h.session.signIn();
		await h.session.updateSources(data(21).wallet.sources);
		const write = h.drive.writeSnapshot;
		h.drive.writeSnapshot = async (...args) => {
			const node = await write(...args);
			h.add(snapshot('A', 'other', root ? [] : ['r1'], data(99)));
			return node;
		};
		assert.equal(await h.session.sync(), false);
		assert.equal(h.session.getState().conflict.heads.length, 2);
		assert.equal(h.session.getState().lastSyncedAt, root ? null : DATE);
		assert.equal(h.posts, 1);
		assert.equal(await h.session.resolveConflict('remote', 'other'), true);
		const resolved = h.accounts.get('A');
		assert.deepEqual(resolved.pendingParents, ['local-1', 'other']);
		assert.equal(resolved.data.wallet.sources[0].amountMinor, 99);
		h.drive.writeSnapshot = write;
		assert.equal(await h.session.sync(), true);
		assert.deepEqual([...h.files.values()].at(-1).parents, ['local-1', 'other']);
	}
});

test('remote deletion conflicts instead of resetting or recreating; explicit local recreation is allowed', async () => {
	const h = harness({ snapshots: [snapshot('A', 'r1')] });
	await h.session.initialize();
	await h.session.signIn();
	h.files.clear();
	assert.equal(await h.session.sync(), false);
	assert.match(h.session.getState().conflict.message, /missing/);
	assert.equal(h.posts, 0);
	assert.deepEqual(h.session.getState().data, data());
	assert.equal(await h.session.resolveConflict('local'), true);
	assert.deepEqual(h.accounts.get('A').pendingParents, []);
	assert.equal(await h.session.sync(), true);
});

test('stale conflict resolution persists refreshed heads without changing money data', async () => {
	const h = harness({ snapshots: [snapshot('A', 'r1'), snapshot('A', 'r2')] });
	await h.session.initialize();
	await h.session.signIn();
	const writes = h.writes.length;
	const before = clone(h.accounts.get('A'));
	h.add(snapshot('A', 'r3', ['r2']));
	assert.equal(await h.session.resolveConflict('remote', 'r2'), false);
	assert.equal(h.writes.length, writes + 1);
	assert.deepEqual(h.accounts.get('A').data, before.data);
	assert.equal(h.accounts.get('A').localRevision, before.localRevision);
	assert.deepEqual(h.accounts.get('A').conflict, h.session.getState().conflict);
	assert.deepEqual(
		h.session.getState().conflict.heads.map((node) => node.revision),
		['r1', 'r3'],
	);
	assert.equal(h.posts, 0);
});

test('resolution retry is constrained to its persisted head set across offline edits and restart', async () => {
	const h = harness({ snapshots: [snapshot('A', 'r1'), snapshot('A', 'r2')] });
	await h.session.initialize();
	await h.session.signIn();
	await h.session.resolveConflict('remote', 'r2');
	await h.session.updateSources(data(12).wallet.sources);
	assert.deepEqual(h.accounts.get('A').pendingParents, ['r1', 'r2']);
	await h.session.reload();
	h.add(snapshot('A', 'r3', ['r2']));
	assert.equal(await h.session.sync(), false);
	assert.ok(h.session.getState().conflict);
	assert.equal(h.posts, 0);
});

test('ambiguous upload retry validates and acknowledges existing revision without another POST', async () => {
	const h = harness();
	await h.session.initialize();
	await h.session.signIn();
	await h.session.importGuest();
	const write = h.drive.writeSnapshot;
	h.drive.writeSnapshot = async (...args) => {
		await write(...args);
		throw offline();
	};
	assert.equal(await h.session.sync(), false);
	assert.equal(h.session.getState().dirty, true);
	assert.equal(h.posts, 1);
	h.drive.writeSnapshot = write;
	assert.equal(await h.session.sync(), true);
	assert.equal(h.posts, 1);
	assert.equal(h.session.getState().dirty, false);
});

test('known ambiguous revision with different contents fails safely; verified descendant refreshes', async () => {
	for (const mismatch of [false, true]) {
		const h = harness({
			active: profiles.A,
			records: [record('A', data(12), 'local', true, null)],
			snapshots: [
				snapshot('A', 'local', [], data(mismatch ? 99 : 12)),
				snapshot('A', 'newer', ['local'], data(20)),
			],
		});
		await h.session.initialize();
		assert.equal(await h.session.sync(), !mismatch);
		assert.equal(h.posts, 0);
		assert.equal(h.session.getState().data.wallet.sources[0].amountMinor, mismatch ? 12 : 20);
		assert.equal(h.session.getState().dirty, mismatch);
	}
});

test('failed local acknowledgement keeps dirty state and retry verifies without duplicate upload', async () => {
	const h = harness();
	await h.session.initialize();
	await h.session.signIn();
	await h.session.importGuest();
	const save = h.storage.saveAccountData;
	h.storage.saveAccountData = async () => {
		throw new Error('disk full');
	};
	await assert.rejects(h.session.sync(), /disk full/);
	assert.equal(h.session.getState().dirty, true);
	assert.equal(h.session.getState().lastSyncedAt, null);
	assert.equal(h.posts, 1);
	h.storage.saveAccountData = save;
	assert.equal(await h.session.sync(), true);
	assert.equal(h.posts, 1);
});

test('one synchronous lock rejects edits/reload/signout/signin while late sync result is pending', async () => {
	const h = harness({ snapshots: [snapshot('A', 'r1')] });
	await h.session.initialize();
	await h.session.signIn();
	let finish;
	const list = h.drive.listHeads;
	h.drive.listHeads = () =>
		new Promise((resolve) => {
			finish = async () => resolve(await list('A'));
		});
	const changes = [];
	const unsubscribe = h.session.subscribe((state) => changes.push(state.saving));
	const pending = h.session.sync();
	assert.equal(h.session.getState().saving, true);
	assert.equal(await h.session.updateSources([]), false);
	assert.equal(await h.session.reload(), false);
	assert.equal(await h.session.signOut(), false);
	assert.equal(await h.session.signIn(), false);
	assert.equal(await h.session.sync(), false);
	assert.equal(await h.session.importGuest(), false);
	await new Promise((resolve) => setImmediate(resolve));
	await finish();
	assert.equal(await pending, true);
	assert.equal(h.session.getState().account.id, 'A');
	assert.deepEqual(
		changes.filter((value, index) => index === 0 || value !== changes[index - 1]),
		[true, false],
	);
	unsubscribe();
});

test('load failures block all edits and reload recovery restores editing without overwriting storage', async () => {
	const h = harness();
	await h.session.initialize();
	const before = h.session.getState().data;
	const load = h.storage.loadMoneyData;
	h.storage.loadMoneyData = async () => {
		throw new Error('corrupt');
	};
	assert.equal(await h.session.reload(), false);
	assert.equal(h.session.getState().data, before);
	assert.equal(await h.session.updateSources([]), false);
	h.storage.loadMoneyData = load;
	assert.equal(await h.session.reload(), true);
	assert.equal(await h.session.updateSources([]), true);
});

test('logout guest/marker failures preserve active memory and native logout is best effort', async () => {
	for (const stage of ['guest', 'marker', 'native']) {
		const h = harness({ snapshots: [snapshot('A', 'r1')] });
		await h.session.initialize();
		await h.session.signIn();
		const before = h.session.getState().data;
		if (stage === 'guest')
			h.storage.loadMoneyData = async () => {
				throw new Error('guest corrupt');
			};
		if (stage === 'marker')
			h.storage.saveActiveAccount = async () => {
				throw new Error('marker failed');
			};
		if (stage === 'native')
			h.auth.signOut = async () => {
				throw new Error('native failed');
			};
		if (stage === 'native') {
			assert.equal(await h.session.signOut(), true);
			assert.equal(h.session.getState().account, null);
			assert.equal(h.active, null);
		} else {
			await assert.rejects(h.session.signOut());
			assert.equal(h.session.getState().data, before);
			assert.equal(h.session.getState().account.id, 'A');
			assert.equal(h.active.id, 'A');
			assert.equal(h.nativeSignouts, 0);
		}
		assert.equal(h.session.getState().saving, false);
		assert.ok(h.accounts.has('A'));
		assert.equal(h.files.size, 1);
	}
});

test('known conflicts survive same-account reload and offline reauthentication', async () => {
	const h = harness({ snapshots: [snapshot('A', 'r1'), snapshot('A', 'r2')] });
	await h.session.initialize();
	await h.session.signIn();
	assert.ok(h.session.getState().conflict);
	await h.session.reload();
	assert.ok(h.session.getState().conflict);
	assert.equal(await h.session.updateSources([]), false);
	h.drive.listHeads = async () => {
		throw offline();
	};
	assert.equal(await h.session.signIn(), true);
	assert.ok(h.session.getState().conflict);
	assert.equal(await h.session.updateSources([]), false);
});

test('failed conflict resolution persistence leaves local data, revision and conflict untouched', async () => {
	const h = harness({ snapshots: [snapshot('A', 'r1'), snapshot('A', 'r2', [], data(8))] });
	await h.session.initialize();
	await h.session.signIn();
	const before = h.session.getState();
	h.storage.saveAccountData = async () => {
		throw new Error('disk full');
	};
	await assert.rejects(h.session.resolveConflict('remote', 'r2'), /disk full/);
	assert.equal(h.session.getState().data, before.data);
	assert.equal(h.session.getState().revision, before.revision);
	assert.equal(h.session.getState().conflict, before.conflict);
	assert.equal(h.posts, 0);
});

test('account verification failure never calls Drive or changes account/cache', async () => {
	const h = harness();
	await h.session.initialize();
	const before = h.session.getState().data;
	h.auth.accessToken = async () => {
		throw Object.assign(new Error('SECRET wrong account'), { code: 'auth' });
	};
	h.drive.listHeads = async () => {
		throw new Error('Drive must not be called');
	};
	assert.equal(await h.session.signIn(), false);
	assert.equal(h.session.getState().data, before);
	assert.equal(h.session.getState().account, null);
	assert.equal(h.writes.length, 0);
	assert.doesNotMatch(h.session.getState().syncError, /SECRET/);
	assert.equal(await h.session.sync(), false);
});

test('a clean cache never silently replaces its data with an unrelated sole remote root', async () => {
	const h = harness({
		active: profiles.A,
		records: [record('A', data(7), 'old-root')],
		snapshots: [snapshot('A', 'new-root', [], data(99))],
	});
	await h.session.initialize();
	assert.equal(await h.session.sync(), false);
	assert.ok(h.session.getState().conflict);
	assert.deepEqual(h.session.getState().data, data(7));
	assert.equal(h.posts, 0);
});

test('duplicate historical revisions are checked even when they are not graph heads', async () => {
	const h = harness({
		active: profiles.A,
		records: [record('A', data(7), 'root')],
		snapshots: [snapshot('A', 'root'), snapshot('A', 'child', ['root'])],
	});
	await h.session.initialize();
	const list = h.drive.listHeads;
	const read = h.drive.readSnapshot;
	h.drive.listHeads = async (...args) => {
		const graph = await list(...args);
		graph.nodes.find((node) => node.revision === 'root').fileIds = ['root-copy1', 'root-copy2'];
		return graph;
	};
	h.drive.readSnapshot = async (...args) => {
		if (args[2].revision === 'root')
			throw Object.assign(new Error('duplicates disagree'), { code: 'invalid-cloud' });
		return read(...args);
	};
	assert.equal(await h.session.sync(), false);
	assert.deepEqual(h.session.getState().data, data(7));
	assert.equal(h.writes.length, 0);
	assert.equal(h.posts, 0);
});

test('revision upload timestamp survives retries and a new controller, and changes only with new local revision', async () => {
	const h = harness();
	await h.session.initialize();
	await h.session.signIn();
	await h.session.importGuest();
	assert.equal(h.accounts.get('A').uploadUpdatedAt, DATE);
	const attempts = [];
	const write = h.drive.writeSnapshot;
	h.drive.writeSnapshot = async (id, token, value) => {
		attempts.push(clone(value));
		throw offline();
	};
	h.setTime('2026-11-13T00:00:00.000Z');
	assert.equal(await h.session.sync(), false);
	const restarted = h.createSession();
	await restarted.initialize();
	h.setTime('2026-11-14T00:00:00.000Z');
	h.drive.writeSnapshot = async (...args) => {
		attempts.push(clone(args[2]));
		return write(...args);
	};
	assert.equal(await restarted.sync(), true);
	assert.equal(attempts.length, 2);
	assert.deepEqual(attempts[0], attempts[1]);
	assert.equal(h.accounts.get('A').uploadUpdatedAt, DATE);
	const previousRevision = restarted.getState().revision;
	await restarted.updateSources(data(88).wallet.sources);
	assert.notEqual(restarted.getState().revision, previousRevision);
	assert.equal(h.accounts.get('A').uploadUpdatedAt, '2026-11-14T00:00:00.000Z');
});

test('legacy dirty cache persists its first upload timestamp before POST, and disk failure prevents POST', async () => {
	const h = harness({
		active: profiles.A,
		records: [record('A', data(12), 'legacy', true, null)],
	});
	await h.session.initialize();
	const save = h.storage.saveAccountData;
	h.storage.saveAccountData = async () => {
		throw new Error('disk full');
	};
	await assert.rejects(h.session.sync(), /disk full/);
	assert.equal(h.posts, 0);
	assert.equal(h.session.getState().dirty, true);
	assert.equal(h.accounts.get('A').uploadUpdatedAt, undefined);
	h.storage.saveAccountData = save;
	const attempts = [];
	h.drive.writeSnapshot = async (id, token, value) => {
		assert.equal(h.accounts.get('A').uploadUpdatedAt, value.updatedAt);
		attempts.push(clone(value));
		throw offline();
	};
	assert.equal(await h.session.sync(), false);
	h.setTime('2026-11-13T00:00:00.000Z');
	const restarted = h.createSession();
	await restarted.initialize();
	assert.equal(await restarted.sync(), false);
	assert.deepEqual(attempts[0], attempts[1]);
	assert.equal(h.writes.length, 1);
});

test('first activation with multiple cloud heads persists an empty-cache guard across a true offline restart', async () => {
	const h = harness({ snapshots: [snapshot('A', 'r1'), snapshot('A', 'r2', [], data(99))] });
	await h.session.initialize();
	await h.session.signIn();
	const saved = clone(h.accounts.get('A'));
	assert.deepEqual(saved.data, model.emptyData());
	assert.equal(saved.dirty, false);
	assert.equal(saved.localRevision, null);
	assert.equal(saved.conflict.heads.length, 2);
	h.drive.listHeads = async () => {
		throw offline();
	};
	const restarted = h.createSession();
	assert.equal(await restarted.initialize(), true);
	assert.deepEqual(restarted.getState().conflict, saved.conflict);
	assert.equal(await restarted.updateSources(data(1).wallet.sources), false);
	assert.equal(await restarted.saveTracker(tracker), false);
	assert.equal(await restarted.saveEntry('rent', '2026-01-01', entry), false);
	assert.equal(await restarted.deleteTracker('rent'), false);
	assert.equal(await restarted.importGuest(), false);
	assert.equal(await restarted.sync(), false);
	assert.deepEqual(h.accounts.get('A'), saved);
	assert.equal(h.posts, 0);
});

test('offline return to another known account restores its own persisted conflict guard, including after restart', async () => {
	const h = harness({
		snapshots: [snapshot('A', 'a1'), snapshot('A', 'a2'), snapshot('B', 'b1', [], data(23))],
	});
	await h.session.initialize();
	await h.session.signIn();
	const a = clone(h.accounts.get('A'));
	h.select('B');
	await h.session.signIn();
	assert.equal(h.session.getState().conflict, null);
	assert.deepEqual(h.session.getState().data, data(23));
	h.select('A');
	h.drive.listHeads = async () => {
		throw offline();
	};
	assert.equal(await h.session.signIn(), true);
	assert.equal(h.active.id, 'A');
	assert.deepEqual(h.session.getState().data, a.data);
	assert.deepEqual(h.session.getState().conflict, a.conflict);
	assert.equal(await h.session.updateSources([]), false);
	const restarted = h.createSession();
	await restarted.initialize();
	assert.deepEqual(restarted.getState().conflict, a.conflict);
	assert.equal(await restarted.saveTracker(tracker), false);
	assert.deepEqual(h.accounts.get('B').data, data(23));
});

test('explicit resolution atomically clears the stored guard and persists retry parents across restart', async () => {
	for (const choice of ['local', 'remote']) {
		const h = harness({ snapshots: [snapshot('A', 'r1'), snapshot('A', 'r2', [], data(8))] });
		await h.session.initialize();
		await h.session.signIn();
		const restarted = h.createSession();
		await restarted.initialize();
		assert.equal(await restarted.resolveConflict(choice, 'r2'), true);
		const saved = clone(h.accounts.get('A'));
		assert.equal(saved.conflict, null);
		assert.equal(saved.dirty, true);
		assert.deepEqual(saved.pendingParents, ['r1', 'r2']);
		assert.equal(saved.uploadUpdatedAt, DATE);
		assert.deepEqual(saved.data, choice === 'local' ? model.emptyData() : data(8));
		const afterResolution = h.createSession();
		await afterResolution.initialize();
		assert.equal(afterResolution.getState().conflict, null);
		assert.equal(await afterResolution.sync(), true);
		assert.equal(h.accounts.get('A').conflict, null);
		assert.deepEqual([...h.files.values()].at(-1).parents, ['r1', 'r2']);
	}
});

test('verified cloud resolution clears a persisted guard atomically on sync or sign-in', async () => {
	for (const operation of ['sync', 'signIn']) {
		const h = harness({ snapshots: [snapshot('A', 'r1'), snapshot('A', 'r2')] });
		await h.session.initialize();
		await h.session.signIn();
		h.add(snapshot('A', 'merge', ['r1', 'r2'], data(19)));
		const restarted = h.createSession();
		await restarted.initialize();
		assert.ok(restarted.getState().conflict);
		assert.equal(await restarted[operation](), true);
		assert.equal(restarted.getState().conflict, null);
		assert.equal(h.accounts.get('A').conflict, null);
		assert.deepEqual(restarted.getState().data, data(19));
		const offlineRestart = h.createSession();
		await offlineRestart.initialize();
		assert.equal(offlineRestart.getState().conflict, null);
		assert.equal(await offlineRestart.updateSources(data(20).wallet.sources), true);
	}
});

test('failed conflict-marker write leaves money untouched and blocks edits until a successful durable retry', async () => {
	const h = harness({ snapshots: [snapshot('A', 'r1')] });
	await h.session.initialize();
	await h.session.signIn();
	h.add(snapshot('A', 'r2'));
	const before = h.session.getState();
	const stored = clone(h.accounts.get('A'));
	const save = h.storage.saveAccountData;
	h.storage.saveAccountData = async () => {
		throw new Error('disk full');
	};
	await assert.rejects(h.session.sync(), /disk full/);
	assert.ok(h.session.getState().conflict);
	assert.equal(h.session.getState().data, before.data);
	assert.equal(h.session.getState().revision, before.revision);
	assert.deepEqual(h.accounts.get('A'), stored);
	assert.equal(await h.session.updateSources([]), false);
	await h.session.reload();
	assert.ok(h.session.getState().conflict);
	assert.equal(await h.session.updateSources([]), false);
	h.storage.saveAccountData = save;
	assert.equal(await h.session.sync(), false);
	const restarted = h.createSession();
	await restarted.initialize();
	assert.ok(restarted.getState().conflict);
	assert.equal(await restarted.updateSources([]), false);
	assert.equal(h.posts, 0);
});

test('failed persistence cannot clear a stored conflict or install downloaded replacement money', async () => {
	for (const operation of ['sync', 'signIn']) {
		const h = harness({ snapshots: [snapshot('A', 'r1'), snapshot('A', 'r2')] });
		await h.session.initialize();
		await h.session.signIn();
		const before = h.session.getState();
		const stored = clone(h.accounts.get('A'));
		h.add(snapshot('A', 'merge', ['r1', 'r2'], data(19)));
		h.storage.saveAccountData = async () => {
			throw new Error('disk full');
		};
		await assert.rejects(h.session[operation](), /disk full/);
		assert.equal(h.session.getState().data, before.data);
		assert.equal(h.session.getState().conflict, before.conflict);
		assert.deepEqual(h.accounts.get('A'), stored);
		const restarted = h.createSession();
		await restarted.initialize();
		assert.ok(restarted.getState().conflict);
		assert.equal(await restarted.updateSources([]), false);
	}
});

test('post-upload branch conflict is durable even if acknowledgement cache write fails', async () => {
	const h = harness();
	await h.session.initialize();
	await h.session.signIn();
	await h.session.importGuest();
	const write = h.drive.writeSnapshot;
	const save = h.storage.saveAccountData;
	h.drive.writeSnapshot = async (...args) => {
		const result = await write(...args);
		h.add(snapshot('A', 'other'));
		h.storage.saveAccountData = async () => {
			throw new Error('disk full');
		};
		return result;
	};
	await assert.rejects(h.session.sync(), /disk full/);
	assert.ok(h.session.getState().conflict);
	assert.equal(h.session.getState().dirty, true);
	assert.equal(await h.session.updateSources([]), false);
	h.storage.saveAccountData = save;
	assert.equal(await h.session.sync(), false);
	const restarted = h.createSession();
	await restarted.initialize();
	assert.ok(restarted.getState().conflict);
	assert.equal(await restarted.updateSources([]), false);
	assert.equal(h.posts, 1);
});

test('a persisted conflict cannot be silently cleared by disappearance of all known cloud heads', async () => {
	const h = harness({ snapshots: [snapshot('A', 'r1'), snapshot('A', 'r2')] });
	await h.session.initialize();
	await h.session.signIn();
	h.files.clear();
	const restarted = h.createSession();
	await restarted.initialize();
	assert.equal(await restarted.sync(), false);
	assert.deepEqual(restarted.getState().conflict.heads, []);
	assert.equal(await restarted.sync(), false);
	assert.equal(await restarted.updateSources([]), false);
	assert.equal(await restarted.resolveConflict('local'), true);
	assert.equal(await restarted.sync(), true);
	assert.equal(h.posts, 1);
});

test('parent-provided configuration/cancellation/Play Services error mappings remain intact', async () => {
	for (const [code, message] of [
		['configuration', /not configured/],
		['cancelled', /cancelled/],
		['play-services', /Play Services/],
	]) {
		const h = harness();
		await h.session.initialize();
		h.auth.signIn = async () => {
			throw Object.assign(new Error('SECRET'), { code });
		};
		assert.equal(await h.session.signIn(), false);
		assert.match(h.session.getState().syncError, message);
		assert.doesNotMatch(h.session.getState().syncError, /SECRET/);
	}
});

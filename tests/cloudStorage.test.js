const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { transformFileSync } = require('@babel/core');
const model = require('../src/services/cloudModel');

const plain = (value) => JSON.parse(JSON.stringify(value));
const profile = { id: 'google/account:a', email: 'a@example.test', name: 'Account A' };
const record = (id = profile.id) => ({
	version: 1,
	accountId: id,
	data: model.emptyData(),
	localRevision: null,
	baseRevision: null,
	dirty: false,
	lastSyncedAt: null,
	pendingParents: null,
	uploadUpdatedAt: null,
	conflict: null,
});
function harness() {
	const values = new Map();
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
	const exports = {};
	const { code } = transformFileSync(require.resolve('../src/storage/cloudStorage'), {
		babelrc: false,
		configFile: false,
		plugins: ['@babel/plugin-transform-modules-commonjs'],
	});
	vm.runInNewContext(code, {
		exports,
		require(name) {
			if (name === '../services/cloudModel') return model;
			if (name === '@react-native-async-storage/async-storage') return native;
			throw new Error(name);
		},
	});
	return { api: exports, values, reads, writes, native };
}

test('active profile persists display metadata only; account keys are separate and encoded', async () => {
	const h = harness();
	assert.equal(await h.api.loadActiveAccount(), null);
	assert.equal(await h.api.loadAccountData(profile.id), null);
	await h.api.saveActiveAccount({ ...profile, accessToken: 'SECRET', idToken: 'SECRET' });
	await h.api.saveAccountData(profile.id, { ...record(), token: 'SECRET' });
	await h.api.saveAccountData('B', record('B'));
	assert.deepEqual(plain(await h.api.loadActiveAccount()), profile);
	assert.deepEqual(plain(await h.api.loadAccountData(profile.id)), record());
	assert.equal(h.writes.length, 3);
	assert.equal(h.writes[1][0], '@money-tracker/account/google%2Faccount%3Aa');
	assert.notEqual(h.writes[1][0], h.writes[2][0]);
	assert.ok(
		h.writes.every(
			([key, value]) => key !== '@money-tracker/data' && !value.includes('SECRET'),
		),
	);
	await h.api.saveActiveAccount(null);
	assert.equal(await h.api.loadActiveAccount(), null);
	assert.ok(await h.api.loadAccountData(profile.id));
});

test('each account envelope is one validated setItem and failures propagate without alternate writes', async () => {
	const h = harness();
	await assert.rejects(h.api.saveAccountData('B', record('A')), /cache/);
	await assert.rejects(h.api.saveAccountData('B', { ...record('B'), data: {} }));
	assert.equal(h.writes.length, 0);
	let attempts = 0;
	h.native.setItem = async () => {
		attempts++;
		throw new Error('disk full');
	};
	await assert.rejects(h.api.saveAccountData('B', record('B')), /disk full/);
	assert.equal(attempts, 1);
});

test('corrupt/mismatched cache and read errors never fall back to guest or another account', async () => {
	const h = harness();
	for (const value of [
		'{',
		'null',
		JSON.stringify(record('wrong')),
		JSON.stringify({ ...record(), dirty: true }),
		JSON.stringify({ ...record(), lastSyncedAt: 'yesterday' }),
		JSON.stringify({ ...record(), localRevision: 'r1' }),
	]) {
		h.values.set('@money-tracker/account/google%2Faccount%3Aa', value);
		await assert.rejects(h.api.loadAccountData(profile.id));
	}
	assert.equal(h.writes.length, 0);
	assert.ok(h.reads.every((key) => key.startsWith('@money-tracker/account/')));
	h.native.getItem = async () => {
		throw new Error('read failed');
	};
	await assert.rejects(h.api.loadAccountData('B'), /read failed/);
});

test('profiles, IDs, dates, revision state and parent sets normalize or reject safely', async () => {
	const h = harness();
	for (const id of ['', ' ', null, '\nA']) await assert.rejects(h.api.loadAccountData(id));
	for (const value of [{}, { ...profile, email: '' }, { ...profile, name: null }])
		await assert.rejects(h.api.saveActiveAccount(value));
	for (const value of [
		{ ...record(), version: 2 },
		{ ...record(), lastSyncedAt: '2026-02-31T00:00:00.000Z' },
		{ ...record(), localRevision: 'r1', dirty: true, pendingParents: ['r1'] },
		{ ...record(), localRevision: 'r1', dirty: true, pendingParents: ['r2', 'r2'] },
	])
		await assert.rejects(h.api.saveAccountData(profile.id, value));
	const valid = {
		...record(),
		dirty: true,
		localRevision: 'r3',
		baseRevision: 'r1',
		pendingParents: ['r2', 'r1'],
		lastSyncedAt: '2026-11-12T00:00:00Z',
	};
	await h.api.saveAccountData(profile.id, valid);
	const loaded = await h.api.loadAccountData(profile.id);
	assert.deepEqual(plain(loaded.pendingParents), ['r1', 'r2']);
	assert.equal(loaded.lastSyncedAt, '2026-11-12T00:00:00.000Z');
});

test('introduced v1 caches default absent upload/conflict fields without changing saved data', async () => {
	const h = harness();
	const old = record();
	delete old.uploadUpdatedAt;
	delete old.conflict;
	const raw = JSON.stringify(old);
	const key = '@money-tracker/account/google%2Faccount%3Aa';
	h.values.set(key, raw);
	const loaded = await h.api.loadAccountData(profile.id);
	assert.deepEqual(plain(loaded), record());
	assert.equal(h.values.get(key), raw);
	assert.equal(h.writes.length, 0);
});

test('upload timestamp and complete conflict metadata persist together in one account envelope', async () => {
	const h = harness();
	const marker = {
		message: 'Choose a complete version.',
		heads: [
			{
				revision: 'remote',
				fileId: 'file-remote',
				parents: ['base'],
				createdAt: '2026-11-12T00:00:00Z',
				fileIds: ['file-remote', 'duplicate'],
				token: 'SECRET',
			},
		],
	};
	const value = {
		...record(),
		localRevision: 'local',
		baseRevision: 'base',
		dirty: true,
		uploadUpdatedAt: '2026-11-12T00:00:00Z',
		conflict: marker,
	};
	await h.api.saveAccountData(profile.id, value);
	assert.equal(h.writes.length, 1);
	assert.doesNotMatch(h.writes[0][1], /SECRET/);
	const loaded = await h.api.loadAccountData(profile.id);
	assert.equal(loaded.uploadUpdatedAt, '2026-11-12T00:00:00.000Z');
	assert.equal(loaded.conflict.heads[0].createdAt, '2026-11-12T00:00:00.000Z');
	assert.deepEqual(plain(loaded.conflict.heads[0].parents), ['base']);
	assert.deepEqual(plain(loaded.conflict.heads[0].fileIds), ['file-remote', 'duplicate']);
	const deletion = { ...record(), conflict: { message: 'Cloud data is missing.', heads: [] } };
	await h.api.saveAccountData(profile.id, deletion);
	assert.deepEqual(plain((await h.api.loadAccountData(profile.id)).conflict), deletion.conflict);
});

test('malformed upload timestamps or conflict metadata reject on load and before any save', async () => {
	const h = harness();
	const node = {
		revision: 'r1',
		fileId: 'file-r1',
		parents: [],
		createdAt: '2026-11-12T00:00:00.000Z',
	};
	const marker = { message: 'Choose a version.', heads: [node] };
	const bad = [
		{ ...record(), uploadUpdatedAt: 'yesterday' },
		{ ...record(), uploadUpdatedAt: '2026-11-12T00:00:00.000Z' },
		...[
			{},
			{ ...marker, message: '' },
			{ ...marker, message: 'bad\nmessage' },
			{ ...marker, message: 'x'.repeat(1025) },
			{ ...marker, heads: null },
			{ ...marker, heads: [null] },
			{ ...marker, heads: [node, node] },
			...[
				{ ...node, revision: '' },
				{ ...node, fileId: '' },
				{ ...node, fileId: 'file/id' },
				{ ...node, createdAt: '2026-02-31T00:00:00.000Z' },
				{ ...node, parents: ['r1'] },
				{ ...node, parents: ['base', 'base'] },
				{ ...node, fileIds: [] },
				{ ...node, fileIds: ['other'] },
				{ ...node, fileIds: ['file-r1', 'file-r1'] },
				{ ...node, fileIds: ['file-r1', 'bad/id'] },
			].map((head) => ({ ...marker, heads: [head] })),
			{
				...marker,
				heads: [node, { ...node, revision: 'r2', fileId: 'file-r2', parents: ['r1'] }],
			},
		].map((conflict) => ({ ...record(), conflict })),
	];
	const key = '@money-tracker/account/google%2Faccount%3Aa';
	for (const value of bad) {
		await assert.rejects(h.api.saveAccountData(profile.id, value));
		h.values.set(key, JSON.stringify(value));
		await assert.rejects(h.api.loadAccountData(profile.id));
	}
	assert.equal(h.writes.length, 0);
	assert.ok(h.reads.every((key) => key === '@money-tracker/account/google%2Faccount%3Aa'));
});

test('conflict markers can retain more than 98 heads without weakening the upload-parent limit', async () => {
	const h = harness();
	const heads = Array.from({ length: 99 }, (_, index) => ({
		revision: `r${index}`,
		fileId: `file-${index}`,
		parents: [],
		createdAt: '2026-11-12T00:00:00.000Z',
	}));
	await h.api.saveAccountData(profile.id, {
		...record(),
		conflict: { message: 'Many branches.', heads },
	});
	assert.equal((await h.api.loadAccountData(profile.id)).conflict.heads.length, 99);
	await assert.rejects(
		h.api.saveAccountData(profile.id, {
			...record(),
			localRevision: 'local',
			dirty: true,
			pendingParents: heads.map((node) => node.revision),
			conflict: null,
		}),
	);
	assert.equal(h.writes.length, 1);
});

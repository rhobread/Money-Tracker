const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { transformFileSync } = require('@babel/core');
const model = require('../src/services/cloudModel');
const { createMoneySession } = require('../src/services/cloudSession');

const DATE = '2026-11-12T00:00:00.000Z';
const plain = (value) => JSON.parse(JSON.stringify(value));
const body = (revision = 'r1', parents = []) => ({
	version: 1,
	accountId: 'A',
	revision,
	parents,
	updatedAt: DATE,
	data: model.emptyData(),
});
const file = (revision = 'r1', parents = [], id = `file-${revision}`) => ({
	id,
	createdTime: DATE,
	appProperties: {
		application: 'money-tracker-v1',
		revision,
		...Object.fromEntries(parents.map((parent, index) => [`p${index}`, parent])),
	},
});
const ok = (value) => ({ ok: true, json: async () => value });
function adapter(fetch, globals = {}) {
	const exports = {};
	const { code } = transformFileSync(require.resolve('../src/services/driveStorage'), {
		babelrc: false,
		configFile: false,
		plugins: ['@babel/plugin-transform-modules-commonjs'],
	});
	vm.runInNewContext(code, {
		exports,
		require: (name) => {
			assert.equal(name, './cloudModel');
			return model;
		},
		URLSearchParams,
		AbortController,
		setTimeout,
		clearTimeout,
		...globals,
	});
	return exports.createDriveStorage({ fetch });
}

test('lists app-owned metadata only in appDataFolder, paginates, and computes every graph head', async () => {
	const requests = [];
	const drive = adapter(async (url, options) => {
		requests.push({ url, options });
		return ok(
			requests.length === 1
				? { files: [file('root')], nextPageToken: 'page2' }
				: { files: [file('a', ['root']), file('b', ['root']), file('other-root')] },
		);
	});
	const graph = await drive.listHeads('A', 'top-secret');
	assert.deepEqual(plain(graph.heads.map((node) => node.revision)), ['a', 'b', 'other-root']);
	assert.equal(graph.nodes.length, 4);
	assert.equal(requests.length, 2);
	for (const { url, options } of requests) {
		const parsed = new URL(url);
		assert.equal(parsed.searchParams.get('spaces'), 'appDataFolder');
		assert.match(parsed.searchParams.get('q'), /appProperties.*money-tracker-v1/);
		assert.match(parsed.searchParams.get('q'), /trashed = false/);
		assert.equal(parsed.searchParams.has('alt'), false);
		assert.equal(options.headers.Authorization, 'Bearer top-secret');
		assert.equal(options.signal instanceof AbortSignal, true);
	}
	assert.equal(new URL(requests[1].url).searchParams.get('pageToken'), 'page2');
});

test('Google createdTime without milliseconds is accepted and normalized for display only', async () => {
	const f = { ...file(), createdTime: '2026-11-12T00:00:00Z' };
	const drive = adapter(async () => ok({ files: [f] }));
	assert.equal((await drive.listHeads('A', 'token')).heads[0].createdAt, DATE);
});

test('invalid metadata, incomplete lists, repeated pages, missing history and cycles fail closed', async () => {
	const bad = [
		null,
		{ files: [], nextPageToken: 0 },
		{ files: [file()], incompleteSearch: true },
		{},
		{ files: [{ ...file(), appProperties: {} }] },
		{ files: [{ ...file(), appProperties: { ...file().appProperties, p1: 'root' } }] },
		{ files: [{ ...file(), appProperties: { ...file().appProperties, unexpected: 'value' } }] },
		{ files: [file('r1', ['missing'])] },
		{ files: [file('r1', ['r2']), file('r2', ['r1'])] },
		{ files: [file('r1', ['r1'])] },
		{ files: [{ ...file(), createdTime: 'yesterday' }] },
		{ files: [file('r1', []), file('r1', ['other'], 'duplicate')] },
	];
	for (const result of bad) {
		const drive = adapter(async () => ok(result));
		await assert.rejects(drive.listHeads('A', 'secret'));
	}
	const drive = adapter(async () => ok({ files: [], nextPageToken: 'same-page' }));
	await assert.rejects(drive.listHeads('A', 'secret'), /pagination/);
});

test('read validates expected account, metadata/body revision, parents and financial data', async () => {
	for (const value of [
		{ ...body(), accountId: 'B' },
		body('different'),
		body('r1', ['unexpected-parent']),
		{ ...body(), version: 2 },
		{ ...body(), data: {} },
		{ ...body(), updatedAt: 'not-a-date' },
	]) {
		const drive = adapter(async () => ok(value));
		await assert.rejects(
			drive.readSnapshot('A', 'secret', { revision: 'r1', fileId: 'f', parents: [] }),
		);
	}
	let request;
	const drive = adapter(async (url) => {
		request = url;
		return ok(body());
	});
	assert.deepEqual(
		plain(
			await drive.readSnapshot('A', 'secret', {
				revision: 'r1',
				fileId: 'file/id',
				parents: [],
			}),
		),
		body(),
	);
	assert.match(request, /file%2Fid\?alt=media$/);
});

test('duplicate revisions validate every copy, accept identical data, and reject mismatched contents', async () => {
	for (const identical of [false, true]) {
		const calls = [];
		const drive = adapter(async (url) => {
			calls.push(url);
			if (!url.includes('alt=media'))
				return ok({ files: [file('r1', [], 'one'), file('r1', [], 'two')] });
			return ok(
				url.includes('/two?') && !identical
					? {
							...body(),
							data: {
								...model.emptyData(),
								wallet: {
									...model.emptyData().wallet,
									sources: [{ id: 'bank', name: 'Bank', amountMinor: 9 }],
								},
							},
						}
					: body(),
			);
		});
		const graph = await drive.listHeads('A', 'secret');
		assert.equal(graph.heads.length, 1);
		assert.deepEqual(plain(graph.heads[0].fileIds), ['one', 'two']);
		if (identical)
			assert.deepEqual(
				plain(await drive.readSnapshot('A', 'secret', graph.heads[0])),
				body(),
			);
		else
			await assert.rejects(
				drive.readSnapshot('A', 'secret', graph.heads[0]),
				/contents disagree/,
			);
		assert.equal(calls.length, 3);
	}
});

test('multipart POST creates immutable appDataFolder revision with all parent metadata, never PATCH', async () => {
	const requests = [];
	const drive = adapter(async (url, options) => {
		requests.push({ url, options });
		return ok(file('merge', ['a', 'b']));
	});
	const value = body('merge', ['b', 'a']);
	const node = await drive.writeSnapshot('A', 'token', value);
	assert.equal(node.revision, 'merge');
	assert.equal(requests.length, 1);
	const { url, options } = requests[0];
	assert.match(url, /upload\/drive\/v3\/files\?uploadType=multipart/);
	assert.equal(options.method, 'POST');
	assert.match(options.headers['Content-Type'], /multipart\/related; boundary=/);
	assert.match(options.body, /"parents":\["appDataFolder"\]/);
	assert.match(
		options.body,
		/"application":"money-tracker-v1","revision":"merge","p0":"a","p1":"b"/,
	);
	assert.match(options.body, /"accountId":"A"/);
	assert.doesNotMatch(options.body, /token/);
	const segments = options.body.split('\r\n\r\n');
	assert.deepEqual(JSON.parse(segments[1].split('\r\n')[0]).parents, ['appDataFolder']);
});

test('invalid upload snapshots reject before HTTP; metadata supports at most 98 parents', async () => {
	let requests = 0;
	const drive = adapter(async () => {
		requests++;
		return ok(file());
	});
	await assert.rejects(drive.writeSnapshot('A', 'token', { ...body(), accountId: 'B' }));
	await assert.rejects(
		drive.writeSnapshot(
			'A',
			'token',
			body(
				'r1',
				Array.from({ length: 99 }, (_, i) => `p${i}`),
			),
		),
	);
	assert.equal(requests, 0);
	const parents = Array.from({ length: 98 }, (_, i) => `parent-${i}`);
	const allowed = adapter(async () => ok(file('merge', parents)));
	assert.equal(
		(await allowed.writeSnapshot('A', 'token', body('merge', parents))).parents.length,
		98,
	);
});

test('HTTP errors are useful and sanitized, and POST is never automatically retried', async () => {
	for (const [status, reason, code, text] of [
		[401, '', 'auth', /expired/],
		[403, '', 'permission', /denied/],
		[403, 'storageQuotaExceeded', 'storage-full', /full/],
		[403, 'userRateLimitExceeded', 'rate-limit', /rate limit/],
		[429, '', 'rate-limit', /rate limit/],
		[500, '', 'network', /failed/],
	]) {
		let requests = 0;
		const drive = adapter(async () => {
			requests++;
			return {
				ok: false,
				status,
				json: async () => ({
					error: { message: 'SECRET-BEARER-TOKEN', errors: [{ reason }] },
				}),
			};
		});
		await assert.rejects(drive.writeSnapshot('A', 'SECRET-BEARER-TOKEN', body()), (error) => {
			assert.equal(error.code, code);
			assert.match(error.message, text);
			assert.doesNotMatch(error.message, /SECRET/);
			return true;
		});
		assert.equal(requests, 1);
	}
});

test('offline/timeout errors hide underlying fetch details and abort the request', async () => {
	const offline = adapter(async () => {
		throw Object.assign(new Error('SECRET-TOKEN at URL'), { code: 'network' });
	});
	await assert.rejects(
		offline.listHeads('A', 'SECRET-TOKEN'),
		(error) => error.code === 'network' && !error.message.includes('SECRET'),
	);
	let cleared = false;
	const timeout = adapter(
		async (url, { signal }) =>
			new Promise((resolve, reject) => {
				signal.addEventListener('abort', () => reject(new Error('SECRET-TOKEN')));
			}),
		{
			setTimeout(callback, milliseconds) {
				assert.equal(milliseconds, 30000);
				queueMicrotask(callback);
				return 1;
			},
			clearTimeout(id) {
				assert.equal(id, 1);
				cleared = true;
			},
		},
	);
	await assert.rejects(
		timeout.listHeads('A', 'SECRET-TOKEN'),
		(error) => error.code === 'network' && /timed out/.test(error.message),
	);
	assert.equal(cleared, true);
});

test('successful HTTP with broken JSON blocks sync instead of acting like empty cloud', async () => {
	const drive = adapter(async () => ({
		ok: true,
		json: async () => {
			throw new Error('SECRET');
		},
	}));
	await assert.rejects(
		drive.listHeads('A', 'SECRET'),
		(error) => error.code === 'invalid-cloud' && !error.message.includes('SECRET'),
	);
});

test('duplicate snapshots tolerate only valid descriptive upload timestamp differences', async () => {
	for (const updatedAt of ['2026-11-13T00:00:00.000Z', 'not-a-date']) {
		const drive = adapter(async (url) => {
			if (!url.includes('alt=media'))
				return ok({ files: [file('r1', [], 'one'), file('r1', [], 'two')] });
			return ok(url.includes('/two?') ? { ...body(), updatedAt } : body());
		});
		const { heads } = await drive.listHeads('A', 'token');
		if (updatedAt === 'not-a-date') {
			await assert.rejects(
				drive.readSnapshot('A', 'token', heads[0]),
				(error) => error.code === 'invalid-cloud',
			);
		} else {
			const value = await drive.readSnapshot('A', 'token', heads[0]);
			assert.deepEqual(plain(value.data), model.emptyData());
			assert.equal(value.revision, 'r1');
		}
	}
});

test('late invisible POST and retry after restart produce equivalent immutable copies and never poison history', async () => {
	const files = [];
	const uploads = [];
	let pending;
	const drive = adapter(async (url, options) => {
		if (options.method === 'POST') {
			const parts = options.body.split('\r\n\r\n');
			const value = JSON.parse(parts[2].split('\r\n')[0]);
			uploads.push(plain(value));
			const item = {
				metadata: file(value.revision, value.parents, `file-${uploads.length}`),
				value,
			};
			if (uploads.length === 1) {
				pending = item;
				throw new Error('First upload response lost before server commit became visible.');
			}
			// Both creations finish after the retry's pre-upload metadata listing.
			files.push(item, pending);
			pending = null;
			return ok(item.metadata);
		}
		if (url.includes('alt=media')) {
			const id = decodeURIComponent(new URL(url).pathname.split('/').at(-1));
			return ok(files.find((item) => item.metadata.id === id).value);
		}
		return ok({ files: files.map((item) => item.metadata) });
	});
	let cache = {
		version: 1,
		accountId: 'A',
		data: model.emptyData(),
		localRevision: 'local',
		baseRevision: null,
		dirty: true,
		lastSyncedAt: null,
		pendingParents: null,
	};
	const profile = { id: 'A', email: 'a@example.test', name: 'A' };
	const storage = {
		async loadActiveAccount() {
			return profile;
		},
		async loadAccountData() {
			return plain(cache);
		},
		async saveAccountData(id, record) {
			cache = plain(model.record(record, id));
		},
	};
	const auth = {
		async accessToken(id) {
			assert.equal(id, 'A');
			return 'token';
		},
	};
	let clock = DATE;
	const createSession = () =>
		createMoneySession({
			storage,
			auth,
			drive,
			createRevision: () => 'unused',
			now: () => clock,
		});
	const first = createSession();
	await first.initialize();
	assert.equal(await first.sync(), false);
	assert.equal(uploads.length, 1);
	assert.equal(files.length, 0);
	assert.equal(cache.uploadUpdatedAt, DATE);
	clock = '2026-11-13T00:00:00.000Z';
	const restarted = createSession();
	await restarted.initialize();
	assert.equal(await restarted.sync(), true);
	assert.equal(uploads.length, 2);
	assert.equal(files.length, 2);
	assert.deepEqual(uploads[0], uploads[1]);
	assert.equal(cache.dirty, false);
	const afterAcknowledgement = createSession();
	await afterAcknowledgement.initialize();
	assert.equal(await afterAcknowledgement.sync(), true);
	// Earlier introduced copies may have descriptive timestamp differences too.
	files[0].value.updatedAt = '2026-11-14T00:00:00.000Z';
	files.push({
		metadata: file('descendant', ['local']),
		value: { ...body('descendant', ['local']), updatedAt: clock },
	});
	const historicalRestore = createSession();
	await historicalRestore.initialize();
	assert.equal(await historicalRestore.sync(), true);
	assert.equal(historicalRestore.getState().revision, 'descendant');
	assert.equal(uploads.length, 2);
	assert.equal(historicalRestore.getState().syncError, null);
	// Actual financial differences remain corruption, even in historical duplicate copies.
	files[0].value.data.wallet.sources = [{ id: 'bank', name: 'Bank', amountMinor: 1 }];
	const before = historicalRestore.getState().data;
	assert.equal(await historicalRestore.sync(), false);
	assert.equal(historicalRestore.getState().data, before);
	assert.match(historicalRestore.getState().syncError, /invalid or inconsistent/);
});

import { accountId, revisionId, parents, date, snapshot, canonical } from './cloudModel';

const API = 'https://www.googleapis.com/drive/v3/files';
const APPLICATION = 'money-tracker-v1';

class DriveError extends Error {}

function failure(message, code) {
	const error = new DriveError(message);
	error.code = code;
	return error;
}

function validateCloud(read) {
	try {
		return read();
	} catch (error) {
		if (error instanceof DriveError) throw error;
		throw failure('Google Drive data is invalid. Sync stopped.', 'invalid-cloud');
	}
}

export function createDriveStorage({ fetch: fetchImpl = globalThis.fetch } = {}) {
	async function request(token, url, options = {}) {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 30000);
		try {
			const response = await fetchImpl(url, {
				...options,
				headers: { ...options.headers, Authorization: `Bearer ${token}` },
				signal: controller.signal,
			});
			if (!response.ok) {
				let reasons = [];
				try {
					reasons =
						(await response.json()).error?.errors?.map((item) => item.reason) ?? [];
				} catch {
					/* Never expose raw server messages or credentials. */
				}
				if (response.status === 401)
					throw failure('Google sign-in expired. Sign in again.', 'auth');
				if (reasons.includes('storageQuotaExceeded'))
					throw failure('Google Drive storage is full.', 'storage-full');
				if (
					response.status === 429 ||
					reasons.some((reason) => /rateLimit|userRateLimit/i.test(reason))
				)
					throw failure(
						'Google Drive rate limit reached. Try syncing later.',
						'rate-limit',
					);
				if (response.status === 403)
					throw failure(
						'Google Drive app data access was denied. Sign in again with app data permission.',
						'permission',
					);
				throw failure('Google Drive request failed. Try syncing again.', 'network');
			}
			try {
				return await response.json();
			} catch {
				if (controller.signal.aborted)
					throw failure(
						'Google Drive timed out. Retry sync to verify the saved revision.',
						'network',
					);
				throw failure('Google Drive returned invalid JSON. Sync stopped.', 'invalid-cloud');
			}
		} catch (error) {
			if (error instanceof DriveError) throw error;
			throw failure(
				controller.signal.aborted
					? 'Google Drive timed out. Retry sync to check whether the revision was saved.'
					: 'Google Drive is unavailable. Your local data is unchanged; try again when online.',
				'network',
			);
		} finally {
			clearTimeout(timeout);
		}
	}

	function nodeFrom(file) {
		const properties = file.appProperties;
		if (
			!properties ||
			properties.application !== APPLICATION ||
			Object.keys(properties).length > 100 ||
			Object.entries(properties).some(
				([key, value]) =>
					typeof value !== 'string' ||
					/[^\x20-\x7e]/.test(key + value) ||
					(key + value).length > 124,
			)
		)
			throw failure('Invalid cloud revision metadata. Sync stopped.', 'invalid-cloud');
		const revision = revisionId(properties.revision);
		const keys = Object.keys(properties).filter(
			(key) => key !== 'application' && key !== 'revision',
		);
		if (
			keys.some((key) => !/^p(0|[1-9]\d*)$/.test(key)) ||
			keys.some((_, index) => !Object.hasOwn(properties, `p${index}`))
		)
			throw failure('Invalid cloud parent metadata. Sync stopped.', 'invalid-cloud');
		if (typeof file.id !== 'string' || !file.id)
			throw failure('Invalid cloud file ID.', 'invalid-cloud');
		return {
			revision,
			fileId: file.id,
			parents: parents(
				keys.map((_, index) => properties[`p${index}`]),
				revision,
			),
			createdAt: date(file.createdTime),
		};
	}

	async function listHeads(id, token) {
		accountId(id);
		const byRevision = new Map();
		const pages = new Set();
		let pageToken;
		do {
			const query = new URLSearchParams({
				spaces: 'appDataFolder',
				q: `trashed = false and appProperties has { key='application' and value='${APPLICATION}' }`,
				fields: 'nextPageToken,incompleteSearch,files(id,appProperties,createdTime)',
				pageSize: '1000',
				...(pageToken ? { pageToken } : {}),
			});
			const result = await request(token, `${API}?${query}`);
			if (!result || !Array.isArray(result.files) || result.incompleteSearch)
				throw failure('Incomplete cloud listing. Sync stopped.', 'invalid-cloud');
			for (const file of result.files) {
				const node = validateCloud(() => nodeFrom(file));
				const prior = byRevision.get(node.revision);
				if (prior) {
					if (canonical(prior.parents) !== canonical(node.parents))
						throw failure(
							'Duplicate cloud revisions disagree. Sync stopped.',
							'invalid-cloud',
						);
					prior.fileIds = [
						...new Set([...(prior.fileIds ?? [prior.fileId]), node.fileId]),
					];
				} else byRevision.set(node.revision, node);
			}
			pageToken = result.nextPageToken;
			if (
				pageToken !== undefined &&
				pageToken !== null &&
				(typeof pageToken !== 'string' || !pageToken || pages.has(pageToken))
			)
				throw failure('Invalid cloud pagination. Sync stopped.', 'invalid-cloud');
			pages.add(pageToken);
		} while (pageToken);
		const referenced = new Set();
		const children = new Map();
		const remaining = new Map();
		const nodes = [...byRevision.values()];
		for (const node of nodes) {
			remaining.set(node.revision, node.parents.length);
			for (const parent of node.parents) {
				referenced.add(parent);
				if (!byRevision.has(parent))
					throw failure(
						'Cloud history is missing a parent revision. Sync stopped.',
						'invalid-cloud',
					);
				if (!children.has(parent)) children.set(parent, []);
				children.get(parent).push(node.revision);
			}
		}
		// Topological traversal avoids a call-stack bound on retained revision history.
		const queue = nodes
			.filter((node) => node.parents.length === 0)
			.map((node) => node.revision);
		for (let index = 0; index < queue.length; index++) {
			for (const child of children.get(queue[index]) ?? []) {
				remaining.set(child, remaining.get(child) - 1);
				if (remaining.get(child) === 0) queue.push(child);
			}
		}
		if (queue.length !== nodes.length)
			throw failure('Cloud revision graph contains a cycle.', 'invalid-cloud');
		return { nodes, heads: nodes.filter((node) => !referenced.has(node.revision)) };
	}

	async function readSnapshot(id, token, node) {
		let first;
		for (const fileId of node.fileIds ?? [node.fileId]) {
			const raw = await request(token, `${API}/${encodeURIComponent(fileId)}?alt=media`);
			const value = validateCloud(() => snapshot(raw, id));
			if (
				value.revision !== node.revision ||
				canonical(value.parents) !== canonical(node.parents)
			)
				throw failure(
					'Cloud metadata and snapshot disagree. Sync stopped.',
					'invalid-cloud',
				);
			// Timestamps are descriptive; every immutable financial identity field must agree.
			if (
				first &&
				canonical({ ...first, updatedAt: null }) !==
					canonical({ ...value, updatedAt: null })
			)
				throw failure(
					'Duplicate cloud revision contents disagree. Sync stopped.',
					'invalid-cloud',
				);
			first = value;
		}
		return first;
	}

	async function writeSnapshot(id, token, value) {
		const body = snapshot(value, id);
		const appProperties = { application: APPLICATION, revision: body.revision };
		body.parents.forEach((parent, index) => {
			appProperties[`p${index}`] = parent;
		});
		const boundary = `money_tracker_${body.revision}`;
		const metadata = {
			name: `${body.revision}.json`,
			parents: ['appDataFolder'],
			mimeType: 'application/json',
			appProperties,
		};
		const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(body)}\r\n--${boundary}--\r\n`;
		const result = await request(
			token,
			'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,appProperties,createdTime',
			{
				method: 'POST',
				headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
				body: multipart,
			},
		);
		const node = validateCloud(() => nodeFrom(result));
		if (node.revision !== body.revision || canonical(node.parents) !== canonical(body.parents))
			throw failure(
				'Uploaded revision metadata is invalid. Retry sync to verify the saved revision.',
				'invalid-cloud',
			);
		return node;
	}
	return { listHeads, readSnapshot, writeSnapshot };
}

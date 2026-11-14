const { validateAppData } = require('../utils/appData');

function accountId(value) {
	if (
		typeof value !== 'string' ||
		!value.trim() ||
		value.length > 256 ||
		/[\x00-\x20]/.test(value)
	) {
		throw new Error('Invalid account ID.');
	}
	return value;
}

function revisionId(value) {
	if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) {
		throw new Error('Invalid cloud revision.');
	}
	return value;
}

function date(value) {
	if (
		typeof value !== 'string' ||
		!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) ||
		!Number.isFinite(Date.parse(value)) ||
		new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19)
	) {
		throw new Error('Invalid sync date.');
	}
	return new Date(value).toISOString();
}

function parents(value, revision) {
	if (!Array.isArray(value) || value.length > 98)
		throw new Error('Too many or invalid cloud parents.');
	const result = value.map(revisionId);
	if (new Set(result).size !== result.length || result.includes(revision))
		throw new Error('Invalid cloud parents.');
	return result.sort();
}

function profile(value) {
	if (
		!value ||
		typeof value.email !== 'string' ||
		!value.email.trim() ||
		value.email.length > 320 ||
		typeof value.name !== 'string' ||
		value.name.length > 256
	) {
		throw new Error('Invalid account profile.');
	}
	return { id: accountId(value.id), email: value.email, name: value.name };
}

function conflict(value) {
	if (value === undefined || value === null) return null;
	if (
		typeof value.message !== 'string' ||
		!value.message.trim() ||
		value.message.length > 1024 ||
		/[\x00-\x1f]/.test(value.message) ||
		!Array.isArray(value.heads)
	)
		throw new Error('Invalid account conflict.');
	const fileId = (id) => {
		if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(id))
			throw new Error('Invalid conflict file ID.');
		return id;
	};
	const heads = value.heads.map((node) => {
		if (!node) throw new Error('Invalid conflict head.');
		const revision = revisionId(node.revision);
		const result = {
			revision,
			fileId: fileId(node.fileId),
			parents: parents(node.parents, revision),
			createdAt: date(node.createdAt),
		};
		if (node.fileIds !== undefined) {
			if (!Array.isArray(node.fileIds) || !node.fileIds.length)
				throw new Error('Invalid conflict duplicate files.');
			result.fileIds = node.fileIds.map(fileId);
			if (
				new Set(result.fileIds).size !== result.fileIds.length ||
				!result.fileIds.includes(result.fileId)
			)
				throw new Error('Invalid conflict duplicate files.');
		}
		return result;
	});
	const revisions = new Set(heads.map((node) => node.revision));
	if (
		revisions.size !== heads.length ||
		heads.some((node) => node.parents.some((parent) => revisions.has(parent)))
	)
		throw new Error('Invalid account conflict heads.');
	return { message: value.message, heads };
}

function record(value, expectedId) {
	accountId(expectedId);
	if (
		!value ||
		value.version !== 1 ||
		value.accountId !== expectedId ||
		typeof value.dirty !== 'boolean'
	)
		throw new Error('Invalid account cache.');
	const localRevision = value.localRevision === null ? null : revisionId(value.localRevision);
	const baseRevision = value.baseRevision === null ? null : revisionId(value.baseRevision);
	const pendingParents =
		value.pendingParents === null ? null : parents(value.pendingParents, localRevision);
	const uploadUpdatedAt =
		value.uploadUpdatedAt === undefined || value.uploadUpdatedAt === null
			? null
			: date(value.uploadUpdatedAt);
	if (
		(value.dirty && !localRevision) ||
		(uploadUpdatedAt !== null && localRevision === null) ||
		(!value.dirty && (localRevision !== baseRevision || pendingParents !== null))
	)
		throw new Error('Invalid account revision state.');
	return {
		version: 1,
		accountId: expectedId,
		data: validateAppData(value.data),
		localRevision,
		baseRevision,
		dirty: value.dirty,
		lastSyncedAt: value.lastSyncedAt === null ? null : date(value.lastSyncedAt),
		pendingParents,
		uploadUpdatedAt,
		conflict: conflict(value.conflict),
	};
}

function snapshot(value, expectedId) {
	if (!value || value.version !== 1 || value.accountId !== accountId(expectedId))
		throw new Error('Cloud snapshot belongs to a different account or is invalid.');
	const revision = revisionId(value.revision);
	return {
		version: 1,
		accountId: expectedId,
		revision,
		parents: parents(value.parents, revision),
		updatedAt: date(value.updatedAt),
		data: validateAppData(value.data),
	};
}

function canonical(value) {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (value && typeof value === 'object')
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
			.join(',')}}`;
	return JSON.stringify(value);
}

function emptyData() {
	return validateAppData({
		version: 1,
		wallet: { version: 3, currency: 'IDR', sources: [], updatedAt: null },
		trackers: { version: 2, items: [] },
	});
}

module.exports = {
	accountId,
	revisionId,
	date,
	parents,
	profile,
	conflict,
	record,
	snapshot,
	canonical,
	emptyData,
};

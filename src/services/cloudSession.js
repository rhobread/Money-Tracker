const finance = require('../utils/finance');
const model = require('./cloudModel');

function createMoneySession({ storage, auth, drive, createRevision, now = () => new Date() }) {
	let state = {
		data: null,
		loading: true,
		loadError: null,
		saving: false,
		account: null,
		syncing: false,
		authenticating: false,
		syncError: null,
		lastSyncedAt: null,
		dirty: false,
		revision: null,
		conflict: null,
		canImportGuest: false,
	};
	let current = null;
	let loaded = false;
	let locked = false;
	const listeners = new Set();
	const timestamp = () => model.date(new Date(now()).toISOString());
	const newRevision = () => model.revisionId(createRevision());
	const same = (a, b) => model.canonical(a) === model.canonical(b);
	const headSet = (heads) => heads.map((node) => node.revision).sort();
	const networkMessage =
		'Could not sync with Google Drive. Local data has not been discarded. Try again.';
	function emit(patch) {
		state = { ...state, ...patch };
		for (const listener of listeners) {
			try {
				listener(state);
			} catch {
				/* Subscribers cannot interrupt persistence. */
			}
		}
	}
	function setRecord(record, extra = {}) {
		current = record;
		emit({
			data: record.data,
			dirty: record.dirty,
			revision: record.localRevision,
			lastSyncedAt: record.lastSyncedAt,
			conflict: record.conflict,
			canImportGuest: false,
			...extra,
		});
	}
	function acquire(flags = {}) {
		if (locked) return false;
		locked = true;
		emit({ saving: true, ...flags });
		return true;
	}
	function release() {
		locked = false;
		emit({ saving: false, syncing: false, authenticating: false });
	}
	function syncFailure(error) {
		const safe = {
			cancelled: 'Google sign-in cancelled. Your data is unchanged.',
			configuration:
				'Google sign-in is not configured for this build. Follow the Google setup instructions in README.md.',
			'play-services': 'Google Play Services is unavailable or needs an update.',
			auth: 'Google sign-in expired or changed. Sign in again.',
			permission: 'Google Drive app data permission is required. Sign in again.',
			'storage-full': 'Google Drive storage is full.',
			'rate-limit': 'Google Drive rate limit reached. Try syncing later.',
			'invalid-cloud':
				'Google Drive data is invalid or inconsistent. Sync stopped without replacing your data.',
		};
		emit({ syncError: safe[error?.code] ?? networkMessage });
		return false;
	}
	const fresh = (id) => ({
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
	async function guestEligible(record, graph) {
		if (graph.heads.length || record.dirty || record.localRevision !== null || record.conflict)
			return false;
		const guest = finance.validateFinanceData(await storage.loadMoneyData());
		return guest.wallet.sources.length > 0 || guest.trackers.items.length > 0;
	}
	const conflict = (
		heads,
		message = 'Different saved versions need an explicit whole-snapshot choice.',
	) => ({ message, heads });
	async function persist(record) {
		const normalized = model.record(record, record.accountId);
		await storage.saveAccountData(normalized.accountId, normalized);
		setRecord(normalized);
		return normalized;
	}
	async function rememberConflict(record, marker) {
		// Keep edits blocked even if the cache write fails; data changes only after persistence.
		emit({ conflict: marker, canImportGuest: false });
		await persist({ ...record, conflict: marker, lastSyncedAt: current.lastSyncedAt });
		return false;
	}
	function reconciliation(record, marker = null) {
		return { record: { ...record, conflict: marker }, conflict: marker };
	}
	function restored(record, snapshot) {
		return {
			...record,
			data: snapshot.data,
			localRevision: snapshot.revision,
			baseRevision: snapshot.revision,
			dirty: false,
			pendingParents: null,
			uploadUpdatedAt: snapshot.updatedAt,
			lastSyncedAt: timestamp(),
		};
	}
	async function inspect(id, token) {
		const graph = await drive.listHeads(id, token);
		const snapshots = new Map();
		async function read(node) {
			if (!snapshots.has(node.revision)) {
				const raw = await drive.readSnapshot(id, token, node);
				let body;
				try {
					body = model.snapshot(raw, id);
				} catch {
					throw Object.assign(new Error('Invalid cloud snapshot.'), {
						code: 'invalid-cloud',
					});
				}
				if (
					body.revision !== node.revision ||
					!same(body.parents, [...node.parents].sort())
				)
					throw Object.assign(new Error('Inconsistent cloud snapshot.'), {
						code: 'invalid-cloud',
					});
				snapshots.set(node.revision, body);
			}
			return snapshots.get(node.revision);
		}
		// Validate every head before making any local or remote change, including conflicts.
		for (const node of graph.nodes) if (node.fileIds?.length > 1) await read(node);
		for (const node of graph.heads) await read(node);
		return { ...graph, read };
	}
	function expectedParents(record) {
		return record.pendingParents ?? (record.baseRevision ? [record.baseRevision] : []);
	}
	function canPublish(record, graph) {
		return same(headSet(graph.heads), [...expectedParents(record)].sort());
	}
	async function knownUpload(record, graph) {
		const node = graph.nodes.find((node) => node.revision === record.localRevision);
		if (!node) return null;
		const body = await graph.read(node);
		if (
			!same(body.data, record.data) ||
			!same(body.parents, [...expectedParents(record)].sort())
		)
			throw Object.assign(new Error('Existing revision has different contents.'), {
				code: 'invalid-cloud',
			});
		return body;
	}
	async function reconcile(record, graph) {
		if (!graph.heads.length && record.conflict)
			return reconciliation(
				record,
				conflict(
					[],
					'Previously observed cloud data is missing. Choose explicitly before recreating it.',
				),
			);
		if (record.dirty) {
			const own = await knownUpload(record, graph);
			if (own) {
				// Acknowledging an ambiguous upload is safe only after its content is checked.
				record = restored(record, own);
			} else {
				return reconciliation(
					record,
					canPublish(record, graph) ? null : conflict(graph.heads),
				);
			}
		}
		if (graph.heads.length > 1) return reconciliation(record, conflict(graph.heads));
		if (!graph.heads.length) {
			return reconciliation(
				record,
				record.baseRevision
					? conflict(
							[],
							'Previously synced cloud data is missing. Choose explicitly before recreating it.',
						)
					: null,
			);
		}
		const head = graph.heads[0];
		if (record.baseRevision && head.revision !== record.baseRevision) {
			// A sole unrelated root is still divergence, not a newer version.
			const ancestors = new Set();
			const nodes = new Map(graph.nodes.map((node) => [node.revision, node]));
			const pending = [head.revision];
			while (pending.length) {
				const revision = pending.pop();
				if (ancestors.has(revision)) continue;
				ancestors.add(revision);
				pending.push(...(nodes.get(revision)?.parents ?? []));
			}
			if (!ancestors.has(record.baseRevision))
				return reconciliation(record, conflict(graph.heads));
		}
		return reconciliation(restored(record, await graph.read(head)));
	}
	async function reload() {
		if (!acquire({ loading: true, loadError: null })) return false;
		loaded = false;
		try {
			const account = await storage.loadActiveAccount();
			if (account !== null) {
				const profile = model.profile(account);
				const raw = await storage.loadAccountData(profile.id);
				if (raw === null) throw new Error('The active account cache is missing.');
				const record = model.record(raw, profile.id);
				if (state.account?.id === profile.id && state.conflict && !record.conflict)
					record.conflict = state.conflict;
				setRecord(record, {
					account: profile,
					syncError: null,
				});
			} else {
				const data = finance.validateFinanceData(await storage.loadMoneyData());
				current = null;
				emit({
					account: null,
					data,
					dirty: false,
					revision: null,
					lastSyncedAt: null,
					conflict: null,
					canImportGuest: false,
					syncError: null,
				});
			}
			loaded = true;
			return true;
		} catch {
			emit({
				loadError:
					'Could not load your money data. Stored data has not been changed. Try again.',
			});
			return false;
		} finally {
			emit({ loading: false });
			release();
		}
	}
	async function commit(action, ...args) {
		if (!loaded || state.loadError || state.conflict || !acquire()) return false;
		try {
			const data = action(state.data, ...args);
			if (current) {
				await persist({
					...current,
					data,
					localRevision: newRevision(),
					dirty: true,
					uploadUpdatedAt: timestamp(),
				});
			} else {
				await storage.saveMoneyData(data);
				emit({ data });
			}
			return true;
		} finally {
			release();
		}
	}
	async function signIn() {
		if (!acquire({ authenticating: true, syncError: null })) return false;
		try {
			let profile;
			try {
				profile = model.profile(await auth.signIn());
			} catch (error) {
				return syncFailure(error);
			}
			const raw = await storage.loadAccountData(profile.id);
			let record = raw === null ? fresh(profile.id) : model.record(raw, profile.id);
			if (state.account?.id === profile.id && state.conflict && !record.conflict)
				record.conflict = state.conflict;
			let graph;
			let result;
			let syncError = null;
			try {
				const token = await auth.accessToken(profile.id);
				graph = await inspect(profile.id, token);
				result = await reconcile(record, graph);
				record = result.record;
			} catch (error) {
				if (
					raw === null ||
					(error?.code && !['network', 'rate-limit'].includes(error.code))
				)
					return syncFailure(error);
				syncError =
					'Offline account cache loaded. Changes will sync when Google Drive is available.';
			}
			const canImportGuest = graph ? await guestEligible(record, graph) : false;
			if (result?.conflict) record = { ...record, lastSyncedAt: raw?.lastSyncedAt ?? null };
			if (record.conflict && state.account?.id === profile.id)
				emit({ conflict: record.conflict, canImportGuest: false });
			// The target envelope must be durable before the active marker or memory changes.
			record = model.record(record, profile.id);
			await storage.saveAccountData(profile.id, record);
			await storage.saveActiveAccount(profile);
			setRecord(record, {
				account: profile,
				syncError,
				canImportGuest,
				loadError: null,
				loading: false,
			});
			loaded = true;
			return true;
		} finally {
			release();
		}
	}
	async function signOut() {
		if (!acquire({ authenticating: true })) return false;
		try {
			const data = finance.validateFinanceData(await storage.loadMoneyData());
			await storage.saveActiveAccount(null);
			current = null;
			loaded = true;
			emit({
				data,
				account: null,
				dirty: false,
				revision: null,
				lastSyncedAt: null,
				conflict: null,
				canImportGuest: false,
				loadError: null,
				loading: false,
				syncError: null,
			});
			try {
				await auth.signOut();
			} catch {
				/* Device cache remains signed out even if native cleanup fails. */
			}
			return true;
		} finally {
			release();
		}
	}
	async function sync() {
		if (!loaded || !current || state.loadError || !acquire({ syncing: true, syncError: null }))
			return false;
		try {
			const id = current.accountId;
			let graph;
			let token;
			let result;
			try {
				token = await auth.accessToken(id);
				graph = await inspect(id, token);
				result = await reconcile(current, graph);
			} catch (error) {
				return syncFailure(error);
			}
			if (result.conflict) {
				// Preserve an acknowledgement even if another device concurrently branched.
				return await rememberConflict(result.record, result.conflict);
			}
			if (result.record.dirty) {
				let record = result.record;
				// Older v1 caches need a durable timestamp before their first upload attempt.
				if (record.uploadUpdatedAt === null)
					record = await persist({ ...record, uploadUpdatedAt: timestamp() });
				try {
					await drive.writeSnapshot(id, token, {
						version: 1,
						accountId: id,
						revision: record.localRevision,
						parents: expectedParents(record),
						updatedAt: record.uploadUpdatedAt,
						data: record.data,
					});
					graph = await inspect(id, token);
					const own = await knownUpload(record, graph);
					if (!own)
						throw Object.assign(new Error('Uploaded revision is not yet visible.'), {
							code: 'network',
						});
					result = await reconcile(record, graph);
				} catch (error) {
					return syncFailure(error);
				}
			}
			if (result.conflict) return await rememberConflict(result.record, result.conflict);
			const canImportGuest = !result.conflict && (await guestEligible(result.record, graph));
			await persist({
				...result.record,
				lastSyncedAt: result.conflict ? current.lastSyncedAt : timestamp(),
			});
			emit({ conflict: result.conflict, syncError: null, canImportGuest });
			return !result.conflict;
		} finally {
			release();
		}
	}
	async function importGuest() {
		if (!loaded || !current || !state.canImportGuest || state.conflict || !acquire())
			return false;
		try {
			const data = finance.validateFinanceData(await storage.loadMoneyData());
			await persist({
				...current,
				data,
				localRevision: newRevision(),
				dirty: true,
				uploadUpdatedAt: timestamp(),
			});
			return true;
		} finally {
			release();
		}
	}
	async function resolveConflict(choice, revision) {
		if (!loaded || !current || !state.conflict || !acquire({ syncing: true, syncError: null }))
			return false;
		try {
			if (!['local', 'remote'].includes(choice))
				throw new Error('Choose local or remote data.');
			let graph;
			let data = current.data;
			try {
				const token = await auth.accessToken(current.accountId);
				graph = await inspect(current.accountId, token);
				if (
					same(headSet(graph.heads), headSet(state.conflict.heads)) &&
					choice === 'remote'
				) {
					const node = graph.heads.find((head) => head.revision === revision);
					if (!node) throw new Error('Choose a current remote revision.');
					data = (await graph.read(node)).data;
				}
			} catch (error) {
				return syncFailure(error);
			}
			if (!same(headSet(graph.heads), headSet(state.conflict.heads)))
				return await rememberConflict(
					current,
					conflict(
						graph.heads,
						'Cloud versions changed. Review the latest versions before choosing again.',
					),
				);
			await persist({
				...current,
				data,
				localRevision: newRevision(),
				dirty: true,
				pendingParents: model.parents(headSet(graph.heads)),
				uploadUpdatedAt: timestamp(),
				conflict: null,
			});
			return true;
		} finally {
			release();
		}
	}
	return {
		getState: () => state,
		subscribe(fn) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},
		initialize: reload,
		reload,
		signIn,
		signOut,
		sync,
		importGuest,
		resolveConflict,
		updateSources: (sources) => commit(finance.updateMoneySources, sources),
		saveTracker: (tracker) => commit(finance.saveRecurringItem, tracker),
		saveEntry: (id, key, entry) => commit(finance.saveRecurringEntry, id, key, entry),
		deleteTracker: (id) => commit(finance.deleteRecurringItem, id),
	};
}

module.exports = { createMoneySession };

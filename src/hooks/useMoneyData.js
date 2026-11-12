import { useEffect, useRef, useState } from 'react';
import { loadMoneyData, saveMoneyData } from '../storage/moneyStorage';
import {
	updateMoneySources,
	saveRecurringItem,
	saveRecurringEntry,
	deleteRecurringItem,
} from '../utils/finance';

export function useMoneyData() {
	const [data, setData] = useState(null);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState(null);
	const [saving, setSaving] = useState(false);
	const dataRef = useRef(null);
	const loadedRef = useRef(false);
	const loadingRef = useRef(false);
	const savingRef = useRef(false);

	async function reload() {
		if (savingRef.current || loadingRef.current) return false;
		loadingRef.current = true;
		loadedRef.current = false;
		setLoading(true);
		setLoadError(null);
		try {
			const next = await loadMoneyData();
			dataRef.current = next;
			setData(next);
			loadedRef.current = true;
			return true;
		} catch {
			setLoadError(
				'Could not load your money data. Stored data has not been changed. Try again.',
			);
			return false;
		} finally {
			loadingRef.current = false;
			setLoading(false);
		}
	}

	useEffect(() => {
		reload();
	}, []);

	async function commit(action, ...args) {
		if (!loadedRef.current || loadingRef.current || savingRef.current) return false;
		savingRef.current = true;
		setSaving(true);
		try {
			const next = action(dataRef.current, ...args);
			await saveMoneyData(next);
			dataRef.current = next;
			setData(next);
			return true;
		} finally {
			savingRef.current = false;
			setSaving(false);
		}
	}

	return {
		data,
		loading,
		loadError,
		saving,
		reload,
		updateSources: (sources) => commit(updateMoneySources, sources),
		saveTracker: (tracker) => commit(saveRecurringItem, tracker),
		saveEntry: (trackerId, key, entry) => commit(saveRecurringEntry, trackerId, key, entry),
		deleteTracker: (id) => commit(deleteRecurringItem, id),
	};
}

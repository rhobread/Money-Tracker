import { useEffect, useRef, useState } from 'react';
import { loadTrackers, saveTrackers } from '../storage/trackerStorage';
import { validateTrackersData } from '../utils/trackers';

export function useTrackers() {
	const [data, setData] = useState({ version: 1, items: [] });
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState(null);
	const [saving, setSaving] = useState(false);
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
			const next = await loadTrackers();
			setData(next);
			loadedRef.current = true;
			return true;
		} catch {
			setLoadError(
				'Could not load your trackers. Stored data has not been changed. Try again.',
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

	async function updateItems(nextItems) {
		if (!loadedRef.current || loadingRef.current || savingRef.current) return false;
		savingRef.current = true;
		setSaving(true);
		try {
			const next = validateTrackersData({ version: 1, items: nextItems });
			await saveTrackers(next);
			setData(next);
			return true;
		} finally {
			savingRef.current = false;
			setSaving(false);
		}
	}

	return { data, loading, loadError, saving, reload, updateItems };
}

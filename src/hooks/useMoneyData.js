import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { randomUUID } from 'expo-crypto';
import * as moneyStorage from '../storage/moneyStorage';
import * as cloudStorage from '../storage/cloudStorage';
import { getGoogleConfiguration } from '../config/google';
import { createGoogleAuth } from '../services/googleAuth';
import { createDriveStorage } from '../services/driveStorage';
import { createMoneySession } from '../services/cloudSession';

export function useMoneyData({ pauseSync = false } = {}) {
	const pausedRef = useRef(pauseSync);
	pausedRef.current = pauseSync;
	const sessionRef = useRef(null);
	const authRef = useRef(null);
	if (!sessionRef.current) {
		authRef.current = createGoogleAuth({ configuration: getGoogleConfiguration() });
		sessionRef.current = createMoneySession({
			storage: { ...moneyStorage, ...cloudStorage },
			auth: authRef.current,
			drive: createDriveStorage(),
			createRevision: randomUUID,
		});
	}
	const session = sessionRef.current;
	const [state, setState] = useState(session.getState());
	const [backgroundError, setBackgroundError] = useState(null);

	useEffect(() => {
		const unsubscribe = session.subscribe((next) => {
			if (next.syncing || next.authenticating) setBackgroundError(null);
			setState(next);
		});
		session.initialize();
		return unsubscribe;
	}, [session]);

	function sync() {
		setBackgroundError(null);
		return session.sync().catch(() => {
			setBackgroundError(
				'Could not save sync status on this phone. Your local data is kept. Try again.',
			);
			return false;
		});
	}

	useEffect(() => {
		if (
			pauseSync ||
			state.loading ||
			state.loadError ||
			state.conflict ||
			!state.account ||
			!authRef.current.availability().available
		)
			return;
		const timer = setTimeout(sync, 1500);
		return () => clearTimeout(timer);
	}, [
		session,
		state.account?.id,
		state.revision,
		state.loading,
		state.loadError,
		pauseSync,
		state.conflict,
	]);

	useEffect(() => {
		const subscription = AppState.addEventListener('change', (next) => {
			if (next === 'active' && !pausedRef.current && authRef.current.availability().available)
				sync();
		});
		return () => subscription.remove();
	}, [session]);

	return {
		...state,
		syncError: backgroundError ?? state.syncError,
		googleAvailability: authRef.current.availability(),
		reload: session.reload,
		updateSources: session.updateSources,
		saveTracker: session.saveTracker,
		saveEntry: session.saveEntry,
		deleteTracker: session.deleteTracker,
		signIn: session.signIn,
		signOut: session.signOut,
		sync,
		importGuest: session.importGuest,
		resolveConflict: session.resolveConflict,
	};
}

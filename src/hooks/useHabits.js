import { useEffect, useRef, useState } from 'react';
import * as habitStorage from '../storage/habitStorage';
import { validateHabitData, upsertHabit, deleteHabit, toggleHabitDate } from '../utils/habits';

export function useHabits({ storage = habitStorage } = {}) {
	const [state, setState] = useState({
		data: null,
		loading: true,
		saving: false,
		error: null,
	});
	const current = useRef(state);
	const locked = useRef(false);
	const writable = useRef(false);
	const storageRef = useRef(storage);
	const mounted = useRef(false);

	function update(patch) {
		current.current = { ...current.current, ...patch };
		if (mounted.current) setState(current.current);
	}

	function failure(error) {
		return { success: false, error };
	}

	async function reload() {
		if (!mounted.current) return failure('Habit data is not mounted.');
		if (locked.current) return failure('A habit operation is already in progress.');
		locked.current = true;
		writable.current = false;
		update({ loading: true, error: null });
		try {
			const data = validateHabitData(await storageRef.current.loadHabitData());
			update({ data });
			writable.current = true;
			return { success: true };
		} catch {
			const error =
				'Could not load habits. Stored data has not been changed. Reload to try again.';
			update({ error });
			return failure(error);
		} finally {
			locked.current = false;
			update({ loading: false });
		}
	}

	async function mutate(change) {
		if (!mounted.current) return failure('Habit data is not mounted.');
		if (locked.current) return failure('A habit operation is already in progress.');
		if (!writable.current) return failure('Load habits successfully before making changes.');
		// Ref locks are synchronous, including calls made before React renders again.
		locked.current = true;
		update({ saving: true, error: null });
		try {
			let data;
			try {
				data = change(current.current.data);
			} catch (cause) {
				const error =
					typeof cause?.message === 'string' ? cause.message : 'Invalid habit change.';
				update({ error });
				return failure(error);
			}
			await storageRef.current.saveHabitData(data);
			update({ data });
			return { success: true };
		} catch {
			const error =
				'Could not save habits on this device. Your previous data is kept. Try again.';
			update({ error });
			return failure(error);
		} finally {
			locked.current = false;
			update({ saving: false });
		}
	}

	useEffect(() => {
		mounted.current = true;
		setState(current.current);
		void reload();
		return () => {
			mounted.current = false;
		};
	}, []);

	return {
		...state,
		reload,
		saveHabit: (habit) => mutate((data) => upsertHabit(data, habit)),
		removeHabit: (id) => mutate((data) => deleteHabit(data, id)),
		toggleDate: (id, date, now) => mutate((data) => toggleHabitDate(data, id, date, now)),
	};
}

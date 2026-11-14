export function useHabits(session) {
	async function run(action, ...args) {
		try {
			return (await action(...args))
				? { success: true }
				: {
						success: false,
						error: 'Habits are busy or blocked. Check Google Drive status.',
					};
		} catch {
			return {
				success: false,
				error: 'Could not save habits. Your previous data is kept. Check your input and try again.',
			};
		}
	}

	return {
		data: session.data?.habits ?? null,
		loading: session.loading,
		saving: session.saving || !!session.conflict || !!session.loadError,
		error: session.loadError,
		account: session.account,
		dirty: session.dirty,
		lastSyncedAt: session.lastSyncedAt,
		syncError: session.syncError,
		reload: session.reload,
		saveHabit: (...args) => run(session.saveHabit, ...args),
		removeHabit: (...args) => run(session.removeHabit, ...args),
		toggleDate: (...args) => run(session.toggleDate, ...args),
	};
}

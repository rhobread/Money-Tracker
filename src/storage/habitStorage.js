import AsyncStorage from '@react-native-async-storage/async-storage';
import { createEmptyHabitData, validateHabitData } from '../utils/habits';

// Device-only. This key is intentionally separate from all money/Google sync data.
const STORAGE_KEY = '@personal-tracker/habits';

export async function loadHabitData(storage = AsyncStorage) {
	const stored = await storage.getItem(STORAGE_KEY);
	return stored === null ? createEmptyHabitData() : validateHabitData(JSON.parse(stored));
}

export async function saveHabitData(data, storage = AsyncStorage) {
	await storage.setItem(STORAGE_KEY, JSON.stringify(validateHabitData(data)));
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import { validateTrackersData } from '../utils/trackers';

const STORAGE_KEY = '@money-tracker/trackers';

export const initialTrackersData = { version: 1, items: [] };

export async function loadTrackers() {
	const stored = await AsyncStorage.getItem(STORAGE_KEY);
	return stored === null ? { version: 1, items: [] } : validateTrackersData(JSON.parse(stored));
}

export async function saveTrackers(data) {
	await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(validateTrackersData(data)));
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadMoneyData } from './moneyStorage';
import { loadHabitData } from './habitStorage';
import { validateAppData } from '../utils/appData';

const STORAGE_KEY = '@rho-tracker/data';

export async function loadAppData() {
	const stored = await AsyncStorage.getItem(STORAGE_KEY);
	if (stored !== null) return validateAppData(JSON.parse(stored));
	const [money, habits] = await Promise.all([loadMoneyData(), loadHabitData()]);
	return validateAppData({ ...money, version: 2, habits });
}

export async function saveAppData(data) {
	await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(validateAppData(data)));
}

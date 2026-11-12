import AsyncStorage from '@react-native-async-storage/async-storage';
import { validateFinanceData } from '../utils/finance';

const STORAGE_KEY = '@money-tracker/data';

export async function loadMoneyData() {
	const stored = await AsyncStorage.getItem(STORAGE_KEY);
	if (stored !== null) return validateFinanceData(JSON.parse(stored));
	const [wallet, trackers] = await Promise.all([
		AsyncStorage.getItem('@money-tracker/wallet'),
		AsyncStorage.getItem('@money-tracker/trackers'),
	]);
	return validateFinanceData({
		version: 1,
		wallet:
			wallet === null
				? { version: 3, currency: 'IDR', sources: [], updatedAt: null }
				: JSON.parse(wallet),
		trackers: trackers === null ? { version: 2, items: [] } : JSON.parse(trackers),
	});
}

export async function saveMoneyData(data) {
	await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(validateFinanceData(data)));
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import { validateWallet } from '../utils/money';

const STORAGE_KEY = '@money-tracker/wallet';

export const initialWallet = {
  version: 3,
  sources: [],
  currency: 'IDR',
  updatedAt: null,
};

export async function loadWallet() {
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  return stored === null ? { ...initialWallet } : validateWallet(JSON.parse(stored));
}

export async function saveWallet(wallet) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(validateWallet(wallet)));
}

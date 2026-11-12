import AsyncStorage from '@react-native-async-storage/async-storage';
import { accountId, profile, record } from '../services/cloudModel';

const ACTIVE_KEY = '@money-tracker/active-account';
const accountKey = (id) => `@money-tracker/account/${encodeURIComponent(accountId(id))}`;

export async function loadActiveAccount() {
	const raw = await AsyncStorage.getItem(ACTIVE_KEY);
	const value = raw === null ? null : JSON.parse(raw);
	return value === null ? null : profile(value);
}

export async function saveActiveAccount(value) {
	await AsyncStorage.setItem(ACTIVE_KEY, JSON.stringify(value === null ? null : profile(value)));
}

export async function loadAccountData(id) {
	const raw = await AsyncStorage.getItem(accountKey(id));
	return raw === null ? null : record(JSON.parse(raw), id);
}

export async function saveAccountData(id, value) {
	const key = accountKey(id);
	await AsyncStorage.setItem(key, JSON.stringify(record(value, id)));
}

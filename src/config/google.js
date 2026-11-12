import Constants from 'expo-constants';
import { Platform } from 'react-native';

export function getGoogleConfiguration() {
	return {
		webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim() ?? '',
		iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim() ?? '',
		platform: Platform.OS,
		expoGo: Constants.executionEnvironment === 'storeClient',
	};
}

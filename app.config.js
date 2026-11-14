module.exports = ({ config }) => {
	const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim();
	if (iosClientId && !/^\d+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(iosClientId)) {
		throw new Error('EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID must be an iOS OAuth client ID.');
	}
	return {
		...config,
		name: 'Personal Tracker',
		scheme: 'moneytracker',
		ios: { ...config.ios, bundleIdentifier: 'com.moneytracker.app' },
		plugins: [
			...(config.plugins ?? []),
			'expo-dev-client',
			// Android with an explicit Web client ID uses native autolinking, not Firebase.
			...(iosClientId
				? [
						[
							'react-native-nitro-google-signin',
							{ iosUrlScheme: iosClientId.split('.').reverse().join('.') },
						],
					]
				: []),
		],
	};
};

const { profile } = require('./cloudModel');

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const CLIENT_ID = /^\d+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/;
class GoogleAuthError extends Error {}

function getGoogleAvailability(configuration) {
	if (!['android', 'ios'].includes(configuration.platform)) {
		return {
			available: false,
			reason: 'Google sign-in is available in the Android or iOS app.',
		};
	}
	if (configuration.expoGo) {
		return {
			available: false,
			reason: 'Google sign-in needs a development build or APK, not Expo Go. Device-only tracking still works here.',
		};
	}
	if (
		!CLIENT_ID.test(configuration.webClientId) ||
		(configuration.platform === 'ios' && !CLIENT_ID.test(configuration.iosClientId))
	) {
		return {
			available: false,
			reason: 'Google sign-in needs your Google OAuth client IDs. Follow the Google setup section in README.md, then rebuild the app.',
		};
	}
	return { available: true, reason: null };
}

function authError(code, message) {
	return Object.assign(new GoogleAuthError(message), { code });
}

function accessTokenValue(tokens) {
	const token = tokens?.accessToken;
	if (typeof token !== 'string' || !/^[A-Za-z0-9._~+/-]+=*$/.test(token) || token.length > 8192) {
		throw authError('auth', 'Google did not provide a valid access token.');
	}
	return token;
}

function createGoogleAuth({
	configuration,
	loadNative = () => require('react-native-nitro-google-signin').GoogleOneTapSignIn,
	fetch: fetchImpl = globalThis.fetch,
}) {
	let sdk;
	function native() {
		const availability = getGoogleAvailability(configuration);
		if (!availability.available) throw authError('configuration', availability.reason);
		if (!sdk) {
			try {
				sdk = loadNative();
				sdk.configure({
					webClientId: configuration.webClientId,
					iosClientId: configuration.iosClientId || undefined,
					scopes: [DRIVE_SCOPE],
					offlineAccess: false,
				});
			} catch {
				sdk = null;
				throw authError('configuration', 'Google sign-in needs a new native app build.');
			}
		}
		return sdk;
	}

	async function identity(token) {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 15000);
		try {
			const response = await fetchImpl('https://openidconnect.googleapis.com/v1/userinfo', {
				headers: { Authorization: `Bearer ${token}` },
				signal: controller.signal,
			});
			if (response.status === 401) throw authError('auth', 'Google sign-in expired.');
			if (!response.ok) throw authError('network', 'Could not verify the Google account.');
			const user = await response.json();
			if (user.email_verified !== true)
				throw authError('auth', 'Google account email must be verified.');
			try {
				return profile({
					id: user.sub,
					email: user.email,
					name: typeof user.name === 'string' ? user.name : user.email,
				});
			} catch {
				throw authError('auth', 'Google returned an invalid account profile.');
			}
		} catch (error) {
			if (error instanceof GoogleAuthError) throw error;
			throw authError('network', 'Could not reach Google. Local data is unchanged.');
		} finally {
			clearTimeout(timeout);
		}
	}

	async function verifiedTokens() {
		const client = native();
		let token = accessTokenValue(await client.getTokens());
		try {
			return { token, user: await identity(token) };
		} catch (error) {
			if (error.code !== 'auth') throw error;
			await client.clearCachedAccessToken(token);
			token = accessTokenValue(await client.getTokens());
			return { token, user: await identity(token) };
		}
	}

	async function safe(action) {
		try {
			return await action();
		} catch (error) {
			if (error instanceof GoogleAuthError) throw error;
			const codes = {
				auth: 'auth',
				configuration: 'configuration',
				network: 'network',
				permission: 'permission',
				cancelled: 'cancelled',
				SIGN_IN_CANCELLED: 'cancelled',
				DEVELOPER_ERROR: 'configuration',
				SIGN_IN_REQUIRED: 'auth',
				PLAY_SERVICES_NOT_AVAILABLE: 'play-services',
			};
			throw authError(
				codes[error?.code] ?? 'auth',
				'Google sign-in could not complete. Check your account and app configuration.',
			);
		}
	}

	return {
		availability: () => getGoogleAvailability(configuration),
		signIn: () =>
			safe(async () => {
				const client = native();
				await client.checkPlayServices();
				const response = await client.presentExplicitSignIn();
				if (response.type === 'cancelled')
					throw authError('cancelled', 'Google sign-in was cancelled.');
				if (response.type !== 'success')
					throw authError('auth', 'Google sign-in did not complete.');
				await client.requestScopes([DRIVE_SCOPE]);
				return (await verifiedTokens()).user;
			}),
		accessToken: (expectedAccountId) =>
			safe(async () => {
				const client = native();
				if (!client.getCurrentUser()) {
					if (configuration.platform === 'ios') {
						// On iOS this restores Keychain credentials without opening a sign-in UI.
						const restored = await client.signIn();
						if (restored.type !== 'success')
							throw authError('auth', 'Sign in again to reconnect Google Drive.');
					} else {
						throw authError('auth', 'Sign in again to reconnect Google Drive.');
					}
				}
				const { token, user } = await verifiedTokens();
				if (user.id !== expectedAccountId)
					throw authError(
						'auth',
						'The Google account changed. Sign in again before syncing.',
					);
				return token;
			}),
		signOut: async () => {
			if (getGoogleAvailability(configuration).available) await native().signOut();
		},
	};
}

module.exports = { createGoogleAuth, getGoogleAvailability, DRIVE_SCOPE };

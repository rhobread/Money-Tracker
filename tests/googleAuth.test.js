const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { transformFileSync } = require('@babel/core');
const {
	createGoogleAuth,
	getGoogleAvailability,
	DRIVE_SCOPE,
} = require('../src/services/googleAuth');

const WEB_CLIENT_ID = '1234567890-test-web.apps.googleusercontent.com';
const IOS_CLIENT_ID = '1234567890-test-ios.apps.googleusercontent.com';
const configuration = {
	platform: 'android',
	expoGo: false,
	webClientId: WEB_CLIENT_ID,
	iosClientId: '',
};
const googleUser = {
	sub: 'trusted-google-sub',
	email: 'trusted@example.com',
	email_verified: true,
	name: 'Trusted Person',
};
const expectedProfile = {
	id: googleUser.sub,
	email: googleUser.email,
	name: googleUser.name,
};
const response = (status = 200, user = googleUser) => ({
	status,
	ok: status >= 200 && status < 300,
	json: async () => user,
});

function isolatedAuth() {
	const imports = [];
	const module = { exports: {} };
	const { code } = transformFileSync(require.resolve('../src/services/googleAuth'), {
		babelrc: false,
		configFile: false,
	});
	vm.runInNewContext(code, {
		module,
		AbortController,
		setTimeout,
		clearTimeout,
		require(name) {
			imports.push(name);
			assert.equal(name, './cloudModel', 'No native SDK or persistence dependency may load');
			return require('../src/services/cloudModel');
		},
	});
	return { ...module.exports, imports };
}

function harness(options = {}) {
	const calls = [];
	const tokenResponses = [...(options.tokens ?? [{ accessToken: 'fake-access-token' }])];
	const replies = [...(options.replies ?? [response()])];
	const sdk = {
		configure(config) {
			calls.push(['configure', config]);
		},
		async checkPlayServices() {
			calls.push(['checkPlayServices']);
		},
		async presentExplicitSignIn() {
			calls.push(['presentExplicitSignIn']);
			return {
				type: 'success',
				data: {
					user: {
						id: 'untrusted-native-id',
						email: 'native@example.com',
						name: 'Native Claim',
					},
					idToken: 'private-id-token',
					serverAuthCode: 'private-server-code',
				},
			};
		},
		async requestScopes(scopes) {
			calls.push(['requestScopes', scopes]);
		},
		async getTokens() {
			calls.push(['getTokens']);
			assert.ok(tokenResponses.length, 'Unexpected token refresh');
			return tokenResponses.length > 1 ? tokenResponses.shift() : tokenResponses[0];
		},
		getCurrentUser() {
			calls.push(['getCurrentUser']);
			return { user: { id: 'untrusted-native-id' } };
		},
		async clearCachedAccessToken(token) {
			calls.push(['clearCachedAccessToken', token]);
		},
		async signOut() {
			calls.push(['signOut']);
		},
		...options.sdk,
	};
	const auth = (options.createGoogleAuth ?? createGoogleAuth)({
		configuration: { ...configuration, ...options.configuration },
		loadNative: () => {
			calls.push(['loadNative']);
			if (options.loadError) throw options.loadError;
			return sdk;
		},
		fetch: async (url, init) => {
			assert.equal(
				url,
				'https://openidconnect.googleapis.com/v1/userinfo',
				'Real requests are forbidden',
			);
			calls.push(['fetch', url, init]);
			assert.ok(replies.length, 'Unexpected userinfo request');
			const reply = replies.shift();
			if (reply instanceof Error) throw reply;
			return reply;
		},
	});
	return {
		auth,
		calls,
		sdk,
		count: (method) => calls.filter(([name]) => name === method).length,
	};
}

async function rejectsSafely(
	promise,
	code,
	forbidden = /private|fake-access-token|server-response|client-secret/,
) {
	await assert.rejects(promise, (error) => {
		assert.equal(error.code, code);
		assert.equal(typeof error.message, 'string');
		assert.ok(error.message.length > 0);
		assert.doesNotMatch(error.message, forbidden);
		assert.doesNotMatch(JSON.stringify(error), forbidden);
		return true;
	});
}

test('availability allows configured native Android/iOS but excludes Expo Go, unsupported platforms, and placeholders', () => {
	assert.deepEqual(getGoogleAvailability(configuration), { available: true, reason: null });
	assert.deepEqual(
		getGoogleAvailability({ ...configuration, platform: 'ios', iosClientId: IOS_CLIENT_ID }),
		{ available: true, reason: null },
	);
	for (const override of [
		{ expoGo: true },
		{ platform: 'web' },
		{ platform: 'windows' },
		{ webClientId: '' },
		{ webClientId: 'YOUR_WEB_CLIENT_ID' },
		{ webClientId: 'test.apps.googleusercontent.com' },
		{ platform: 'ios', iosClientId: '' },
		{ platform: 'ios', iosClientId: 'YOUR_IOS_CLIENT_ID' },
	]) {
		const availability = getGoogleAvailability({ ...configuration, ...override });
		assert.equal(availability.available, false, JSON.stringify(override));
		assert.equal(typeof availability.reason, 'string');
		assert.ok(availability.reason.length > 0);
	}
	assert.match(getGoogleAvailability({ ...configuration, expoGo: true }).reason, /Expo Go/);
});

test('module import and unavailable operations never load the native SDK or persistence modules', async () => {
	const isolated = isolatedAuth();
	assert.deepEqual(isolated.imports, ['./cloudModel']);
	for (const override of [
		{ expoGo: true },
		{ webClientId: '' },
		{ platform: 'ios' },
		{ platform: 'web' },
	]) {
		const auth = isolated.createGoogleAuth({
			configuration: { ...configuration, ...override },
			fetch: () => assert.fail('Unavailable auth must not make any request'),
		});
		assert.equal(auth.availability().available, false);
		await rejectsSafely(auth.signIn(), 'configuration');
		await rejectsSafely(auth.accessToken(googleUser.sub), 'configuration');
		await auth.signOut();
	}
	assert.deepEqual(isolated.imports, ['./cloudModel']);
});

test('native SDK is lazy, configured once, and explicit sign-in requests only Drive appdata beyond normal identity', async () => {
	const h = harness({ replies: [response(), response()] });
	assert.equal(h.calls.length, 0);
	assert.equal(h.auth.availability().available, true);
	assert.equal(h.calls.length, 0);
	assert.deepEqual(await h.auth.signIn(), expectedProfile);
	assert.deepEqual(
		h.calls.slice(0, 5).map(([name]) => name),
		['loadNative', 'configure', 'checkPlayServices', 'presentExplicitSignIn', 'requestScopes'],
	);
	const nativeConfig = h.calls.find(([name]) => name === 'configure')[1];
	assert.equal(nativeConfig.webClientId, WEB_CLIENT_ID);
	assert.equal(nativeConfig.offlineAccess, false);
	assert.equal(nativeConfig.iosClientId, undefined);
	const allowedScopes = new Set([
		DRIVE_SCOPE,
		'openid',
		'email',
		'profile',
		'https://www.googleapis.com/auth/userinfo.email',
		'https://www.googleapis.com/auth/userinfo.profile',
	]);
	assert.ok(nativeConfig.scopes.includes(DRIVE_SCOPE));
	assert.ok(nativeConfig.scopes.every((scope) => allowedScopes.has(scope)));
	assert.deepEqual(h.calls.find(([name]) => name === 'requestScopes')[1], [DRIVE_SCOPE]);
	assert.equal(DRIVE_SCOPE, 'https://www.googleapis.com/auth/drive.appdata');
	assert.equal(await h.auth.accessToken(googleUser.sub), 'fake-access-token');
	assert.equal(h.count('loadNative'), 1);
	assert.equal(h.count('configure'), 1);
	assert.equal(h.count('presentExplicitSignIn'), 1, 'Token access must not present sign-in UI');
	await h.auth.signOut();
	assert.equal(h.count('signOut'), 1);
});

test('iOS passes the configured native client ID without a client secret or offline/server-code request', async () => {
	const h = harness({
		configuration: {
			platform: 'ios',
			iosClientId: IOS_CLIENT_ID,
			clientSecret: 'client-secret',
		},
	});
	await h.auth.signIn();
	const nativeConfig = h.calls.find(([name]) => name === 'configure')[1];
	assert.equal(nativeConfig.iosClientId, IOS_CLIENT_ID);
	assert.equal(nativeConfig.offlineAccess, false);
	assert.deepEqual(Object.keys(nativeConfig).sort(), [
		'iosClientId',
		'offlineAccess',
		'scopes',
		'webClientId',
	]);
	assert.doesNotMatch(JSON.stringify(h.calls), /client-secret/);
});

test('userinfo Google sub is authoritative, native claimed profile is ignored, and tokens are not exposed as profile/state', async () => {
	const isolated = isolatedAuth();
	const h = harness({
		createGoogleAuth: isolated.createGoogleAuth,
		tokens: [
			{
				accessToken: 'fake-access-token',
				idToken: 'private-id-token',
				refreshToken: 'private-refresh-token',
			},
		],
	});
	const profile = await h.auth.signIn();
	assert.deepEqual(profile, expectedProfile);
	assert.deepEqual(Object.keys(profile).sort(), ['email', 'id', 'name']);
	assert.doesNotMatch(JSON.stringify(profile), /token|native|server-code/);
	assert.doesNotMatch(JSON.stringify(h.auth), /token|server-code/);
	const [, url, request] = h.calls.find(([name]) => name === 'fetch');
	assert.equal(url, 'https://openidconnect.googleapis.com/v1/userinfo');
	assert.equal(request.headers.Authorization, 'Bearer fake-access-token');
	assert.deepEqual(Object.keys(request.headers), ['Authorization']);
	assert.ok(request.signal instanceof AbortSignal);
	assert.equal(request.body, undefined);
	await h.auth.signOut();
	assert.deepEqual(
		isolated.imports,
		['./cloudModel'],
		'Sign-in, token verification, and sign-out must not import storage',
	);
});

test('identity without a display name uses the verified email', async () => {
	const h = harness({ replies: [response(200, { ...googleUser, name: undefined })] });
	assert.deepEqual(await h.auth.signIn(), { ...expectedProfile, name: googleUser.email });
});

test('accessToken verifies the current Google sub every time and refuses an account switch', async () => {
	const h = harness({
		replies: [response(), response(200, { ...googleUser, sub: 'different-google-sub' })],
	});
	assert.equal(await h.auth.accessToken(googleUser.sub), 'fake-access-token');
	await rejectsSafely(h.auth.accessToken(googleUser.sub), 'auth');
	assert.equal(h.count('fetch'), 2);
	assert.equal(h.count('getCurrentUser'), 2);
	assert.equal(h.count('presentExplicitSignIn'), 0);
});

test('a missing native session requires sign-in without fetching or returning a token', async () => {
	const h = harness({ sdk: { getCurrentUser: () => null } });
	await rejectsSafely(h.auth.accessToken(googleUser.sub), 'auth');
	assert.equal(h.count('getTokens'), 0);
	assert.equal(h.count('fetch'), 0);
});

test('verified Google email is mandatory even when the native SDK claims a valid account', async () => {
	for (const email_verified of [false, undefined, 'true', 1]) {
		const invalid = response(200, { ...googleUser, email_verified });
		const h = harness({ replies: [invalid, invalid] });
		await rejectsSafely(h.auth.signIn(), 'auth');
		assert.ok(h.count('fetch') <= 2, 'Invalid identity must never refresh indefinitely');
	}
});

test('invalid Google sub/email profiles cannot activate an account', async () => {
	for (const override of [
		{ sub: undefined },
		{ sub: '' },
		{ sub: 'invalid sub' },
		{ email: '' },
		{ email: undefined },
	]) {
		const invalid = response(200, { ...googleUser, ...override });
		const h = harness({ replies: [invalid, invalid] });
		await rejectsSafely(h.auth.signIn(), 'auth');
	}
});

test('expired userinfo access token is cleared and refreshed exactly once', async () => {
	const h = harness({
		tokens: [{ accessToken: 'expired-token' }, { accessToken: 'refreshed-token' }],
		replies: [response(401), response()],
	});
	assert.equal(await h.auth.accessToken(googleUser.sub), 'refreshed-token');
	assert.equal(h.count('getTokens'), 2);
	assert.equal(h.count('clearCachedAccessToken'), 1);
	assert.deepEqual(
		h.calls.find(([name]) => name === 'clearCachedAccessToken'),
		['clearCachedAccessToken', 'expired-token'],
	);
	assert.deepEqual(
		h.calls
			.filter(([name]) => name === 'fetch')
			.map(([, , request]) => request.headers.Authorization),
		['Bearer expired-token', 'Bearer refreshed-token'],
	);
});

test('refresh cannot bypass account matching or repeatedly retry an expired token', async () => {
	const switched = harness({
		tokens: [{ accessToken: 'expired-token' }, { accessToken: 'other-account-token' }],
		replies: [response(401), response(200, { ...googleUser, sub: 'different-google-sub' })],
	});
	await rejectsSafely(switched.auth.accessToken(googleUser.sub), 'auth');
	const expired = harness({ replies: [response(401), response(401)] });
	await rejectsSafely(expired.auth.signIn(), 'auth');
	assert.equal(expired.count('clearCachedAccessToken'), 1);
	assert.equal(expired.count('getTokens'), 2);
	assert.equal(expired.count('fetch'), 2);
});

test('missing and non-string tokens are rejected before userinfo; missing refreshed token stops retry', async () => {
	for (const accessToken of [undefined, null, '', 42, { token: 'fake-access-token' }]) {
		const h = harness({ tokens: [{ accessToken }] });
		await rejectsSafely(h.auth.signIn(), 'auth');
		assert.equal(h.count('fetch'), 0);
	}
	const h = harness({ tokens: [{ accessToken: 'expired-token' }, {}], replies: [response(401)] });
	await rejectsSafely(h.auth.signIn(), 'auth');
	assert.equal(h.count('fetch'), 1);
	assert.equal(h.count('clearCachedAccessToken'), 1);
});

test('malformed whitespace/control tokens are rejected instead of entering an Authorization header', async () => {
	for (const accessToken of ['   ', 'private-token\r\nInjected: secret', 'private-token\u0000']) {
		const h = harness({ tokens: [{ accessToken }] });
		await rejectsSafely(h.auth.accessToken(googleUser.sub), 'auth');
		assert.equal(h.count('fetch'), 0);
	}
});

test('userinfo server errors, invalid JSON, and network exceptions have sanitized messages and no retry', async () => {
	for (const reply of [
		response(500, { error: 'private-server-response fake-access-token' }),
		response(403, { error: 'private-server-response' }),
		{
			status: 200,
			ok: true,
			json: async () => {
				throw new Error('private-server-response fake-access-token');
			},
		},
		new Error('private-server-response fake-access-token'),
		Object.assign(new Error('private-server-response'), { name: 'AbortError' }),
	]) {
		const h = harness({ replies: [reply] });
		await rejectsSafely(h.auth.signIn(), 'network');
		assert.equal(h.count('fetch'), 1);
		assert.equal(h.count('clearCachedAccessToken'), 0);
	}
});

test('native cancellation and error codes map to stable sanitized application errors', async () => {
	for (const [nativeCode, code] of [
		['SIGN_IN_CANCELLED', 'cancelled'],
		['DEVELOPER_ERROR', 'configuration'],
		['SIGN_IN_REQUIRED', 'auth'],
		['PLAY_SERVICES_NOT_AVAILABLE', 'play-services'],
		['UNKNOWN_SDK_ERROR', 'auth'],
	]) {
		const h = harness({
			sdk: {
				presentExplicitSignIn: async () => {
					throw Object.assign(new Error('private-server-response fake-access-token'), {
						code: nativeCode,
					});
				},
			},
		});
		await rejectsSafely(h.auth.signIn(), code);
		assert.equal(h.count('requestScopes'), 0);
		assert.equal(h.count('fetch'), 0);
	}
	for (const [type, code] of [
		['cancelled', 'cancelled'],
		['noSavedCredentialFound', 'auth'],
	]) {
		const h = harness({ sdk: { presentExplicitSignIn: async () => ({ type }) } });
		await rejectsSafely(h.auth.signIn(), code);
		assert.equal(h.count('requestScopes'), 0);
		assert.equal(h.count('getTokens'), 0);
	}
});

test('native initialization failure is a sanitized configuration error without fetching', async () => {
	for (const options of [
		{ loadError: new Error('private-native-build-details') },
		{
			sdk: {
				configure() {
					throw new Error('private-client-secret');
				},
			},
		},
	]) {
		const h = harness(options);
		await rejectsSafely(h.auth.signIn(), 'configuration');
		assert.equal(h.count('fetch'), 0);
	}
});

test('external SDK errors cannot bypass sanitization by using an application error code', async () => {
	for (const code of ['auth', 'configuration', 'network', 'permission', 'cancelled']) {
		const h = harness({
			sdk: {
				getTokens: async () => {
					throw Object.assign(new Error('private-server-response fake-access-token'), {
						code,
					});
				},
			},
		});
		await rejectsSafely(h.auth.accessToken(googleUser.sub), code);
	}
});

test('fetch-thrown errors cannot expose raw server details by claiming a known error code', async () => {
	const h = harness({
		replies: [
			Object.assign(new Error('private-server-response fake-access-token'), {
				code: 'network',
			}),
		],
	});
	await rejectsSafely(h.auth.signIn(), 'network');
});

test('iOS cold-start access restores saved credentials silently before verifying the Google subject', async () => {
	let restores = 0;
	const h = harness({
		configuration: { platform: 'ios', iosClientId: IOS_CLIENT_ID },
		sdk: {
			getCurrentUser: () => null,
			signIn: async () => {
				restores++;
				return { type: 'success', data: { user: { id: 'untrusted-restored-id' } } };
			},
		},
	});
	assert.equal(await h.auth.accessToken(googleUser.sub), 'fake-access-token');
	assert.equal(restores, 1);
	assert.equal(h.count('presentExplicitSignIn'), 0);
	assert.equal(h.count('requestScopes'), 0);
	assert.equal(h.count('fetch'), 1);
});

test('iOS restored credentials cannot bypass expected-account verification', async () => {
	const h = harness({
		configuration: { platform: 'ios', iosClientId: IOS_CLIENT_ID },
		sdk: { getCurrentUser: () => null, signIn: async () => ({ type: 'success' }) },
	});
	await rejectsSafely(h.auth.accessToken('another-account'), 'auth');
	assert.equal(h.count('presentExplicitSignIn'), 0);
});

test('missing iOS saved credentials require explicit sign-in without starting a picker or API request', async () => {
	for (const type of ['noSavedCredentialFound', 'cancelled']) {
		const h = harness({
			configuration: { platform: 'ios', iosClientId: IOS_CLIENT_ID },
			sdk: { getCurrentUser: () => null, signIn: async () => ({ type }) },
		});
		await rejectsSafely(h.auth.accessToken(googleUser.sub), 'auth');
		assert.equal(h.count('fetch'), 0);
		assert.equal(h.count('getTokens'), 0);
		assert.equal(h.count('presentExplicitSignIn'), 0);
	}
});

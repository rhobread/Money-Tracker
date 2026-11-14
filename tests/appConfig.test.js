const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { transformFileSync } = require('@babel/core');
const baseConfig = require('../app.json').expo;

const IOS_CLIENT_ID = '1234567890-test-ios.apps.googleusercontent.com';
const plain = (value) => JSON.parse(JSON.stringify(value));

function configure(env = {}, config = baseConfig) {
	const module = { exports: {} };
	const { code } = transformFileSync(require.resolve('../app.config.js'), {
		babelrc: false,
		configFile: false,
	});
	vm.runInNewContext(code, { module, process: { env } });
	return module.exports({ config });
}

test('app config preserves app icons, Android package, existing plugins, and unrelated fields', () => {
	const original = plain(baseConfig);
	const config = configure();
	assert.equal(config.icon, './assets/icon.png');
	assert.deepEqual(plain(config.android), original.android);
	assert.equal(config.android.package, 'com.moneytracker.app');
	assert.deepEqual(plain(config.android.adaptiveIcon), original.android.adaptiveIcon);
	assert.equal(config.ios.supportsTablet, true);
	assert.equal(config.ios.bundleIdentifier, 'com.moneytracker.app');
	assert.equal(config.scheme, 'moneytracker');
	assert.equal(config.name, 'Rho Tracker');
	assert.deepEqual(plain(config.plugins), [...original.plugins, 'expo-dev-client']);
	for (const key of ['slug', 'version', 'orientation', 'userInterfaceStyle', 'backgroundColor']) {
		assert.equal(config[key], original[key]);
	}
	assert.deepEqual(baseConfig, original, 'Dynamic config must not mutate static config');
});

test('native iOS Google plugin is omitted without an iOS client, including Android-only configuration', () => {
	for (const env of [
		{},
		{ EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: '' },
		{ EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: '   ' },
		{ EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: '1234567890-web.apps.googleusercontent.com' },
	]) {
		const config = configure(env);
		assert.deepEqual(plain(config.plugins), ['expo-font', 'expo-dev-client']);
	}
});

test('real-shaped iOS client adds only its native plugin with the reversed URL scheme', () => {
	const config = configure({ EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: `  ${IOS_CLIENT_ID}  ` });
	assert.deepEqual(plain(config.plugins), [
		'expo-font',
		'expo-dev-client',
		[
			'react-native-nitro-google-signin',
			{ iosUrlScheme: 'com.googleusercontent.apps.1234567890-test-ios' },
		],
	]);
	assert.equal(config.icon, baseConfig.icon);
	assert.deepEqual(plain(config.android), baseConfig.android);
	assert.equal(config.ios.supportsTablet, true);
	assert.doesNotMatch(
		JSON.stringify(config),
		/clientSecret|client_secret|refreshToken|accessToken/,
	);
});

test('placeholder/malformed iOS clients fail instead of enabling a broken native plugin', () => {
	for (const value of [
		'YOUR_IOS_CLIENT_ID',
		'client-secret',
		'abc.apps.googleusercontent.com',
		'123-abc.apps.googleusercontent.com.evil',
		'123 abc.apps.googleusercontent.com',
	]) {
		assert.throws(
			() => configure({ EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: value }),
			/must be an iOS OAuth client ID/,
		);
	}
});

test('dynamic config preserves custom plugin options and handles a config without plugins or iOS fields', () => {
	const custom = {
		...baseConfig,
		ios: {
			supportsTablet: true,
			icon: './custom-ios-icon.png',
			infoPlist: { CFBundleDisplayName: 'Custom' },
		},
		plugins: [['expo-font', { fonts: ['./custom-font.ttf'] }]],
		extra: { custom: true },
	};
	const original = plain(custom);
	const configured = configure({}, custom);
	assert.deepEqual(plain(configured.plugins[0]), original.plugins[0]);
	assert.equal(configured.ios.icon, custom.ios.icon);
	assert.deepEqual(plain(configured.ios.infoPlist), custom.ios.infoPlist);
	assert.deepEqual(plain(configured.extra), custom.extra);
	assert.deepEqual(custom, original);
	const minimal = configure({}, { name: 'Minimal' });
	assert.deepEqual(plain(minimal.plugins), ['expo-dev-client']);
	assert.equal(minimal.ios.bundleIdentifier, 'com.moneytracker.app');
});

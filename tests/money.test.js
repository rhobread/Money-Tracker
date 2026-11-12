const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
	parseAmount,
	formatMoney,
	validateWallet,
	validateSource,
	totalMinor,
} = require('../src/utils/money');

test('IDR amounts are parsed as exact integer hundredths', () => {
	assert.equal(parseAmount('1250.50'), 125050);
	assert.equal(parseAmount('0.29'), 29);
	assert.equal(parseAmount(' 42 '), 4200);
	assert.equal(parseAmount('-10.05'), -1005);
	assert.equal(parseAmount('-0'), 0);
	assert.equal(parseAmount('1.2'), 120);
	assert.equal(parseAmount('12,34'), 1234);
});

test('rejects invalid, ambiguous, and out-of-range amounts', () => {
	for (const input of [
		'',
		'1,000',
		'1.234',
		'NaN',
		'Infinity',
		'1e5',
		'10 dollars',
		'10000000000',
	]) {
		assert.throws(() => parseAmount(input));
	}
});

test('stored wallet survives JSON serialization', () => {
	const wallet = {
		version: 3,
		sources: [{ id: 'a', name: 'Bank A', amountMinor: 12345 }],
		currency: 'IDR',
		updatedAt: new Date().toISOString(),
	};
	assert.deepEqual(validateWallet(JSON.parse(JSON.stringify(wallet))), wallet);
	assert.equal(validateWallet({ ...wallet, updatedAt: null }).updatedAt, null);
});

test('rejects corrupt or unsupported saved data', () => {
	const wallet = { version: 2, balanceMinor: 0, currency: 'IDR', updatedAt: null };
	for (const bad of [
		null,
		{},
		{ ...wallet, version: 3 },
		{ ...wallet, version: 1 },
		{ ...wallet, balanceMinor: 1.1 },
		{ ...wallet, currency: 'USD' },
		{ ...wallet, currency: 'XXX' },
		{ ...wallet, updatedAt: 'bad' },
		{ ...wallet, balanceMinor: 1e14 },
	]) {
		assert.throws(() => validateWallet(bad));
	}
});

test('formats only IDR with Indonesian separators and two decimal places', () => {
	assert.equal(formatMoney(125050).replace(/\s/g, ' '), 'Rp 1.250,50');
	assert.equal(formatMoney(0).replace(/\s/g, ' '), 'Rp 0,00');
	assert.equal(formatMoney(-12345).replace(/\s/g, ' '), '-Rp 123,45');
});

test('migrates every shipped version 1 currency without conversion or data loss', () => {
	for (const currency of ['USD', 'EUR', 'GBP', 'PHP', 'INR', 'CAD', 'AUD']) {
		for (const balanceMinor of [0, 29, -12345, 999999999999, -999999999999]) {
			for (const updatedAt of [null, '2026-11-11T08:00:00.000Z']) {
				const wallet = { version: 1, balanceMinor, currency, updatedAt };
				const migrated = validateWallet(wallet);
				assert.deepEqual(migrated, {
					version: 3,
					currency: 'IDR',
					updatedAt,
					sources: [
						{ id: 'legacy-balance', name: 'My money', amountMinor: balanceMinor },
					],
				});
				assert.equal(wallet.currency, currency);
				assert.equal(wallet.version, 1);
				assert.deepEqual(validateWallet(JSON.parse(JSON.stringify(migrated))), migrated);
			}
		}
	}
});

test('migrates v2 balances exactly, including zero, fractions, negatives and limits', () => {
	for (const balanceMinor of [0, 29, -12345, 999999999999, -999999999999]) {
		const old = { version: 2, currency: 'IDR', balanceMinor, updatedAt: null };
		const migrated = validateWallet(old);
		assert.equal(totalMinor(migrated.sources), balanceMinor);
		assert.equal(migrated.sources[0].name, 'My money');
		assert.equal(old.version, 2);
		assert.deepEqual(validateWallet(migrated), migrated);
	}
});

test('source names and amounts are validated', () => {
	assert.deepEqual(validateSource({ name: ' Bank A ', amountMinor: 29 }), {
		name: 'Bank A',
		amountMinor: 29,
	});
	for (const name of ['', '   ', null, 12, 'a'.repeat(81)]) {
		assert.throws(() => validateSource({ name, amountMinor: 0 }));
	}
	for (const amountMinor of [NaN, Infinity, 0.1, '100', 1000000000000, -1000000000000]) {
		assert.throws(() => validateSource({ name: 'Bank', amountMinor }));
	}
});

test('total follows source additions, edits and deletions without floating point drift', () => {
	const sources = [{ amountMinor: parseAmount('1000') }, { amountMinor: parseAmount('2000') }];
	assert.equal(totalMinor(sources), 300000);
	sources[0].amountMinor = 29;
	assert.equal(totalMinor(sources), 200029);
	assert.equal(totalMinor(sources.slice(0, 1)), 29);
	assert.equal(totalMinor([]), 0);
	assert.equal(totalMinor([{ amountMinor: -29 }, { amountMinor: 30 }]), 1);
	assert.throws(() => totalMinor([{ amountMinor: Number.MAX_SAFE_INTEGER }, { amountMinor: 1 }]));
});

test('v3 rejects invalid sources, duplicate IDs, currency and timestamps', () => {
	const source = { id: 'a', name: 'Bank', amountMinor: 10 };
	const wallet = { version: 3, currency: 'IDR', sources: [source], updatedAt: null };
	for (const sources of [
		null,
		{},
		[null],
		[source, source],
		[{ ...source, id: '' }],
		[{ ...source, name: '' }],
		[{ ...source, amountMinor: 1.5 }],
	]) {
		assert.throws(() => validateWallet({ ...wallet, sources }));
	}
	assert.throws(() => validateWallet({ ...wallet, currency: 'USD' }));
	assert.throws(() => validateWallet({ ...wallet, updatedAt: undefined }));
	assert.throws(() => validateWallet({ ...wallet, updatedAt: 'invalid' }));
	assert.equal(totalMinor(validateWallet({ ...wallet, sources: [] }).sources), 0);
});

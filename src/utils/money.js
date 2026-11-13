// Store integer minor units, never floating-point currency values.
const LEGACY_CURRENCIES = ['USD', 'EUR', 'GBP', 'PHP', 'INR', 'CAD', 'AUD'];
const MAX_MINOR = 999999999999;

function parseAmount(value) {
	const normalized = value.trim().replace(',', '.');
	if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) {
		throw new Error('Enter a number with up to 2 decimal places after the comma.');
	}
	const negative = normalized.startsWith('-');
	const [whole, fraction = ''] = normalized.replace('-', '').split('.');
	const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
	if (!Number.isSafeInteger(minor) || minor > MAX_MINOR) {
		throw new Error('Please enter an amount smaller than 10 billion.');
	}
	return negative && minor !== 0 ? -minor : minor;
}

function formatMoney(minor) {
	return new Intl.NumberFormat('id-ID', {
		style: 'currency',
		currency: 'IDR',
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(minor / 100);
}

// Form state stays ungrouped; thousands dots are only shown by AmountInput.
function normalizeAmountInput(value, editing = false) {
	if (typeof value !== 'string') return null;
	let text = value.trim();
	if (!editing && /^-?\d*\.\d{1,2}$/.test(text)) text = text.replace('.', ',');
	if (!editing && text.includes('.') && !/^-?\d{1,3}(?:\.\d{3})+(,\d{0,2})?$/.test(text))
		return null;
	if (!/^-?[\d.]*(,\d{0,2})?$/.test(text)) return null;
	text = text.replace(/\./g, '');
	const negative = text.startsWith('-');
	const [whole, fraction] = (negative ? text.slice(1) : text).split(',');
	const integer = whole.replace(/^0+(?=\d)/, '') || (fraction !== undefined ? '0' : '');
	return `${negative ? '-' : ''}${integer}${fraction !== undefined ? `,${fraction}` : ''}`;
}

function formatAmountInput(value) {
	const [whole, fraction] = value.split(',');
	const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
	return `${grouped}${fraction !== undefined ? `,${fraction}` : ''}`;
}

function validateWallet(value) {
	if (value?.version === 3) {
		if (
			value.currency !== 'IDR' ||
			!Array.isArray(value.sources) ||
			!validTimestamp(value.updatedAt)
		)
			throw new Error('Saved money sources could not be read.');
		const ids = new Set();
		const sources = value.sources.map((source) => {
			if (
				!source ||
				typeof source.id !== 'string' ||
				!source.id.trim() ||
				ids.has(source.id)
			) {
				throw new Error('Invalid source ID.');
			}
			ids.add(source.id);
			return { id: source.id, ...validateSource(source) };
		});
		totalMinor(sources);
		return { version: 3, currency: 'IDR', sources, updatedAt: value.updatedAt };
	}
	if (
		!value ||
		!(
			(value.version === 1 && LEGACY_CURRENCIES.includes(value.currency)) ||
			(value.version === 2 && value.currency === 'IDR')
		) ||
		!Number.isSafeInteger(value.balanceMinor) ||
		Math.abs(value.balanceMinor) > MAX_MINOR ||
		(value.updatedAt !== null &&
			(typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))))
	) {
		throw new Error(
			'Saved balance data could not be read. Your stored data has not been changed.',
		);
	}
	// Relabel legacy balances without converting or rounding their numeric amount.
	return {
		version: 3,
		currency: 'IDR',
		updatedAt: value.updatedAt,
		sources: [{ id: 'legacy-balance', name: 'My money', amountMinor: value.balanceMinor }],
	};
}

function validTimestamp(value) {
	return value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
}

function validateSource(value) {
	if (typeof value?.name !== 'string' || !value.name.trim() || value.name.trim().length > 80) {
		throw new Error('Enter a name of 1 to 80 characters.');
	}
	if (!Number.isSafeInteger(value.amountMinor) || Math.abs(value.amountMinor) > MAX_MINOR) {
		throw new Error('Enter an amount smaller than 10 billion.');
	}
	return { name: value.name.trim(), amountMinor: value.amountMinor };
}

function totalMinor(sources) {
	// BigInt keeps cancellation exact and detects totals beyond safe integer storage.
	const total = sources.reduce((sum, source) => sum + BigInt(source.amountMinor), 0n);
	if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < BigInt(Number.MIN_SAFE_INTEGER)) {
		throw new Error('The total amount is too large.');
	}
	return Number(total);
}

module.exports = {
	parseAmount,
	formatMoney,
	normalizeAmountInput,
	formatAmountInput,
	validateWallet,
	validateSource,
	totalMinor,
};

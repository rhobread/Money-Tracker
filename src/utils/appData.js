const finance = require('./finance');
const habits = require('./habits');

function validateAppData(value) {
	if (!value || ![1, 2].includes(value.version))
		throw new Error('Unsupported tracker data version. Update the app before loading it.');
	if (value.version === 1 && value.habits !== undefined)
		throw new Error('Habit data requires tracker data version 2.');
	const money = finance.validateFinanceData({ ...value, version: 1 });
	return {
		...money,
		version: 2,
		habits:
			value.version === 1
				? habits.createEmptyHabitData()
				: habits.validateHabitData(value.habits),
	};
}

function changeFinance(data, action, ...args) {
	const current = validateAppData(data);
	const money = action({ ...current, version: 1 }, ...args);
	return validateAppData({ ...money, version: 2, habits: current.habits });
}

function changeHabits(data, action, ...args) {
	const current = validateAppData(data);
	return validateAppData({ ...current, habits: action(current.habits, ...args) });
}

module.exports = { validateAppData, changeFinance, changeHabits };

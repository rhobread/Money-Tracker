import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { TrackerField, TrackerForm, trackerFormStyles as styles } from './TrackerForm';
import { parseAmount } from '../utils/money';
import { FREQUENCIES, todayDate, validateTracker } from '../utils/trackers';
import { MoneySourcePicker } from './MoneySourcePicker';
import { AmountInput } from './AmountInput';

export function TrackerEditor({ tracker, kind, sources, saving, onSave, onClose }) {
	const [name, setName] = useState(tracker?.name ?? '');
	const [amount, setAmount] = useState(
		tracker ? (tracker.amountMinor / 100).toFixed(2).replace('.', ',') : '',
	);
	const [frequency, setFrequency] = useState(tracker?.frequency ?? 'monthly');
	const [startDate, setStartDate] = useState(tracker?.startDate ?? todayDate());
	const [defaultSourceId, setDefaultSourceId] = useState(tracker?.defaultSourceId ?? null);

	async function submit() {
		const next = validateTracker({
			id: tracker?.id ?? 'new',
			kind,
			name,
			amountMinor: parseAmount(amount),
			frequency,
			startDate,
			defaultSourceId,
			entries: tracker?.entries ?? {},
		});
		return onSave(next);
	}

	return (
		<TrackerForm
			title={tracker ? 'Edit item' : kind === 'income' ? 'Add income' : 'Add payment'}
			saving={saving}
			onClose={onClose}
			onSave={submit}
		>
			<TrackerField
				label="Name"
				value={name}
				onChangeText={setName}
				editable={!saving}
				maxLength={80}
				placeholder={kind === 'income' ? 'Kontrakan Fatra' : 'Electricity'}
			/>
			<TrackerField
				label="Amount (IDR)"
				inputComponent={AmountInput}
				value={amount}
				onChangeText={setAmount}
				editable={!saving}
				keyboardType="decimal-pad"
				maxLength={20}
				placeholder="1.000.000"
				hint="Thousands dots are automatic. Use a comma for decimals."
			/>
			<MoneySourcePicker
				sources={sources}
				value={defaultSourceId}
				onChange={setDefaultSourceId}
				disabled={saving}
				label="Default money source"
			/>
			<Text style={styles.hint}>
				{kind === 'income'
					? 'Paid income adds money to this source.'
					: 'Paid payments subtract money from this source.'}{' '}
				You can choose a different source for each entry.
			</Text>
			<Text style={styles.label}>Repeat</Text>
			<View style={styles.choices}>
				{FREQUENCIES.map((value) => (
					<Pressable
						key={value}
						accessibilityRole="button"
						accessibilityState={{ selected: value === frequency }}
						disabled={saving}
						onPress={() => setFrequency(value)}
						style={[styles.choice, value === frequency && styles.selected]}
					>
						<Text
							style={[styles.choiceText, value === frequency && styles.selectedText]}
						>
							{value}
						</Text>
					</Pressable>
				))}
			</View>
			<TrackerField
				label="First due date"
				value={startDate}
				onChangeText={setStartDate}
				editable={!saving}
				maxLength={10}
				placeholder="2026-11-01"
				autoCapitalize="none"
				autoCorrect={false}
				hint="YYYY-MM-DD. Repeats from this date, on the same weekday or day of the month."
			/>
			{tracker && (
				<Text style={styles.hint}>
					Changes apply to entries you haven't edited. Saved entries and paid dates are
					kept. Paid entries keep the money source used when they were paid.
				</Text>
			)}
		</TrackerForm>
	);
}

import { useState } from 'react';
import { Text } from 'react-native';
import {
	PaidCheckbox,
	TrackerField,
	TrackerForm,
	trackerFormStyles as styles,
} from './TrackerForm';
import { parseAmount } from '../utils/money';
import { formatDate, todayDate } from '../utils/trackers';

export function OccurrenceEditor({ occurrence, saving, onSave, onClose }) {
	const [amount, setAmount] = useState(
		(occurrence.amountMinor / 100).toFixed(2).replace('.', ','),
	);
	const [dueDate, setDueDate] = useState(occurrence.dueDate);
	const [paid, setPaid] = useState(occurrence.paid);
	const [paidDate, setPaidDate] = useState(occurrence.paidDate ?? todayDate());

	async function submit() {
		return onSave({
			amountMinor: parseAmount(amount),
			dueDate,
			paid,
			paidDate: paid ? paidDate : null,
		});
	}

	return (
		<TrackerForm title="Edit entry" saving={saving} onClose={onClose} onSave={submit}>
			<Text style={styles.hint}>
				Scheduled for {formatDate(occurrence.scheduledDate)}. These changes affect this
				entry only.
			</Text>
			<TrackerField
				label="Amount (IDR)"
				value={amount}
				onChangeText={setAmount}
				editable={!saving}
				keyboardType="decimal-pad"
				maxLength={20}
				hint="No thousands separators."
			/>
			<TrackerField
				label="Due date"
				value={dueDate}
				onChangeText={setDueDate}
				editable={!saving}
				maxLength={10}
				autoCapitalize="none"
				autoCorrect={false}
				hint="YYYY-MM-DD"
			/>
			<PaidCheckbox
				paid={paid}
				disabled={saving}
				onPress={() => setPaid((value) => !value)}
			/>
			{paid && (
				<TrackerField
					label="Paid date"
					value={paidDate}
					onChangeText={setPaidDate}
					editable={!saving}
					maxLength={10}
					autoCapitalize="none"
					autoCorrect={false}
					hint="YYYY-MM-DD"
				/>
			)}
		</TrackerForm>
	);
}

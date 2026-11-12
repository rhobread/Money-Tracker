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
import { MoneySourcePicker } from './MoneySourcePicker';

export function OccurrenceEditor({
	occurrence,
	sources,
	defaultSourceId,
	initialPaid,
	saving,
	onSave,
	onClose,
}) {
	const [amount, setAmount] = useState(
		(occurrence.amountMinor / 100).toFixed(2).replace('.', ','),
	);
	const [dueDate, setDueDate] = useState(occurrence.dueDate);
	const [paid, setPaid] = useState(initialPaid ?? occurrence.paid);
	const [paidDate, setPaidDate] = useState(occurrence.paidDate ?? todayDate());
	const [sourceId, setSourceId] = useState(occurrence.sourceId ?? null);
	const defaultSource = sources.find((source) => source.id === defaultSourceId);

	async function submit() {
		return onSave({
			amountMinor: parseAmount(amount),
			dueDate,
			paid,
			paidDate: paid ? paidDate : null,
			sourceId,
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
			<MoneySourcePicker
				sources={sources}
				value={sourceId}
				onChange={setSourceId}
				disabled={saving}
				emptyLabel={
					defaultSource ? `Use default (${defaultSource.name})` : 'No default selected'
				}
			/>
			<Text style={styles.hint}>
				Saving a paid entry updates the selected source. Changing its amount or source
				corrects the previous balance change.
			</Text>
			{occurrence.paid && occurrence.applied === null && (
				<Text style={styles.hint}>
					This older paid entry has not changed your balance. To include it, save it as
					unpaid first, then mark it paid again.
				</Text>
			)}
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

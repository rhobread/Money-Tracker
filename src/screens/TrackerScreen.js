import { useEffect, useRef, useState } from 'react';
import {
	Alert,
	BackHandler,
	FlatList,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PaidCheckbox } from '../components/TrackerForm';
import { TrackerEditor } from '../components/TrackerEditor';
import { OccurrenceEditor } from '../components/OccurrenceEditor';
import {
	createTrackerId,
	formatDate,
	occurrencesForYear,
	effectiveSourceId,
	todayDate,
} from '../utils/trackers';
import { formatMoney } from '../utils/money';
import { colors } from '../theme';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function TrackerScreen({
	kind,
	data,
	sources,
	saving,
	saveTracker: onSaveTracker,
	saveEntry: onSaveEntry,
	deleteTracker: onDeleteTracker,
	onBack,
}) {
	const [selectedId, setSelectedId] = useState(null);
	const [editor, setEditor] = useState(null);
	const [error, setError] = useState(null);
	const [year, setYear] = useState(new Date().getFullYear());
	const [month, setMonth] = useState(null);
	const acting = useRef(false);
	const selected = data?.items.find((item) => item.id === selectedId);
	const items = data?.items.filter((item) => item.kind === kind) ?? [];
	const title = kind === 'income' ? 'Source of Income' : 'Payments';
	const today = todayDate();
	const sourceName = (id) => sources.find((source) => source.id === id)?.name ?? 'Not selected';
	const occurrences = selected
		? occurrencesForYear(selected, year).filter(
				(entry) =>
					selected.frequency === 'yearly' ||
					month === null ||
					Number(entry.scheduledDate.slice(5, 7)) === month,
			)
		: [];

	function goBack() {
		if (saving || acting.current) return;
		setError(null);
		if (selectedId) setSelectedId(null);
		else onBack();
	}

	useEffect(() => {
		const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
			goBack();
			return true;
		});
		return () => subscription.remove();
	});

	async function saveTracker(value) {
		const next = { ...value, id: editor.tracker?.id ?? createTrackerId(data.items) };
		const saved = await onSaveTracker(next);
		if (saved) {
			setError(null);
			setSelectedId(next.id);
			if (!editor.tracker || next.startDate !== editor.tracker.startDate) {
				setYear(Number(next.startDate.slice(0, 4)));
				setMonth(
					['daily', 'weekly'].includes(next.frequency)
						? Number(next.startDate.slice(5, 7))
						: null,
				);
			}
		}
		return saved;
	}

	async function saveEntry(occurrence, entry) {
		const saved = await onSaveEntry(selected.id, occurrence.key, entry);
		if (saved) setError(null);
		return saved;
	}

	async function togglePaid(occurrence) {
		if (saving || acting.current) return;
		if (!occurrence.paid && !effectiveSourceId(selected, occurrence)) {
			setEditor({ occurrence, initialPaid: true });
			return;
		}
		acting.current = true;
		try {
			const saved = await saveEntry(occurrence, {
				dueDate: occurrence.dueDate,
				amountMinor: occurrence.amountMinor,
				paid: !occurrence.paid,
				paidDate: occurrence.paid ? null : todayDate(),
				sourceId: occurrence.sourceId,
			});
			if (!saved) setError('Could not update entry. Try again.');
		} catch (saveError) {
			setError(`Could not update entry. ${saveError.message || 'Try again.'}`);
		} finally {
			acting.current = false;
		}
	}

	function deleteTracker() {
		if (saving || acting.current) return;
		acting.current = true;
		Alert.alert(
			'Delete item?',
			`Delete "${selected.name}" and all its saved entries? Balance changes from its paid entries will also be reversed.`,
			[
				{
					text: 'Cancel',
					style: 'cancel',
					onPress: () => {
						acting.current = false;
					},
				},
				{
					text: 'Delete',
					style: 'destructive',
					onPress: async () => {
						try {
							if (await onDeleteTracker(selected.id)) {
								setSelectedId(null);
								setError(null);
							}
						} catch (saveError) {
							setError(`Could not delete item. ${saveError.message || 'Try again.'}`);
						} finally {
							acting.current = false;
						}
					},
				},
			],
			{ cancelable: false },
		);
	}

	function openItem(item) {
		setSelectedId(item.id);
		setError(null);
		setYear(Math.max(new Date().getFullYear(), Number(item.startDate.slice(0, 4))));
		const focusDate = item.startDate > today ? item.startDate : today;
		setMonth(
			['daily', 'weekly'].includes(item.frequency) ? Number(focusDate.slice(5, 7)) : null,
		);
	}

	const header = (
		<>
			<Pressable
				accessibilityRole="button"
				disabled={saving}
				onPress={goBack}
				style={styles.back}
			>
				<Text style={styles.link}>{selected ? `< ${title}` : '< Balance'}</Text>
			</Pressable>
			<Text style={styles.title}>{selected ? selected.name : title}</Text>
			{!selected && (
				<>
					<Text style={styles.body}>
						{kind === 'income'
							? 'Paid income adds to its money source.'
							: 'Paid payments subtract from their money source.'}
					</Text>
					<Pressable
						accessibilityRole="button"
						disabled={saving}
						onPress={() => setEditor({ tracker: null })}
						style={styles.button}
					>
						<Text style={styles.buttonText}>
							{kind === 'income' ? 'Add income' : 'Add payment'}
						</Text>
					</Pressable>
				</>
			)}
			{selected && (
				<>
					<Text style={styles.amount}>{formatMoney(selected.amountMinor)}</Text>
					<Text style={styles.frequency}>{selected.frequency}</Text>
					<Text style={styles.body}>First due: {formatDate(selected.startDate)}</Text>
					<Text style={styles.body}>
						Default money source: {sourceName(selected.defaultSourceId)}
					</Text>
					<View style={styles.actions}>
						<Pressable
							accessibilityRole="button"
							disabled={saving}
							onPress={() => setEditor({ tracker: selected })}
							style={styles.action}
						>
							<Text style={styles.link}>Edit item</Text>
						</Pressable>
						<Pressable
							accessibilityRole="button"
							disabled={saving}
							onPress={deleteTracker}
							style={styles.action}
						>
							<Text style={styles.error}>Delete item</Text>
						</Pressable>
					</View>
					<View style={styles.yearRow}>
						<Pressable
							accessibilityRole="button"
							accessibilityLabel="Previous year"
							disabled={year <= 1900 || saving}
							onPress={() => setYear((value) => value - 1)}
							style={styles.yearButton}
						>
							<Text style={styles.link}>Previous</Text>
						</Pressable>
						<Text accessibilityLiveRegion="polite" style={styles.year}>
							{year}
						</Text>
						<Pressable
							accessibilityRole="button"
							accessibilityLabel="Next year"
							disabled={year >= 9999 || saving}
							onPress={() => setYear((value) => value + 1)}
							style={styles.yearButton}
						>
							<Text style={styles.link}>Next</Text>
						</Pressable>
					</View>
					{selected.frequency !== 'yearly' && (
						<ScrollView
							horizontal
							showsHorizontalScrollIndicator={false}
							contentContainerStyle={styles.months}
						>
							{[null, ...MONTHS.map((_, index) => index + 1)].map((value) => (
								<Pressable
									key={value ?? 'all'}
									accessibilityRole="button"
									accessibilityState={{ selected: month === value }}
									disabled={saving}
									onPress={() => setMonth(value)}
									style={[
										styles.monthButton,
										month === value && styles.selectedMonth,
									]}
								>
									<Text
										style={[
											styles.monthText,
											month === value && styles.selectedMonthText,
										]}
									>
										{value === null ? 'All months' : MONTHS[value - 1]}
									</Text>
								</Pressable>
							))}
						</ScrollView>
					)}
					<Text style={styles.hint}>
						Tap Paid to use today's date. Edit an entry to change its due date, amount,
						paid date, or money source. Unchecking Paid reverses its balance change.
					</Text>
				</>
			)}
			{error && (
				<Text accessibilityRole="alert" style={styles.error}>
					{error}
				</Text>
			)}
		</>
	);

	function renderOccurrence({ item }) {
		const overdue = !item.paid && item.dueDate < today;
		return (
			<View style={styles.card}>
				<Text style={styles.entryAmount}>{formatMoney(item.amountMinor)}</Text>
				<Text style={styles.body}>Due: {formatDate(item.dueDate)}</Text>
				<Text style={styles.body}>
					Money source: {sourceName(effectiveSourceId(selected, item))}
				</Text>
				{item.dueDate !== item.scheduledDate && (
					<Text style={styles.hint}>Scheduled: {formatDate(item.scheduledDate)}</Text>
				)}
				{overdue && <Text style={styles.overdue}>Overdue</Text>}
				<View style={styles.entryActions}>
					<PaidCheckbox
						paid={item.paid}
						disabled={saving}
						accessibilityLabel={`Paid for ${selected.name}, scheduled ${formatDate(item.scheduledDate)}, ${formatMoney(item.amountMinor)}`}
						onPress={() => togglePaid(item)}
					/>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel={`Edit entry scheduled ${formatDate(item.scheduledDate)}`}
						disabled={saving}
						onPress={() => !acting.current && setEditor({ occurrence: item })}
						style={styles.action}
					>
						<Text style={styles.link}>Edit</Text>
					</Pressable>
				</View>
				{item.paid && <Text style={styles.body}>Paid: {formatDate(item.paidDate)}</Text>}
				{item.paid && item.applied === null && (
					<Text style={styles.hint}>
						Older paid entry. Not applied to your balance; uncheck and mark paid again
						to include it.
					</Text>
				)}
			</View>
		);
	}

	return (
		<SafeAreaView style={styles.safe}>
			<FlatList
				key={selected ? `entries-${selected.id}` : 'items'}
				contentContainerStyle={styles.content}
				data={selected ? occurrences : items}
				extraData={{ saving, year, month, today }}
				keyExtractor={(item) => (selected ? item.key : item.id)}
				ListHeaderComponent={header}
				ListEmptyComponent={
					<Text style={styles.empty}>
						{selected
							? 'No entries for this period.'
							: kind === 'income'
								? 'No income added yet.'
								: 'No payments added yet.'}
					</Text>
				}
				renderItem={
					selected
						? renderOccurrence
						: ({ item }) => (
								<Pressable
									accessibilityRole="button"
									accessibilityLabel={`Open ${item.name}`}
									disabled={saving}
									onPress={() => openItem(item)}
									style={({ pressed }) => [
										styles.card,
										pressed && styles.pressed,
									]}
								>
									<Text style={styles.itemName}>{item.name}</Text>
									<Text style={styles.entryAmount}>
										{formatMoney(item.amountMinor)}
									</Text>
									<Text style={styles.frequency}>{item.frequency}</Text>
									<Text style={styles.body}>
										Default: {sourceName(item.defaultSourceId)}
									</Text>
								</Pressable>
							)
				}
			/>
			{editor &&
				(editor.occurrence ? (
					<OccurrenceEditor
						occurrence={editor.occurrence}
						sources={sources}
						defaultSourceId={selected.defaultSourceId}
						initialPaid={editor.initialPaid}
						saving={saving}
						onSave={(value) => saveEntry(editor.occurrence, value)}
						onClose={() => setEditor(null)}
					/>
				) : (
					<TrackerEditor
						tracker={editor.tracker}
						kind={kind}
						sources={sources}
						saving={saving}
						onSave={saveTracker}
						onClose={() => setEditor(null)}
					/>
				))}
		</SafeAreaView>
	);
}

const styles = StyleSheet.create({
	safe: { flex: 1, backgroundColor: colors.background },
	content: { padding: 24, paddingBottom: 40, width: '100%', maxWidth: 560, alignSelf: 'center' },
	back: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', marginBottom: 12 },
	link: { color: colors.green, fontSize: 15, fontWeight: '600' },
	title: { color: colors.ink, fontSize: 28, fontWeight: '700', marginBottom: 16 },
	body: { color: colors.muted, fontSize: 14, lineHeight: 22 },
	hint: { color: colors.muted, fontSize: 12, lineHeight: 20, marginVertical: 8 },
	amount: { color: colors.ink, fontSize: 30, fontWeight: '600', marginBottom: 8 },
	frequency: {
		color: colors.muted,
		fontSize: 14,
		textTransform: 'capitalize',
		marginTop: 6,
		marginBottom: 8,
	},
	button: {
		backgroundColor: colors.green,
		minHeight: 56,
		padding: 16,
		borderRadius: 16,
		alignItems: 'center',
		justifyContent: 'center',
		marginTop: 20,
		marginBottom: 24,
	},
	buttonText: { color: colors.paper, fontSize: 16, fontWeight: '600' },
	card: {
		backgroundColor: colors.paper,
		padding: 18,
		borderWidth: 1,
		borderColor: colors.line,
		borderRadius: 16,
		marginBottom: 12,
	},
	itemName: { color: colors.ink, fontSize: 18, fontWeight: '600', marginBottom: 8 },
	entryAmount: {
		color: colors.ink,
		fontSize: 22,
		fontWeight: '600',
		marginBottom: 8,
		fontVariant: ['tabular-nums'],
	},
	entryActions: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		gap: 16,
	},
	actions: { flexDirection: 'row', gap: 24, marginVertical: 8 },
	action: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 4 },
	error: { color: colors.danger, fontSize: 14, lineHeight: 22, marginVertical: 8 },
	overdue: { color: colors.danger, fontWeight: '600', fontSize: 12, marginTop: 8 },
	yearRow: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		borderTopWidth: 1,
		borderBottomWidth: 1,
		borderColor: colors.line,
		paddingVertical: 8,
		marginTop: 16,
		gap: 8,
	},
	year: { color: colors.ink, fontSize: 22, fontWeight: '700' },
	yearButton: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 4 },
	months: { gap: 8, paddingVertical: 12 },
	monthButton: {
		borderWidth: 1,
		borderColor: colors.line,
		borderRadius: 10,
		paddingHorizontal: 14,
		minHeight: 44,
		justifyContent: 'center',
	},
	selectedMonth: { backgroundColor: colors.green, borderColor: colors.green },
	monthText: { color: colors.green, fontSize: 13, fontWeight: '600' },
	selectedMonthText: { color: colors.paper },
	empty: { color: colors.muted, fontSize: 14, marginVertical: 24 },
	pressed: { opacity: 0.75 },
});

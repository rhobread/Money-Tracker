import { useEffect, useState } from 'react';
import {
	ActivityIndicator,
	Alert,
	AppState,
	BackHandler,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { HabitEditor } from '../components/HabitEditor';
import { WEEKDAYS, habitDaysForWeek, shiftDate, weekStart } from '../utils/habits';
import { todayDate } from '../utils/trackers';
import { colors } from '../theme';

function displayDate(date) {
	return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
		month: 'short',
		day: 'numeric',
	});
}

export function HabitScreen({ habits, onBack }) {
	const [mode, setMode] = useState('weekly');
	const [anchor, setAnchor] = useState(todayDate());
	const [today, setToday] = useState(todayDate());
	const [editor, setEditor] = useState(null);
	const [actionError, setActionError] = useState(null);
	const { data, loading, saving, error, reload, saveHabit, removeHabit, toggleDate } = habits;

	useEffect(() => {
		const back = BackHandler.addEventListener('hardwareBackPress', () => {
			if (editor || saving) return true;
			onBack();
			return true;
		});
		const foreground = AppState.addEventListener('change', (state) => {
			if (state === 'active') setToday(todayDate());
		});
		const timer = setInterval(() => setToday(todayDate()), 60000);
		return () => {
			back.remove();
			foreground.remove();
			clearInterval(timer);
		};
	}, [editor, saving, onBack]);

	const start = weekStart(anchor);
	const end = shiftDate(start, 6);
	const items = data?.habits ?? [];
	const visible = items.filter((habit) => {
		const dates = habitDaysForWeek(habit, anchor);
		return mode === 'weekly' || dates.includes(anchor);
	});
	const currentPeriod = mode === 'weekly' ? start === weekStart(today) : anchor === today;

	async function toggle(habit, date) {
		setActionError(null);
		const result = await toggleDate(habit.id, date);
		if (!result.success) setActionError(result.error);
	}

	function confirmDelete(habit) {
		Alert.alert('Delete habit?', `Remove ${habit.name} and its check-ins?`, [
			{ text: 'Cancel', style: 'cancel' },
			{
				text: 'Delete',
				style: 'destructive',
				onPress: async () => {
					const result = await removeHabit(habit.id);
					if (!result.success) setActionError(result.error);
				},
			},
		]);
	}

	return (
		<SafeAreaView style={styles.safe}>
			<ScrollView contentContainerStyle={styles.content}>
				<Pressable
					accessibilityRole="button"
					disabled={saving}
					onPress={onBack}
					style={styles.back}
				>
					<Text style={styles.link}>{'< Personal Tracker'}</Text>
				</Pressable>
				<Text style={styles.title}>Habit Tracker</Text>
				<Text style={styles.intro}>Good habits to build. Bad habits to leave behind.</Text>
				<Text style={styles.storage}>
					Saved on this device. Google Drive sync is for Money only.
				</Text>
				{loading ? (
					<ActivityIndicator color={colors.green} size="large" />
				) : !data ? (
					<View style={styles.card}>
						<Text accessibilityRole="alert" style={styles.error}>
							{error || 'Could not load habits.'}
						</Text>
						<Pressable
							accessibilityRole="button"
							onPress={reload}
							style={styles.primary}
						>
							<Text style={styles.primaryText}>Try again</Text>
						</Pressable>
					</View>
				) : (
					<>
						<View style={styles.modes}>
							{['daily', 'weekly'].map((value) => (
								<Pressable
									key={value}
									accessibilityRole="tab"
									accessibilityState={{ selected: mode === value }}
									onPress={() => setMode(value)}
									style={[styles.mode, mode === value && styles.modeSelected]}
								>
									<Text
										style={[
											styles.modeText,
											mode === value && styles.modeTextSelected,
										]}
									>
										{value === 'daily' ? 'Daily' : 'Weekly'}
									</Text>
								</Pressable>
							))}
						</View>
						<View style={styles.period}>
							<Pressable
								accessibilityRole="button"
								accessibilityLabel={
									mode === 'weekly' ? 'Previous week' : 'Previous day'
								}
								onPress={() =>
									setAnchor(shiftDate(anchor, mode === 'weekly' ? -7 : -1))
								}
								style={styles.periodButton}
							>
								<Text style={styles.link}>{'<'}</Text>
							</Pressable>
							<View style={styles.periodLabel}>
								<Text style={styles.periodTitle}>
									{currentPeriod
										? mode === 'weekly'
											? 'This week'
											: 'Today'
										: mode === 'weekly'
											? 'Week'
											: 'Day'}
								</Text>
								<Text style={styles.body}>
									{mode === 'weekly'
										? `${displayDate(start)} - ${displayDate(end)}`
										: displayDate(anchor)}
								</Text>
								<Text style={styles.small}>
									{mode === 'weekly'
										? `${start.slice(0, 4)}${start.slice(0, 4) !== end.slice(0, 4) ? ` / ${end.slice(0, 4)}` : ''}`
										: anchor.slice(0, 4)}
								</Text>
							</View>
							<Pressable
								accessibilityRole="button"
								accessibilityLabel={mode === 'weekly' ? 'Next week' : 'Next day'}
								onPress={() =>
									setAnchor(shiftDate(anchor, mode === 'weekly' ? 7 : 1))
								}
								style={styles.periodButton}
							>
								<Text style={styles.link}>{'>'}</Text>
							</Pressable>
						</View>
						{!currentPeriod && (
							<Pressable
								accessibilityRole="button"
								onPress={() => {
									setAnchor(today);
								}}
								style={styles.back}
							>
								<Text style={styles.link}>
									Back to {mode === 'weekly' ? 'this week' : 'today'}
								</Text>
							</Pressable>
						)}
						{(actionError || error) && (
							<Text accessibilityRole="alert" style={styles.error}>
								{actionError || error}
							</Text>
						)}
						{visible.map((habit) => {
							const dates = habitDaysForWeek(habit, anchor);
							const checked = dates.filter((date) => habit.completions[date]).length;
							const complete = dates.length > 0 && checked === dates.length;
							const shownDates = mode === 'daily' ? [anchor] : dates;
							const history = Object.entries(habit.completions)
								.filter(([date]) => date >= start && date <= end)
								.sort(([a], [b]) => a.localeCompare(b));
							return (
								<View key={habit.id} style={styles.card}>
									<Text
										style={[
											styles.badge,
											habit.kind === 'bad' && styles.badBadge,
										]}
									>
										{habit.kind === 'good' ? 'BUILD' : 'AVOID'}
									</Text>
									<Text style={styles.habitName}>{habit.name}</Text>
									<Text style={styles.body}>
										{habit.kind === 'good'
											? 'Check when you did it.'
											: 'Check when you avoided it.'}
									</Text>
									<View style={styles.progressTrack}>
										<View
											style={[
												styles.progressFill,
												{
													width: `${dates.length ? (checked / dates.length) * 100 : 0}%`,
												},
											]}
										/>
									</View>
									<Text style={[styles.progress, complete && styles.completed]}>
										{complete
											? `Goal completed! ${checked}/${dates.length} this week`
											: `${checked}/${dates.length} this week`}
									</Text>
									<View style={styles.days}>
										{shownDates.map((date) => {
											const done = Boolean(habit.completions[date]);
											const future = date > today;
											const label = WEEKDAYS.find(
												({ day }) =>
													day === new Date(`${date}T12:00:00`).getDay(),
											).label;
											return (
												<Pressable
													key={date}
													accessibilityRole="checkbox"
													accessibilityLabel={`${habit.name}, ${date}, ${habit.kind === 'good' ? 'done' : 'avoided'}`}
													accessibilityHint={
														future
															? 'Future days cannot be checked yet'
															: 'Tap to check or uncheck this day'
													}
													accessibilityState={{
														checked: done,
														disabled: saving || future,
													}}
													disabled={saving || future}
													onPress={() => toggle(habit, date)}
													style={[
														styles.day,
														done && styles.dayDone,
														future && styles.future,
													]}
												>
													<Text
														style={[
															styles.dayLabel,
															done && styles.dayDoneText,
														]}
													>
														{label}
													</Text>
													<Text
														style={[
															styles.dayNumber,
															done && styles.dayDoneText,
														]}
													>
														{date.slice(8)}
													</Text>
													<View
														style={[
															styles.checkbox,
															done && styles.checked,
														]}
													>
														{done && <View style={styles.checkmark} />}
													</View>
												</Pressable>
											);
										})}
									</View>
									{dates.length === 0 && (
										<Text style={styles.body}>
											No days scheduled this week.
										</Text>
									)}
									{history.length > 0 && (
										<View style={styles.history}>
											<Text style={styles.historyTitle}>
												Check-ins this week
											</Text>
											{history.map(([date, timestamp]) => (
												<Text key={date} style={styles.small}>
													{displayDate(date)}
													{!dates.includes(date)
														? ' (previous schedule)'
														: ''}{' '}
													- checked{' '}
													{new Date(timestamp).toLocaleString(undefined, {
														month: 'short',
														day: 'numeric',
														hour: 'numeric',
														minute: '2-digit',
													})}
												</Text>
											))}
										</View>
									)}
									<View style={styles.actions}>
										<Pressable
											accessibilityRole="button"
											accessibilityLabel={`Edit ${habit.name}`}
											disabled={saving}
											onPress={() => setEditor(habit)}
											style={styles.action}
										>
											<Text style={styles.link}>Edit</Text>
										</Pressable>
										<Pressable
											accessibilityRole="button"
											accessibilityLabel={`Delete ${habit.name}`}
											disabled={saving}
											onPress={() => confirmDelete(habit)}
											style={styles.action}
										>
											<Text style={styles.delete}>Delete</Text>
										</Pressable>
									</View>
								</View>
							);
						})}
						{visible.length === 0 && (
							<View style={styles.card}>
								<Text style={styles.habitName}>
									{items.length === 0
										? 'Start with one small habit.'
										: 'No habits scheduled today.'}
								</Text>
								<Text style={styles.body}>
									{items.length === 0
										? 'Try Workout on Mon, Tue, Thu, and Fri. Those days are already selected when you add a habit.'
										: 'Switch to Weekly to see all your habits.'}
								</Text>
							</View>
						)}
						<Pressable
							accessibilityRole="button"
							disabled={saving}
							onPress={() => setEditor({})}
							style={[styles.primary, saving && styles.future]}
						>
							<Text style={styles.primaryText}>Add habit</Text>
						</Pressable>
						<Text style={styles.note}>
							You can check today or a past scheduled day. Future days stay locked
							until that day arrives.
						</Text>
					</>
				)}
			</ScrollView>
			{editor && (
				<HabitEditor
					habit={editor.id ? editor : null}
					saving={saving}
					onClose={() => setEditor(null)}
					onSave={saveHabit}
				/>
			)}
		</SafeAreaView>
	);
}

const styles = StyleSheet.create({
	safe: { flex: 1, backgroundColor: colors.background },
	content: { padding: 24, paddingBottom: 40, maxWidth: 560, width: '100%', alignSelf: 'center' },
	back: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', marginBottom: 12 },
	link: { color: colors.green, fontWeight: '600', fontSize: 14 },
	title: { fontSize: 30, fontWeight: '700', color: colors.ink },
	intro: { color: colors.muted, fontSize: 14, lineHeight: 22, marginTop: 8 },
	storage: { color: colors.muted, fontSize: 12, lineHeight: 19, marginTop: 8, marginBottom: 24 },
	modes: {
		flexDirection: 'row',
		gap: 6,
		backgroundColor: colors.line,
		padding: 5,
		borderRadius: 16,
	},
	mode: {
		flex: 1,
		minHeight: 44,
		alignItems: 'center',
		justifyContent: 'center',
		borderRadius: 12,
	},
	modeSelected: { backgroundColor: colors.green },
	modeText: { color: colors.green, fontWeight: '600' },
	modeTextSelected: { color: colors.paper },
	period: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		marginVertical: 22,
		gap: 12,
	},
	periodButton: {
		width: 44,
		minHeight: 48,
		alignItems: 'center',
		justifyContent: 'center',
		borderWidth: 1,
		borderColor: colors.line,
		borderRadius: 14,
	},
	periodLabel: { flex: 1, alignItems: 'center' },
	periodTitle: { color: colors.ink, fontSize: 18, fontWeight: '700', marginBottom: 4 },
	body: { color: colors.muted, fontSize: 14, lineHeight: 22 },
	small: { color: colors.muted, fontSize: 12, lineHeight: 20 },
	card: {
		backgroundColor: colors.paper,
		borderWidth: 1,
		borderColor: colors.line,
		borderRadius: 24,
		padding: 20,
		marginBottom: 16,
	},
	badge: {
		color: colors.green,
		fontWeight: '700',
		letterSpacing: 1,
		fontSize: 10,
		marginBottom: 8,
	},
	badBadge: { color: '#90632F' },
	habitName: { color: colors.ink, fontSize: 22, fontWeight: '600', marginBottom: 8 },
	progressTrack: {
		height: 5,
		backgroundColor: colors.line,
		borderRadius: 5,
		marginTop: 18,
		overflow: 'hidden',
	},
	progressFill: { height: 5, backgroundColor: colors.green, borderRadius: 5 },
	progress: { color: colors.muted, fontSize: 13, marginTop: 8, marginBottom: 18 },
	completed: { color: colors.green, fontWeight: '700' },
	days: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
	day: {
		minWidth: 48,
		minHeight: 104,
		borderRadius: 14,
		borderWidth: 1,
		borderColor: colors.line,
		padding: 8,
		alignItems: 'center',
		gap: 8,
	},
	dayDone: { backgroundColor: colors.green, borderColor: colors.green },
	dayLabel: { fontSize: 12, color: colors.muted },
	dayNumber: { fontSize: 17, fontWeight: '600', color: colors.ink },
	dayDoneText: { color: colors.paper },
	future: { opacity: 0.45 },
	checkbox: {
		width: 22,
		height: 22,
		borderWidth: 1.5,
		borderColor: colors.muted,
		borderRadius: 6,
		alignItems: 'center',
		justifyContent: 'center',
	},
	checked: { backgroundColor: colors.lime, borderColor: colors.lime },
	checkmark: {
		width: 6,
		height: 10,
		borderRightWidth: 2,
		borderBottomWidth: 2,
		borderColor: colors.green,
		transform: [{ rotate: '45deg' }],
		marginBottom: 3,
	},
	history: {
		marginTop: 18,
		paddingTop: 14,
		borderTopWidth: 1,
		borderTopColor: colors.line,
		gap: 4,
	},
	historyTitle: { color: colors.ink, fontSize: 12, fontWeight: '600', marginBottom: 2 },
	actions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
	action: { minHeight: 44, justifyContent: 'center', minWidth: 44 },
	delete: { color: colors.danger, fontWeight: '600', fontSize: 14 },
	primary: {
		backgroundColor: colors.green,
		minHeight: 56,
		borderRadius: 16,
		alignItems: 'center',
		justifyContent: 'center',
		padding: 16,
	},
	primaryText: { color: colors.paper, fontSize: 16, fontWeight: '600' },
	error: { color: colors.danger, lineHeight: 22, marginBottom: 16 },
	note: { fontSize: 12, lineHeight: 20, color: colors.muted, marginTop: 16 },
});

import { useState } from 'react';
import { randomUUID } from 'expo-crypto';
import { Pressable, Text, View } from 'react-native';
import { TrackerField, TrackerForm, trackerFormStyles as styles } from './TrackerForm';
import { DEFAULT_HABIT_DAYS, WEEKDAYS, weekStart } from '../utils/habits';
import { todayDate } from '../utils/trackers';

export function HabitEditor({ habit, saving, onClose, onSave }) {
	const [name, setName] = useState(habit?.name ?? '');
	const [kind, setKind] = useState(habit?.kind ?? 'good');
	const [days, setDays] = useState(habit?.days ?? [...DEFAULT_HABIT_DAYS]);
	const [id] = useState(() => habit?.id ?? randomUUID());

	return (
		<TrackerForm
			title={habit ? 'Edit habit' : 'Add habit'}
			saving={saving}
			onClose={onClose}
			onSave={async () => {
				const result = await onSave({
					id,
					name,
					kind,
					days,
					startDate: habit?.startDate ?? weekStart(todayDate()),
					completions: habit?.completions ?? {},
				});
				if (!result.success) throw new Error(result.error);
				return true;
			}}
		>
			<TrackerField
				label="Habit name"
				placeholder="e.g. Workout"
				value={name}
				onChangeText={setName}
				maxLength={80}
				editable={!saving}
			/>
			<Text style={styles.label}>What are you working on?</Text>
			<View style={styles.choices}>
				{['good', 'bad'].map((value) => (
					<Pressable
						key={value}
						accessibilityRole="radio"
						accessibilityState={{
							selected: kind === value,
							disabled: saving || Boolean(habit),
						}}
						disabled={saving || Boolean(habit)}
						onPress={() => setKind(value)}
						style={[styles.choice, kind === value && styles.selected]}
					>
						<Text style={[styles.choiceText, kind === value && styles.selectedText]}>
							{value === 'good' ? 'Build a good habit' : 'Avoid a bad habit'}
						</Text>
					</Pressable>
				))}
			</View>
			<Text style={styles.hint}>
				{kind === 'good'
					? 'Check a day when you did it.'
					: 'Check a day when you avoided it. Leave it unchecked if you did it.'}
			</Text>
			{habit && (
				<Text style={styles.hint}>
					The habit type stays the same so past check-ins keep their meaning.
				</Text>
			)}
			<Text style={styles.label}>Days each week</Text>
			<View style={styles.choices}>
				{WEEKDAYS.map(({ day, label }) => (
					<Pressable
						key={day}
						accessibilityRole="checkbox"
						accessibilityLabel={label}
						accessibilityState={{ checked: days.includes(day) }}
						disabled={saving}
						onPress={() =>
							setDays((current) =>
								current.includes(day)
									? current.filter((value) => value !== day)
									: [...current, day],
							)
						}
						style={[styles.choice, days.includes(day) && styles.selected]}
					>
						<Text
							style={[styles.choiceText, days.includes(day) && styles.selectedText]}
						>
							{label}
						</Text>
					</Pressable>
				))}
			</View>
			<Pressable
				accessibilityRole="button"
				disabled={saving}
				onPress={() => setDays(WEEKDAYS.map(({ day }) => day))}
				style={styles.choice}
			>
				<Text style={styles.choiceText}>Every day</Text>
			</Pressable>
			<Text style={[styles.hint, { marginTop: 16 }]}>
				{days.length} {days.length === 1 ? 'day' : 'days'} a week. Check all scheduled days
				to complete the weekly goal.
			</Text>
			{habit && (
				<Text style={styles.hint}>
					Changing the days updates the schedule. Your past check-ins are kept.
				</Text>
			)}
		</TrackerForm>
	);
}

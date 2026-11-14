import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMoneyData } from '../hooks/useMoneyData';
import { useHabits } from '../hooks/useHabits';
import { BalanceScreen } from './BalanceScreen';
import { HabitScreen } from './HabitScreen';
import { colors } from '../theme';

export function PersonalTrackerScreen() {
	const [page, setPage] = useState(null);
	const [syncPaused, setSyncPaused] = useState(false);
	// Keep one money session alive when moving between sections.
	const money = useMoneyData({ pauseSync: syncPaused });
	const habits = useHabits();

	if (page === 'money') {
		return (
			<BalanceScreen
				money={money}
				onEditingChange={setSyncPaused}
				onBack={() => setPage(null)}
			/>
		);
	}
	if (page === 'habits') {
		return <HabitScreen habits={habits} onBack={() => setPage(null)} />;
	}

	return (
		<SafeAreaView style={styles.safe}>
			<ScrollView contentContainerStyle={styles.content}>
				<View style={styles.brand}>
					<Image
						source={require('../../assets/icon.png')}
						style={styles.logo}
						accessibilityLabel="Bread logo"
					/>
					<Text style={styles.byline}>RHOBREAD</Text>
				</View>
				<Text style={styles.title}>Personal Tracker</Text>
				<Text style={styles.intro}>A little more in order, one day at a time.</Text>
				<Pressable
					accessibilityRole="button"
					accessibilityLabel="Open Money"
					onPress={() => setPage('money')}
					style={({ pressed }) => [styles.card, styles.money, pressed && styles.pressed]}
				>
					<View style={styles.cardTop}>
						<Text style={styles.moneyLabel}>01 / MONEY</Text>
						<Text style={styles.moneyArrow}>{'>'}</Text>
					</View>
					<Text style={styles.moneyTitle}>Money</Text>
					<Text style={styles.moneyBody}>
						Your balance, income, and payments.{'\n'}Everything you already track, in
						one place.
					</Text>
				</Pressable>
				<Pressable
					accessibilityRole="button"
					accessibilityLabel="Open Habit Tracker"
					onPress={() => setPage('habits')}
					style={({ pressed }) => [styles.card, styles.habits, pressed && styles.pressed]}
				>
					<View style={styles.cardTop}>
						<Text style={styles.habitLabel}>02 / HABITS</Text>
						<Text style={styles.habitArrow}>{'>'}</Text>
					</View>
					<Text style={styles.habitTitle}>Habit Tracker</Text>
					<Text style={styles.habitBody}>
						Make time for the good.{'\n'}Keep a little distance from the bad.
					</Text>
				</Pressable>
				<Text style={styles.footer}>Small steps count.</Text>
			</ScrollView>
		</SafeAreaView>
	);
}

const styles = StyleSheet.create({
	safe: { flex: 1, backgroundColor: colors.background },
	content: { padding: 24, paddingBottom: 36, maxWidth: 560, width: '100%', alignSelf: 'center' },
	brand: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12, marginBottom: 28 },
	logo: { width: 64, height: 64, borderRadius: 20 },
	byline: { color: colors.green, fontSize: 12, fontWeight: '700', letterSpacing: 2.5 },
	title: { fontSize: 34, fontWeight: '700', color: colors.ink, letterSpacing: -1 },
	intro: { fontSize: 15, lineHeight: 23, color: colors.muted, marginTop: 10, marginBottom: 30 },
	card: { borderRadius: 28, padding: 26, marginBottom: 18 },
	money: { backgroundColor: colors.green },
	habits: { backgroundColor: '#F7DDA6', borderColor: '#E5C48B', borderWidth: 1 },
	cardTop: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		marginBottom: 28,
	},
	moneyLabel: { color: colors.lime, letterSpacing: 1.5, fontSize: 11, fontWeight: '700' },
	habitLabel: { color: '#705025', letterSpacing: 1.5, fontSize: 11, fontWeight: '700' },
	moneyArrow: { color: colors.lime, fontSize: 24 },
	habitArrow: { color: colors.green, fontSize: 24 },
	moneyTitle: { color: colors.paper, fontSize: 30, fontWeight: '600', marginBottom: 12 },
	habitTitle: { color: colors.ink, fontSize: 30, fontWeight: '600', marginBottom: 12 },
	moneyBody: { color: '#DBE6D7', fontSize: 14, lineHeight: 22 },
	habitBody: { color: '#705025', fontSize: 14, lineHeight: 22 },
	footer: { color: colors.muted, textAlign: 'center', fontSize: 12, marginTop: 14 },
	pressed: { opacity: 0.85 },
});

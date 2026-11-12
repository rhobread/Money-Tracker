import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMoneyData } from '../hooks/useMoneyData';
import { TrackerScreen } from './TrackerScreen';
import { MoneySourcesScreen } from './MoneySourcesScreen';
import { AccountScreen } from './AccountScreen';
import { formatMoney, totalMinor } from '../utils/money';
import { colors } from '../theme';

export function BalanceScreen() {
	const [page, setPage] = useState(null);
	const [syncPaused, setSyncPaused] = useState(false);
	const money = useMoneyData({ pauseSync: syncPaused });
	const {
		data,
		loading,
		loadError,
		saving,
		reload,
		updateSources,
		saveTracker,
		saveEntry,
		deleteTracker,
	} = money;

	if (page === 'account' || money.conflict) {
		return <AccountScreen session={money} onBack={() => setPage(null)} />;
	}

	if (loading || loadError) {
		return (
			<SafeAreaView style={styles.center}>
				{loading ? (
					<ActivityIndicator size="large" color={colors.green} />
				) : (
					<>
						<Text accessibilityRole="alert" style={styles.body}>
							{loadError}
						</Text>
						<Pressable
							accessibilityRole="button"
							onPress={reload}
							style={styles.button}
						>
							<Text style={styles.buttonText}>Try again</Text>
						</Pressable>
						<Pressable
							accessibilityRole="button"
							disabled={saving}
							onPress={() => setPage('account')}
							style={styles.button}
						>
							<Text style={styles.buttonText}>Google Drive / account recovery</Text>
						</Pressable>
					</>
				)}
			</SafeAreaView>
		);
	}

	const { wallet, trackers } = data;
	if (page === 'sources') {
		return (
			<MoneySourcesScreen
				wallet={wallet}
				saving={saving}
				updateSources={updateSources}
				onEditingChange={setSyncPaused}
				onBack={() => setPage(null)}
			/>
		);
	}
	if (page) {
		return (
			<TrackerScreen
				kind={page}
				data={trackers}
				sources={wallet.sources}
				saving={saving}
				saveTracker={saveTracker}
				saveEntry={saveEntry}
				deleteTracker={deleteTracker}
				onEditingChange={setSyncPaused}
				onBack={() => setPage(null)}
			/>
		);
	}

	return (
		<SafeAreaView style={styles.safe}>
			<ScrollView contentContainerStyle={styles.content}>
				<Text style={styles.title}>Money Tracker</Text>
				<Pressable
					accessibilityRole="button"
					accessibilityLabel="Current balance"
					accessibilityHint="Open money sources"
					disabled={saving}
					onPress={() => setPage('sources')}
					style={({ pressed }) => [styles.balanceCard, pressed && styles.pressed]}
				>
					<Text style={styles.cardLabel}>Current balance</Text>
					<Text
						style={styles.amount}
						adjustsFontSizeToFit
						numberOfLines={1}
						minimumFontScale={0.4}
					>
						{formatMoney(totalMinor(wallet.sources))}
					</Text>
					<Text style={styles.cardHint}>View money sources</Text>
				</Pressable>
				{['income', 'payment'].map((kind) => (
					<Pressable
						key={kind}
						accessibilityRole="button"
						disabled={saving}
						onPress={() => setPage(kind)}
						style={({ pressed }) => [styles.trackerCard, pressed && styles.pressed]}
					>
						<View style={styles.trackerHeading}>
							<Text style={styles.sectionName}>
								{kind === 'income' ? 'Source of Income' : 'Payments'}
							</Text>
							<Text style={styles.edit}>Open</Text>
						</View>
						<Text style={styles.body}>
							{trackers.items.filter((item) => item.kind === kind).length} items
						</Text>
					</Pressable>
				))}
				<Pressable
					accessibilityRole="button"
					accessibilityLabel="Open Google Drive account"
					disabled={saving}
					onPress={() => setPage('account')}
					style={({ pressed }) => [styles.trackerCard, pressed && styles.pressed]}
				>
					<View style={styles.trackerHeading}>
						<Text style={styles.sectionName}>Google Drive</Text>
						<Text style={styles.edit}>Open</Text>
					</View>
					<Text style={styles.body}>{money.account?.email ?? 'Device only'}</Text>
					<Text style={styles.body}>
						{money.syncing
							? 'Syncing...'
							: money.syncError
								? 'Sync needs attention'
								: money.dirty
									? 'Changes waiting to sync'
									: money.account
										? 'Account data saved on this phone'
										: 'Sign in to save and restore your data'}
					</Text>
				</Pressable>
			</ScrollView>
		</SafeAreaView>
	);
}

const styles = StyleSheet.create({
	safe: { flex: 1, backgroundColor: colors.background },
	center: {
		flex: 1,
		justifyContent: 'center',
		padding: 28,
		backgroundColor: colors.background,
		gap: 16,
	},
	content: { padding: 24, paddingBottom: 36, maxWidth: 560, width: '100%', alignSelf: 'center' },
	title: { fontSize: 26, fontWeight: '700', color: colors.ink, marginBottom: 24 },
	balanceCard: { backgroundColor: colors.green, borderRadius: 26, padding: 26 },
	cardLabel: { color: '#DBE6D7', fontSize: 16 },
	cardHint: { color: '#DBE6D7', fontSize: 13, marginTop: 20 },
	pressed: { opacity: 0.85 },
	amount: {
		color: colors.lime,
		fontSize: 44,
		fontWeight: '600',
		marginTop: 20,
		fontVariant: ['tabular-nums'],
	},
	edit: { color: colors.green, fontWeight: '600' },
	body: { color: colors.muted, fontSize: 14, lineHeight: 22 },
	button: {
		backgroundColor: colors.ink,
		borderRadius: 16,
		minHeight: 58,
		padding: 18,
		alignItems: 'center',
		justifyContent: 'center',
		marginTop: 18,
	},
	buttonText: { color: colors.paper, fontSize: 16, fontWeight: '600' },
	trackerCard: {
		backgroundColor: colors.paper,
		borderWidth: 1,
		borderColor: colors.line,
		borderRadius: 24,
		padding: 24,
		marginTop: 20,
	},
	trackerHeading: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		gap: 12,
		marginBottom: 12,
	},
	sectionName: { color: colors.ink, fontSize: 20, fontWeight: '600', flexShrink: 1 },
});

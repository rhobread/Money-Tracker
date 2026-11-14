import { useEffect, useRef, useState } from 'react';
import {
	ActivityIndicator,
	Alert,
	BackHandler,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme';

export function AccountScreen({ session, onBack, onHome }) {
	const {
		account,
		saving,
		syncing,
		authenticating,
		dirty,
		lastSyncedAt,
		syncError,
		conflict,
		canImportGuest,
		googleAvailability,
		loadError,
	} = session;
	const [error, setError] = useState(null);
	const confirming = useRef(false);
	let GoogleButton;
	if (googleAvailability.available) {
		try {
			GoogleButton = require('react-native-nitro-google-signin').GoogleSignInButton;
		} catch {
			// Expo Go and older installed builds may not contain the native sign-in module.
		}
	}

	function goBack() {
		if (saving || confirming.current) return;
		if (conflict) onHome?.();
		else onBack();
	}

	useEffect(() => {
		const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
			goBack();
			return true;
		});
		return () => subscription.remove();
	});

	async function run(action) {
		if (saving || confirming.current) return;
		setError(null);
		try {
			await action();
		} catch {
			setError(
				'Could not complete this action. Local data is kept. Check storage and try again.',
			);
		}
	}

	function confirm(title, message, action, label = 'Continue') {
		if (saving || confirming.current) return;
		confirming.current = true;
		Alert.alert(
			title,
			message,
			[
				{
					text: 'Cancel',
					style: 'cancel',
					onPress: () => {
						confirming.current = false;
					},
				},
				{
					text: label,
					onPress: () => {
						confirming.current = false;
						return run(action);
					},
				},
			],
			{ cancelable: false },
		);
	}

	return (
		<SafeAreaView style={styles.safe}>
			<ScrollView contentContainerStyle={styles.content}>
				<Pressable
					accessibilityRole="button"
					disabled={saving || (!!conflict && !onHome)}
					onPress={goBack}
					style={styles.back}
				>
					<Text style={styles.link}>
						{conflict && onHome ? '< Personal Tracker' : '< Balance'}
					</Text>
				</Pressable>
				<Text style={styles.title}>Google Drive</Text>
				<View style={styles.card}>
					<Text style={styles.heading}>
						{account ? account.name || account.email : 'Device only'}
					</Text>
					{account && <Text style={styles.body}>{account.email}</Text>}
					<Text accessibilityLiveRegion="polite" style={styles.body}>
						{authenticating
							? 'Connecting account...'
							: syncing
								? 'Syncing...'
								: conflict
									? 'Choose which version to keep.'
									: dirty
										? 'Changes saved on this phone. Waiting to sync.'
										: account
											? 'Your account data is available on this phone.'
											: 'Your data stays on this phone until you connect an account and copy it.'}
					</Text>
					{lastSyncedAt && (
						<Text style={styles.body}>
							Last synced: {new Date(lastSyncedAt).toLocaleString()}
						</Text>
					)}
					{saving && <ActivityIndicator color={colors.green} style={styles.progress} />}
				</View>
				{(error || syncError || loadError) && (
					<Text accessibilityRole="alert" style={styles.error}>
						{error || syncError || loadError}
					</Text>
				)}
				{!googleAvailability.available && (
					<Text style={styles.body}>{googleAvailability.reason}</Text>
				)}
				{googleAvailability.available && !GoogleButton && (
					<Text style={styles.error}>
						Rebuild the native app to enable Google sign-in. This installed build does
						not include it.
					</Text>
				)}
				{GoogleButton && (
					<GoogleButton
						signInBehavior="none"
						colorScheme="light"
						size="wide"
						disabled={saving}
						loading={authenticating}
						onPress={() => run(session.signIn)}
						style={styles.googleButton}
					/>
				)}
				{account && (
					<>
						<Pressable
							accessibilityRole="button"
							disabled={saving || !googleAvailability.available}
							onPress={() => run(session.sync)}
							style={[
								styles.button,
								(saving || !googleAvailability.available) && styles.disabled,
							]}
						>
							<Text style={styles.buttonText}>Sync now</Text>
						</Pressable>
						{canImportGuest && (
							<View style={styles.card}>
								<Text style={styles.heading}>Use your existing device data?</Text>
								<Text style={styles.body}>
									This account has no Drive data yet. You can copy your
									device-only balances, income, and payments to {account.email}.
									The device-only copy stays unchanged.
								</Text>
								<Pressable
									accessibilityRole="button"
									disabled={saving}
									onPress={() =>
										confirm(
											'Copy data to this account?',
											`Copy this phone's device-only money data to ${account.email}?`,
											session.importGuest,
											'Copy data',
										)
									}
									style={styles.button}
								>
									<Text style={styles.buttonText}>Copy device-only data</Text>
								</Pressable>
							</View>
						)}
					</>
				)}
				{conflict && (
					<View style={styles.card}>
						<Text style={styles.heading}>Different saved versions</Text>
						<Text style={styles.body}>
							Another device changed the data too. Nothing is merged automatically, so
							paid entries cannot be counted twice. Choose one complete version, or
							sign out to continue with device-only data.
						</Text>
						<Text style={styles.body}>{conflict.message}</Text>
						<Pressable
							accessibilityRole="button"
							disabled={saving || !googleAvailability.available}
							onPress={() =>
								confirm(
									'Keep this device version?',
									"This will make this device's complete dataset the current Drive version instead of the other versions shown.",
									() => session.resolveConflict('local'),
									'Use this device',
								)
							}
							style={styles.button}
						>
							<Text style={styles.buttonText}>Use this device version</Text>
						</Pressable>
						{conflict.heads.map((head) => (
							<Pressable
								key={head.revision}
								accessibilityRole="button"
								disabled={saving || !googleAvailability.available}
								onPress={() =>
									confirm(
										'Use this Drive version?',
										"This replaces this device's account data, including any unsynced edits, with the selected complete Drive version. Other account data is not merged.",
										() => session.resolveConflict('remote', head.revision),
										'Use Drive version',
									)
								}
								style={styles.secondary}
							>
								<Text style={styles.link}>
									Use Drive version: {new Date(head.createdAt).toLocaleString()}
								</Text>
								<Text style={styles.small}>
									Version {head.revision.slice(0, 8)}
								</Text>
							</Pressable>
						))}
					</View>
				)}
				{(account || loadError) && (
					<Pressable
						accessibilityRole="button"
						disabled={saving}
						onPress={() =>
							confirm(
								'Use device-only data?',
								'Your Google account cache and any unsynced changes stay on this phone. Drive data is not deleted. The app will return to your separate device-only data.',
								session.signOut,
								'Sign out',
							)
						}
						style={styles.secondary}
					>
						<Text style={styles.link}>Sign out / use device-only data</Text>
					</Pressable>
				)}
				<Text style={styles.note}>
					Google Drive keeps private JSON snapshots for this app. They use your Google
					storage, but are not visible as ordinary files in My Drive. Changes save locally
					first and sync while the app is open. Offline edits stay queued.
				</Text>
			</ScrollView>
		</SafeAreaView>
	);
}

const styles = StyleSheet.create({
	safe: { flex: 1, backgroundColor: colors.background },
	content: { padding: 24, paddingBottom: 40, width: '100%', maxWidth: 560, alignSelf: 'center' },
	back: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', marginBottom: 12 },
	title: { color: colors.ink, fontSize: 28, fontWeight: '700', marginBottom: 24 },
	card: {
		backgroundColor: colors.paper,
		borderWidth: 1,
		borderColor: colors.line,
		borderRadius: 18,
		padding: 20,
		marginBottom: 20,
	},
	heading: { color: colors.ink, fontSize: 18, fontWeight: '600', marginBottom: 12 },
	body: { color: colors.muted, fontSize: 14, lineHeight: 23, marginBottom: 12 },
	link: { color: colors.green, fontSize: 15, fontWeight: '600' },
	error: { color: colors.danger, fontSize: 14, lineHeight: 22, marginBottom: 20 },
	progress: { marginVertical: 12 },
	googleButton: {
		alignSelf: 'center',
		width: '100%',
		maxWidth: 312,
		height: 48,
		marginVertical: 20,
	},
	button: {
		backgroundColor: colors.green,
		minHeight: 56,
		borderRadius: 14,
		padding: 16,
		alignItems: 'center',
		justifyContent: 'center',
		marginVertical: 12,
	},
	buttonText: { color: colors.paper, fontSize: 15, fontWeight: '600' },
	secondary: {
		minHeight: 48,
		borderWidth: 1,
		borderColor: colors.line,
		borderRadius: 12,
		padding: 16,
		marginBottom: 12,
		justifyContent: 'center',
	},
	small: { color: colors.muted, fontSize: 12, marginTop: 8 },
	note: { color: colors.muted, fontSize: 12, lineHeight: 21, marginTop: 24 },
	disabled: { opacity: 0.5 },
});

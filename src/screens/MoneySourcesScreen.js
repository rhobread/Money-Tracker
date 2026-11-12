import { useEffect, useRef, useState } from 'react';
import {
	ActivityIndicator,
	Alert,
	BackHandler,
	FlatList,
	Pressable,
	StyleSheet,
	Text,
	View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SourceEditor } from '../components/SourceEditor';
import { formatMoney, totalMinor } from '../utils/money';
import { colors } from '../theme';

export function MoneySourcesScreen({ wallet, saving, updateSources, onEditingChange, onBack }) {
	const [editing, setEditing] = useState(null);
	const [error, setError] = useState(null);
	const confirming = useRef(false);
	useEffect(() => {
		onEditingChange?.(editing !== null);
		return () => onEditingChange?.(false);
	}, [editing !== null, onEditingChange]);

	function goBack() {
		if (!saving && !confirming.current) onBack();
	}

	useEffect(() => {
		const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
			goBack();
			return true;
		});
		return () => subscription.remove();
	});

	async function saveSource(value) {
		const source = editing.source;
		let id = source?.id;
		if (!id) {
			id = `source-${Date.now()}`;
			while (wallet.sources.some((item) => item.id === id)) id += '-new';
		}
		const next = { id, ...value };
		const saved = await updateSources(
			source
				? wallet.sources.map((item) => (item.id === source.id ? next : item))
				: [...wallet.sources, next],
		);
		if (saved) setError(null);
		return saved;
	}

	function deleteSource(source) {
		if (saving || confirming.current) return;
		confirming.current = true;
		onEditingChange?.(true);
		Alert.alert(
			'Delete source?',
			`Delete "${source.name}" and its balance? Sources used by income or payments must be unlinked first.`,
			[
				{
					text: 'Cancel',
					style: 'cancel',
					onPress: () => {
						confirming.current = false;
						onEditingChange?.(false);
					},
				},
				{
					text: 'Delete',
					style: 'destructive',
					onPress: async () => {
						try {
							if (
								await updateSources(
									wallet.sources.filter((item) => item.id !== source.id),
								)
							)
								setError(null);
						} catch (saveError) {
							setError(saveError.message || 'Could not delete source. Try again.');
						} finally {
							confirming.current = false;
							onEditingChange?.(false);
						}
					},
				},
			],
			{ cancelable: false },
		);
	}

	return (
		<SafeAreaView style={styles.safe}>
			<FlatList
				contentContainerStyle={styles.content}
				data={wallet.sources}
				keyExtractor={(source) => source.id}
				extraData={saving}
				ListHeaderComponent={
					<>
						<Pressable
							accessibilityRole="button"
							disabled={saving}
							onPress={goBack}
							style={styles.back}
						>
							<Text style={styles.link}>{'< Balance'}</Text>
						</Pressable>
						<Text style={styles.title}>Money Sources</Text>
						<Text style={styles.total}>{formatMoney(totalMinor(wallet.sources))}</Text>
						<Text style={styles.hint}>
							Edit a source to set its current balance. Paid income and payments
							adjust it automatically.
						</Text>
						<Pressable
							accessibilityRole="button"
							disabled={saving}
							onPress={() => !confirming.current && setEditing({ source: null })}
							style={[styles.button, saving && styles.disabled]}
						>
							{saving ? (
								<ActivityIndicator color={colors.paper} />
							) : (
								<Text style={styles.buttonText}>Add source</Text>
							)}
						</Pressable>
						{error && (
							<Text accessibilityRole="alert" style={styles.error}>
								{error}
							</Text>
						)}
					</>
				}
				ListEmptyComponent={
					<Text style={styles.hint}>
						No money sources yet. Add a bank account or cash wallet.
					</Text>
				}
				renderItem={({ item }) => (
					<View style={styles.source}>
						<Text style={styles.sourceName}>{item.name}</Text>
						<Text style={styles.sourceAmount}>{formatMoney(item.amountMinor)}</Text>
						<View style={styles.actions}>
							<Pressable
								accessibilityRole="button"
								accessibilityLabel={`Edit ${item.name}`}
								disabled={saving}
								onPress={() => !confirming.current && setEditing({ source: item })}
								style={styles.action}
							>
								<Text style={styles.link}>Edit</Text>
							</Pressable>
							<Pressable
								accessibilityRole="button"
								accessibilityLabel={`Delete ${item.name}`}
								disabled={saving}
								onPress={() => deleteSource(item)}
								style={styles.action}
							>
								<Text style={styles.error}>Delete</Text>
							</Pressable>
						</View>
					</View>
				)}
			/>
			{editing && (
				<SourceEditor
					source={editing.source}
					saving={saving}
					onSave={saveSource}
					onClose={() => setEditing(null)}
				/>
			)}
		</SafeAreaView>
	);
}

const styles = StyleSheet.create({
	safe: { flex: 1, backgroundColor: colors.background },
	content: { padding: 24, paddingBottom: 40, maxWidth: 560, width: '100%', alignSelf: 'center' },
	back: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', marginBottom: 12 },
	link: { color: colors.green, fontWeight: '600', fontSize: 15 },
	title: { color: colors.ink, fontSize: 28, fontWeight: '700', marginBottom: 16 },
	total: { color: colors.ink, fontSize: 32, fontWeight: '600', marginBottom: 12 },
	hint: { color: colors.muted, fontSize: 14, lineHeight: 22, marginBottom: 16 },
	source: {
		backgroundColor: colors.paper,
		borderWidth: 1,
		borderColor: colors.line,
		borderRadius: 16,
		padding: 18,
		marginBottom: 12,
	},
	sourceName: { color: colors.ink, fontSize: 17, fontWeight: '600' },
	sourceAmount: { color: colors.ink, fontSize: 22, marginTop: 8, fontVariant: ['tabular-nums'] },
	actions: { flexDirection: 'row', gap: 20, marginTop: 8 },
	action: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
	error: { color: colors.danger, lineHeight: 22, marginBottom: 12 },
	button: {
		backgroundColor: colors.ink,
		borderRadius: 16,
		minHeight: 56,
		padding: 18,
		alignItems: 'center',
		justifyContent: 'center',
		marginBottom: 24,
	},
	buttonText: { color: colors.paper, fontSize: 16, fontWeight: '600' },
	disabled: { opacity: 0.6 },
});

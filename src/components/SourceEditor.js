import { useRef, useState } from 'react';
import {
	ActivityIndicator,
	KeyboardAvoidingView,
	Modal,
	Platform,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	TextInput,
	View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { parseAmount, validateSource } from '../utils/money';
import { colors } from '../theme';

export function SourceEditor({ source, saving, onSave, onClose }) {
	const [name, setName] = useState(source?.name ?? '');
	const [amount, setAmount] = useState(
		source ? (source.amountMinor / 100).toFixed(2).replace('.', ',') : '',
	);
	const submitting = useRef(false);
	const [error, setError] = useState(null);

	async function submit() {
		if (submitting.current) return;
		let next;
		try {
			next = validateSource({ name, amountMinor: parseAmount(amount) });
		} catch (validationError) {
			setError(validationError.message);
			return;
		}
		setError(null);
		submitting.current = true;
		try {
			if (await onSave(next)) onClose();
		} catch (saveError) {
			setError(`Could not save. ${saveError.message || 'Try again.'}`);
		} finally {
			submitting.current = false;
		}
	}

	return (
		<Modal animationType="slide" onRequestClose={() => !saving && onClose()}>
			<SafeAreaView style={styles.safe}>
				<KeyboardAvoidingView
					style={styles.flex}
					behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
				>
					<ScrollView
						contentContainerStyle={styles.content}
						keyboardShouldPersistTaps="handled"
					>
						<View style={styles.header}>
							<Text style={styles.title}>
								{source ? 'Edit source' : 'Add source'}
							</Text>
							<Pressable
								accessibilityRole="button"
								disabled={saving}
								onPress={onClose}
								hitSlop={12}
							>
								<Text style={styles.cancel}>Cancel</Text>
							</Pressable>
						</View>
						<Text style={styles.label}>Name</Text>
						<TextInput
							accessibilityLabel="Source name"
							style={[styles.input, styles.nameInput]}
							value={name}
							onChangeText={setName}
							editable={!saving}
							maxLength={80}
							placeholder="Bank A"
							placeholderTextColor={colors.muted}
						/>
						<Text style={styles.label}>Amount (IDR)</Text>
						<TextInput
							accessibilityLabel="Current amount in Indonesian rupiah"
							style={styles.input}
							value={amount}
							onChangeText={setAmount}
							keyboardType="decimal-pad"
							editable={!saving}
							selectTextOnFocus
							maxLength={20}
							placeholder="0,00"
							placeholderTextColor={colors.muted}
						/>
						<Pressable
							accessibilityRole="button"
							disabled={saving}
							onPress={() =>
								setAmount(amount.startsWith('-') ? amount.slice(1) : `-${amount}`)
							}
							style={styles.signButton}
						>
							<Text style={styles.cancel}>Toggle positive / negative</Text>
						</Pressable>
						<Text style={styles.hint}>
							No thousands separators. Use a comma or dot for decimals, e.g. 1250,50.
						</Text>
						{error && (
							<Text accessibilityRole="alert" style={styles.error}>
								{error}
							</Text>
						)}
						<Pressable
							accessibilityRole="button"
							accessibilityLabel="Save source"
							disabled={saving}
							onPress={submit}
							style={[styles.save, saving && styles.disabled]}
						>
							{saving ? (
								<ActivityIndicator color={colors.paper} />
							) : (
								<Text style={styles.saveText}>Save</Text>
							)}
						</Pressable>
					</ScrollView>
				</KeyboardAvoidingView>
			</SafeAreaView>
		</Modal>
	);
}

const styles = StyleSheet.create({
	safe: { flex: 1, backgroundColor: colors.background },
	flex: { flex: 1 },
	content: { padding: 24, width: '100%', maxWidth: 560, alignSelf: 'center', paddingBottom: 40 },
	header: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
		marginBottom: 40,
	},
	cancel: { color: colors.green, fontWeight: '600', fontSize: 14 },
	title: { color: colors.ink, fontSize: 26, fontWeight: '700' },
	nameInput: { fontSize: 20, marginBottom: 24 },
	label: { color: colors.ink, fontSize: 14, fontWeight: '600', marginBottom: 12 },
	input: {
		backgroundColor: colors.paper,
		borderWidth: 1,
		borderColor: colors.line,
		borderRadius: 16,
		padding: 20,
		fontSize: 32,
		color: colors.ink,
		fontVariant: ['tabular-nums'],
	},
	signButton: { alignSelf: 'flex-start', paddingVertical: 16, marginBottom: 16 },
	hint: { color: colors.muted, fontSize: 12, lineHeight: 19, marginTop: 16 },
	error: { color: colors.danger, marginTop: 20, lineHeight: 22 },
	save: {
		backgroundColor: colors.green,
		minHeight: 56,
		borderRadius: 16,
		alignItems: 'center',
		justifyContent: 'center',
		marginTop: 32,
	},
	disabled: { opacity: 0.6 },
	saveText: { color: colors.paper, fontSize: 16, fontWeight: '700' },
});

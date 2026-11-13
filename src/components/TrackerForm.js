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
import { colors } from '../theme';

export function TrackerForm({ title, saving, onClose, onSave, children }) {
	const [error, setError] = useState(null);
	const submitting = useRef(false);

	async function submit() {
		if (submitting.current || saving) return;
		submitting.current = true;
		setError(null);
		try {
			if (await onSave()) onClose();
		} catch (saveError) {
			setError(saveError.message || 'Could not save. Try again.');
		} finally {
			submitting.current = false;
		}
	}

	return (
		<Modal
			animationType="slide"
			onRequestClose={() => !saving && !submitting.current && onClose()}
		>
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
							<Text style={styles.title}>{title}</Text>
							<Pressable
								accessibilityRole="button"
								disabled={saving}
								onPress={() => !submitting.current && onClose()}
								style={styles.cancel}
							>
								<Text style={styles.link}>Cancel</Text>
							</Pressable>
						</View>
						{children}
						{error && (
							<Text accessibilityRole="alert" style={styles.error}>
								{error}
							</Text>
						)}
						<Pressable
							accessibilityRole="button"
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

export function TrackerField({
	label,
	hint,
	inputComponent: InputComponent = TextInput,
	...props
}) {
	return (
		<View style={styles.field}>
			<Text style={styles.label}>{label}</Text>
			<InputComponent
				accessibilityLabel={label}
				style={styles.input}
				placeholderTextColor={colors.muted}
				{...props}
			/>
			{hint && <Text style={styles.hint}>{hint}</Text>}
		</View>
	);
}

export function PaidCheckbox({
	paid,
	disabled,
	onPress,
	label = 'Paid',
	accessibilityLabel = label,
}) {
	return (
		<Pressable
			accessibilityRole="checkbox"
			accessibilityLabel={accessibilityLabel}
			accessibilityState={{ checked: paid, disabled }}
			disabled={disabled}
			onPress={onPress}
			style={styles.checkRow}
		>
			<View style={[styles.checkbox, paid && styles.checked]}>
				{paid && <View style={styles.checkMark} />}
			</View>
			<Text style={styles.checkLabel}>{label}</Text>
		</Pressable>
	);
}

export const trackerFormStyles = StyleSheet.create({
	label: { color: colors.ink, fontSize: 14, fontWeight: '600', marginBottom: 12 },
	choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 },
	choice: {
		borderWidth: 1,
		borderColor: colors.line,
		borderRadius: 12,
		paddingVertical: 14,
		paddingHorizontal: 16,
	},
	selected: { backgroundColor: colors.green, borderColor: colors.green },
	choiceText: { color: colors.ink, fontWeight: '600', textTransform: 'capitalize' },
	selectedText: { color: colors.paper },
	hint: { color: colors.muted, fontSize: 13, lineHeight: 20, marginBottom: 16 },
});

const styles = StyleSheet.create({
	safe: { flex: 1, backgroundColor: colors.background },
	flex: { flex: 1 },
	content: { padding: 24, width: '100%', maxWidth: 560, alignSelf: 'center', paddingBottom: 40 },
	header: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
		marginBottom: 24,
		gap: 12,
	},
	title: { flex: 1, color: colors.ink, fontSize: 26, fontWeight: '700' },
	cancel: { minHeight: 44, justifyContent: 'center' },
	link: { color: colors.green, fontWeight: '600', fontSize: 14 },
	field: { marginBottom: 24 },
	label: { color: colors.ink, fontSize: 14, fontWeight: '600', marginBottom: 12 },
	input: {
		backgroundColor: colors.paper,
		borderWidth: 1,
		borderColor: colors.line,
		borderRadius: 14,
		padding: 16,
		fontSize: 20,
		color: colors.ink,
	},
	hint: { color: colors.muted, fontSize: 12, lineHeight: 19, marginTop: 8 },
	error: { color: colors.danger, lineHeight: 22, marginTop: 16 },
	save: {
		backgroundColor: colors.green,
		minHeight: 56,
		borderRadius: 16,
		alignItems: 'center',
		justifyContent: 'center',
		marginTop: 16,
	},
	disabled: { opacity: 0.6 },
	saveText: { color: colors.paper, fontSize: 16, fontWeight: '700' },
	checkRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 10,
		minHeight: 48,
		paddingVertical: 8,
	},
	checkbox: {
		width: 26,
		height: 26,
		borderWidth: 2,
		borderColor: colors.green,
		borderRadius: 6,
		alignItems: 'center',
		justifyContent: 'center',
	},
	checked: { backgroundColor: colors.green },
	checkMark: {
		width: 7,
		height: 12,
		borderRightWidth: 2,
		borderBottomWidth: 2,
		borderColor: colors.paper,
		transform: [{ rotate: '45deg' }],
		marginBottom: 3,
	},
	checkLabel: { color: colors.ink, fontSize: 15, flexShrink: 1 },
});

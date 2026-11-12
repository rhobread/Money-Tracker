import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

export function MoneySourcePicker({
	sources,
	value,
	onChange,
	disabled,
	label = 'Money source',
	emptyLabel = 'Choose per entry',
}) {
	const choices = [{ id: null, name: emptyLabel }, ...sources];
	return (
		<View style={styles.field}>
			<Text style={styles.label}>{label}</Text>
			<View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.choices}>
				{choices.map((source) => (
					<Pressable
						key={source.id === null ? 'default' : `source-${source.id}`}
						accessibilityRole="radio"
						accessibilityLabel={source.name}
						accessibilityState={{ checked: value === source.id, disabled }}
						disabled={disabled}
						onPress={() => onChange(source.id)}
						style={[styles.choice, value === source.id && styles.selected]}
					>
						<Text style={[styles.text, value === source.id && styles.selectedText]}>
							{source.name}
						</Text>
					</Pressable>
				))}
			</View>
			{!sources.length && (
				<Text style={styles.hint}>Add a money source from the balance screen first.</Text>
			)}
		</View>
	);
}

const styles = StyleSheet.create({
	field: { marginBottom: 24 },
	label: { color: colors.ink, fontSize: 14, fontWeight: '600', marginBottom: 12 },
	choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
	choice: {
		borderWidth: 1,
		borderColor: colors.line,
		borderRadius: 12,
		paddingHorizontal: 16,
		paddingVertical: 14,
	},
	selected: { backgroundColor: colors.green, borderColor: colors.green },
	text: { color: colors.ink, fontWeight: '600' },
	selectedText: { color: colors.paper },
	hint: { color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: 12 },
});

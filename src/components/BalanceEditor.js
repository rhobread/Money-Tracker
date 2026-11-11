import { useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { parseAmount } from '../utils/money';
import { colors } from '../theme';

export function BalanceEditor({ wallet, saving, onSave, onClose }) {
  const [amount, setAmount] = useState((wallet.balanceMinor / 100).toFixed(2).replace('.', ','));
  const [error, setError] = useState(null);

  async function submit() {
    let minor;
    try {
      minor = parseAmount(amount);
    } catch (validationError) {
      setError(validationError.message);
      return;
    }
    setError(null);
    try {
      if (await onSave(minor)) onClose();
    } catch {
      setError('Your balance could not be saved. Please try again.');
    }
  }

  return (
    <Modal animationType="slide" onRequestClose={() => !saving && onClose()}>
      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.header}>
              <Text style={styles.eyebrow}>YOUR BALANCE</Text>
              <Pressable accessibilityRole="button" disabled={saving} onPress={onClose} hitSlop={12}>
                <Text style={styles.cancel}>Cancel</Text>
              </Pressable>
            </View>
            <Text style={styles.title}>A fresh starting point.</Text>
            <Text style={styles.description}>Enter how much money you have right now. You can update it whenever you need.</Text>
            <Text style={styles.label}>Current amount (IDR)</Text>
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
            <Pressable accessibilityRole="button" disabled={saving} onPress={() => setAmount(amount.startsWith('-') ? amount.slice(1) : `-${amount}`)} style={styles.signButton}>
              <Text style={styles.cancel}>Toggle positive / negative</Text>
            </Pressable>
            <Text style={styles.hint}>Indonesian rupiah only. Use a comma or dot for decimals, without thousands separators (for example, 1250,50).</Text>
            {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
            <Pressable accessibilityRole="button" accessibilityLabel="Save balance" disabled={saving} onPress={submit} style={[styles.save, saving && styles.disabled]}>
              {saving ? <ActivityIndicator color={colors.paper} /> : <Text style={styles.saveText}>Save balance</Text>}
            </Pressable>
            <Text style={styles.footer}>Saved on this device. No account needed.</Text>
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
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 40 },
  eyebrow: { color: colors.muted, fontSize: 11, letterSpacing: 2, fontWeight: '700' },
  cancel: { color: colors.green, fontWeight: '600', fontSize: 14 },
  title: { color: colors.ink, fontSize: 36, fontWeight: '700', letterSpacing: -1 },
  description: { color: colors.muted, fontSize: 16, lineHeight: 25, marginTop: 16, marginBottom: 32 },
  label: { color: colors.ink, fontSize: 14, fontWeight: '600', marginBottom: 12 },
  input: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: 16, padding: 20, fontSize: 32, color: colors.ink, fontVariant: ['tabular-nums'] },
  signButton: { alignSelf: 'flex-start', paddingVertical: 16, marginBottom: 16 },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 19, marginTop: 16 },
  error: { color: colors.danger, marginTop: 20, lineHeight: 22 },
  save: { backgroundColor: colors.green, minHeight: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginTop: 32 },
  disabled: { opacity: 0.6 },
  saveText: { color: colors.paper, fontSize: 16, fontWeight: '700' },
  footer: { color: colors.muted, textAlign: 'center', fontSize: 12, marginTop: 18 },
});

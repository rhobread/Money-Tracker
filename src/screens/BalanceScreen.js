import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SourceEditor } from '../components/SourceEditor';
import { useWallet } from '../hooks/useWallet';
import { formatMoney, totalMinor } from '../utils/money';
import { colors } from '../theme';

export function BalanceScreen() {
  const { wallet, loading, loadError, saving, reload, updateSources } = useWallet();
  const [editing, setEditing] = useState(null);
  const [showSources, setShowSources] = useState(false);
  const [error, setError] = useState(null);
  const confirming = useRef(false);

  async function saveSource(value) {
    const source = editing.source;
    let id = source?.id;
    if (!id) {
      id = `source-${Date.now()}`;
      while (wallet.sources.some((item) => item.id === id)) id += '-new';
    }
    const next = { id, ...value };
    const saved = await updateSources(source
      ? wallet.sources.map((item) => item.id === source.id ? next : item)
      : [...wallet.sources, next]);
    if (saved) setError(null);
    return saved;
  }

  function deleteSource(source) {
    if (saving || confirming.current) return;
    confirming.current = true;
    Alert.alert('Delete source?', `Delete "${source.name}" and its amount?`, [
      { text: 'Cancel', style: 'cancel', onPress: () => { confirming.current = false; } },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          if (await updateSources(wallet.sources.filter((item) => item.id !== source.id))) setError(null);
        } catch {
          setError('Could not delete the source. Try again.');
        } finally {
          confirming.current = false;
        }
      } },
    ], { cancelable: false });
  }

  if (loading || loadError) {
    return (
      <SafeAreaView style={styles.center}>
        {loading ? <ActivityIndicator size="large" color={colors.green} /> : <>
          <Text accessibilityRole="alert" style={styles.body}>{loadError}</Text>
          <Pressable accessibilityRole="button" onPress={reload} style={styles.button}><Text style={styles.buttonText}>Try again</Text></Pressable>
        </>}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Money Tracker</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Current balance"
          accessibilityHint="Show or hide money sources"
          accessibilityState={{ expanded: showSources }}
          onPress={() => setShowSources((shown) => !shown)}
          style={({ pressed }) => [styles.balanceCard, pressed && styles.pressed]}
        >
          <Text style={styles.cardLabel}>Current balance</Text>
          <Text style={styles.amount} adjustsFontSizeToFit numberOfLines={1} minimumFontScale={0.4}>{formatMoney(totalMinor(wallet.sources))}</Text>
          <Text style={styles.cardHint}>{showSources ? 'Hide sources' : 'Show sources'}</Text>
        </Pressable>
        {showSources && <>
        <Text style={styles.sectionTitle}>Money sources</Text>
        {!wallet.sources.length && <Text style={styles.body}>No sources yet.</Text>}
        {wallet.sources.map((source) => (
          <View key={source.id} style={styles.source}>
            <Text style={styles.sourceName}>{source.name}</Text>
            <Text style={styles.sourceAmount}>{formatMoney(source.amountMinor)}</Text>
            <View style={styles.actions}>
              <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${source.name}`} disabled={saving} onPress={() => setEditing({ source })} style={styles.action}><Text style={styles.edit}>Edit</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${source.name}`} disabled={saving} onPress={() => deleteSource(source)} style={styles.action}><Text style={styles.error}>Delete</Text></Pressable>
            </View>
          </View>
        ))}
        {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        <Pressable accessibilityRole="button" disabled={saving} onPress={() => setEditing({ source: null })} style={[styles.button, saving && styles.disabled]}>
          {saving ? <ActivityIndicator color={colors.paper} /> : <Text style={styles.buttonText}>Add source</Text>}
        </Pressable>
        </>}
      </ScrollView>
      {editing && <SourceEditor source={editing.source} saving={saving} onSave={saveSource} onClose={() => setEditing(null)} />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', padding: 28, backgroundColor: colors.background, gap: 16 },
  content: { padding: 24, paddingBottom: 36, maxWidth: 560, width: '100%', alignSelf: 'center' },
  title: { fontSize: 26, fontWeight: '700', color: colors.ink, marginBottom: 24 },
  balanceCard: { backgroundColor: colors.green, borderRadius: 26, padding: 26 },
  cardLabel: { color: '#DBE6D7', fontSize: 16 },
  cardHint: { color: '#DBE6D7', fontSize: 13, marginTop: 20 },
  pressed: { opacity: 0.85 },
  amount: { color: colors.lime, fontSize: 44, fontWeight: '600', marginTop: 20, fontVariant: ['tabular-nums'] },
  sectionTitle: { color: colors.ink, fontWeight: '600', fontSize: 18, marginTop: 28, marginBottom: 14 },
  source: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: 16, padding: 18, marginBottom: 12 },
  sourceName: { color: colors.ink, fontSize: 17, fontWeight: '600' },
  sourceAmount: { color: colors.ink, fontSize: 22, marginTop: 8, fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row', gap: 20, marginTop: 8 },
  action: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  edit: { color: colors.green, fontWeight: '600' },
  error: { color: colors.danger },
  body: { color: colors.muted, fontSize: 14, lineHeight: 22 },
  button: { backgroundColor: colors.ink, borderRadius: 16, minHeight: 58, padding: 18, alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  buttonText: { color: colors.paper, fontSize: 16, fontWeight: '600' },
  disabled: { opacity: 0.6 },
});

import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { BalanceEditor } from '../components/BalanceEditor';
import { useWallet } from '../hooks/useWallet';
import { formatMoney } from '../utils/money';
import { colors } from '../theme';

export function BalanceScreen() {
  const { wallet, loading, loadError, saving, reload, updateBalance } = useWallet();
  const [editing, setEditing] = useState(false);

  if (loading || loadError) {
    return (
      <SafeAreaView style={styles.center}>
        {loading ? <ActivityIndicator size="large" color={colors.green} /> : <>
          <Text style={styles.sectionTitle}>Unable to load balance.</Text>
          <Text style={styles.body}>{loadError}</Text>
          <Pressable accessibilityRole="button" onPress={reload} style={styles.button}><Text style={styles.buttonText}>Try again</Text></Pressable>
        </>}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={styles.brand}><View style={styles.logo}><Feather name="bar-chart-2" size={22} color={colors.lime} /></View><Text style={styles.brandText}>money tracker</Text></View>
          <View style={styles.localBadge}><View style={styles.dot} /><Text style={styles.localText}>LOCAL</Text></View>
        </View>

        <Text style={styles.eyebrow}>Testing</Text>
        <Text style={styles.title}>Your money.{'\n'}At a glance.</Text>
        <Text style={styles.subtitle}>Know where you stand. Start from here.</Text>

        <View style={styles.balanceCard}>
          <View style={styles.cardHeader}><Text style={styles.cardLabel}>CURRENT BALANCE</Text><Feather name="credit-card" color={colors.lime} size={22} /></View>
          <Text style={styles.amount} adjustsFontSizeToFit numberOfLines={1} minimumFontScale={0.4}>{formatMoney(wallet.balanceMinor)}</Text>
          <Text style={styles.cardSubtitle}>{wallet.updatedAt ? 'A little peace of mind, in one number.' : 'A clean slate. Make it yours.'}</Text>
          <View style={styles.cardDivider} />
          <View style={styles.cardBottom}><View style={styles.currencyBadge}><Text style={styles.currencyText}>{wallet.currency}</Text></View><Text style={styles.cardFootnote}>Personal balance</Text></View>
        </View>

        <Pressable accessibilityRole="button" onPress={() => setEditing(true)} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
          <Feather name={wallet.updatedAt ? 'edit-3' : 'plus'} size={18} color={colors.paper} /><Text style={styles.buttonText}>{wallet.updatedAt ? 'Update balance' : 'Set your balance'}</Text><Feather name="arrow-up-right" size={19} color={colors.lime} />
        </Pressable>

        <View style={styles.savedRow}><Feather name={wallet.updatedAt ? 'check-circle' : 'clock'} size={14} color={colors.muted} /><Text style={styles.savedText}>{wallet.updatedAt ? `Saved ${new Date(wallet.updatedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'Ready for your first balance'}</Text></View>

        <View style={styles.note}>
          <View style={styles.noteIcon}><Feather name="shield" size={22} color={colors.green} /></View>
          <View style={styles.noteContent}><Text style={styles.sectionTitle}>Just you and your money.</Text><Text style={styles.body}>Your balance stays on this device. No sign-up, no bank connection, no cloud sync.</Text></View>
        </View>
        <View style={styles.bottomNote}><Text style={styles.bottomLabel}>SMALL STEPS. BETTER HABITS.</Text><Text style={styles.bottomText}>One number is a good place to begin.</Text></View>
      </ScrollView>
      {editing && <BalanceEditor wallet={wallet} saving={saving} onSave={updateBalance} onClose={() => setEditing(false)} />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', padding: 28, backgroundColor: colors.background, gap: 16 },
  content: { padding: 24, paddingBottom: 36, maxWidth: 560, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 48, gap: 12 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  logo: { backgroundColor: colors.green, width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  brandText: { fontSize: 17, fontWeight: '700', color: colors.ink, letterSpacing: -0.5, flexShrink: 1 },
  localBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: colors.line, borderRadius: 20, padding: 9 },
  dot: { height: 5, width: 5, borderRadius: 3, backgroundColor: colors.green },
  localText: { fontSize: 9, fontWeight: '700', letterSpacing: 1.2, color: colors.green },
  eyebrow: { fontSize: 10, letterSpacing: 2, fontWeight: '700', color: colors.muted, marginBottom: 14 },
  title: { fontSize: 44, lineHeight: 49, letterSpacing: -1.8, fontWeight: '700', color: colors.ink },
  subtitle: { fontSize: 15, lineHeight: 23, color: colors.muted, marginTop: 16, marginBottom: 30 },
  balanceCard: { backgroundColor: colors.green, borderRadius: 26, padding: 26 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  cardLabel: { color: '#DBE6D7', fontSize: 10, fontWeight: '600', letterSpacing: 1.7 },
  amount: { color: colors.lime, fontSize: 48, fontWeight: '600', letterSpacing: -1.8, marginTop: 28, fontVariant: ['tabular-nums'] },
  cardSubtitle: { color: '#CCD9CC', fontSize: 12, lineHeight: 18, marginTop: 10 },
  cardDivider: { height: 1, backgroundColor: '#496857', marginVertical: 25 },
  cardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  currencyBadge: { backgroundColor: '#3B604B', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 7 },
  currencyText: { color: colors.lime, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  cardFootnote: { color: '#CCD9CC', fontSize: 12 },
  button: { backgroundColor: colors.ink, borderRadius: 16, minHeight: 58, padding: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 18 },
  pressed: { opacity: 0.8 },
  buttonText: { color: colors.paper, fontSize: 15, fontWeight: '600' },
  savedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 16 },
  savedText: { fontSize: 11, color: colors.muted, flexShrink: 1 },
  note: { marginTop: 36, borderWidth: 1, borderColor: colors.line, borderRadius: 20, padding: 18, flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  noteIcon: { backgroundColor: '#E7EDDC', borderRadius: 12, padding: 10 },
  noteContent: { flex: 1 },
  sectionTitle: { color: colors.ink, fontWeight: '600', fontSize: 14, marginBottom: 7 },
  body: { color: colors.muted, fontSize: 12, lineHeight: 20 },
  bottomNote: { marginTop: 36, alignItems: 'center' },
  bottomLabel: { color: colors.muted, fontSize: 9, letterSpacing: 1.8, fontWeight: '600' },
  bottomText: { color: colors.muted, fontSize: 12, marginTop: 8 },
});

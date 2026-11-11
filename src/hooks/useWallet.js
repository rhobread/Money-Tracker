import { useEffect, useRef, useState } from 'react';
import { loadWallet, saveWallet } from '../storage/walletStorage';

export function useWallet() {
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  async function reload() {
    setLoading(true);
    setLoadError(null);
    try {
      setWallet(await loadWallet());
    } catch {
      setLoadError('We could not load your saved balance. Your data has not been overwritten. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, []);

  async function updateBalance(balanceMinor) {
    if (savingRef.current || !wallet) return false;
    savingRef.current = true;
    setSaving(true);
    try {
      const next = { ...wallet, balanceMinor, updatedAt: new Date().toISOString() };
      await saveWallet(next);
      setWallet(next);
      return true;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return { wallet, loading, loadError, saving, reload, updateBalance };
}

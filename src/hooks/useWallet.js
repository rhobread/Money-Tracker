import { useEffect, useRef, useState } from 'react';
import { loadWallet, saveWallet } from '../storage/walletStorage';
import { validateWallet } from '../utils/money';

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
      setWallet(null);
      setLoadError('Could not load your money sources. Stored data has not been changed. Try again.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, []);

  async function updateSources(sources) {
    if (savingRef.current || !wallet || loading || loadError) return false;
    savingRef.current = true;
    setSaving(true);
    try {
      const next = validateWallet({ ...wallet, sources, updatedAt: new Date().toISOString() });
      await saveWallet(next);
      setWallet(next);
      return true;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return { wallet, loading, loadError, saving, reload, updateSources };
}

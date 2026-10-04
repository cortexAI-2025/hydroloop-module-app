'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { SYNC_EVENT, pendingCount, syncNow } from '@/lib/sync';
import type { SyncState } from '@/lib/sync';
import { isCloudEnabled } from '@/lib/supabase';

const INTERVAL_MS = 5 * 60 * 1000;

/** Synchronise au démarrage, au retour du réseau, au retour sur l'onglet et toutes les 5 min. */
export function SyncManager() {
  useEffect(() => {
    if (!isCloudEnabled()) return;
    const run = () => { if (navigator.onLine) void syncNow(); };
    run();
    const onVisible = () => { if (document.visibilityState === 'visible') run(); };
    window.addEventListener('online', run);
    document.addEventListener('visibilitychange', onVisible);
    const t = setInterval(run, INTERVAL_MS);
    return () => {
      window.removeEventListener('online', run);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(t);
    };
  }, []);
  return null;
}

/** Pastille d'état de synchronisation pour la barre de navigation. */
export function SyncBadge() {
  const [state, setState] = useState<SyncState | null>(null);
  const [online, setOnline] = useState(true);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(isCloudEnabled());
    setOnline(navigator.onLine);
    const onSync = (e: Event) => setState((e as CustomEvent<SyncState>).detail);
    const onNet = () => setOnline(navigator.onLine);
    window.addEventListener(SYNC_EVENT, onSync);
    window.addEventListener('online', onNet);
    window.addEventListener('offline', onNet);
    return () => {
      window.removeEventListener(SYNC_EVENT, onSync);
      window.removeEventListener('online', onNet);
      window.removeEventListener('offline', onNet);
    };
  }, []);

  let label = 'Local';
  let dot = 'bg-gray-400';
  let title = 'Données stockées sur cet appareil uniquement';
  if (!online) {
    label = 'Hors ligne';
    dot = 'bg-amber-400';
    title = 'Hors ligne : les modifications seront synchronisées au retour du réseau';
  } else if (enabled) {
    if (state?.state === 'syncing') { label = 'Synchro…'; dot = 'bg-blue-400 animate-pulse'; title = 'Synchronisation en cours'; }
    else if (state?.state === 'error') { label = 'Erreur synchro'; dot = 'bg-red-500'; title = state.message; }
    else { label = 'Synchronisé'; dot = 'bg-green-400'; title = state?.state === 'ok' ? `Dernière synchro : ${new Date(state.at).toLocaleTimeString('fr-FR')}` : 'Synchronisation cloud active'; }
    const pending = pendingCount();
    if (pending > 0 && state?.state !== 'syncing') label += ` (${pending})`;
  }

  return (
    <Link href="/donnees" title={title} className="hidden sm:inline-flex items-center gap-1.5 text-xs text-brand-100 px-2 py-1 rounded hover:bg-brand-700">
      <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden />
      {label}
    </Link>
  );
}

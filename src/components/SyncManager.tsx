'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { SYNC_EVENT, cloudConfigured, getSyncState, pendingCount } from '@/lib/sync/runtime';
import type { SyncState } from '@/lib/sync/runtime';
import { DATA_CHANGED_EVENT } from '@/lib/events';

/** Pastille d'état de synchronisation pour la barre de navigation (la boucle de synchro est lancée par OwnerGate). */
export function SyncBadge() {
  const [state, setState] = useState<SyncState>({ state: 'idle' });
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(cloudConfigured());
    setOnline(navigator.onLine);
    setState(getSyncState());
    const refreshPending = () => { void pendingCount().then(setPending).catch(() => undefined); };
    refreshPending();
    const onSync = (e: Event) => { setState((e as CustomEvent<SyncState>).detail); refreshPending(); };
    const onNet = () => setOnline(navigator.onLine);
    window.addEventListener(SYNC_EVENT, onSync);
    window.addEventListener(DATA_CHANGED_EVENT, refreshPending);
    window.addEventListener('online', onNet);
    window.addEventListener('offline', onNet);
    return () => {
      window.removeEventListener(SYNC_EVENT, onSync);
      window.removeEventListener(DATA_CHANGED_EVENT, refreshPending);
      window.removeEventListener('online', onNet);
      window.removeEventListener('offline', onNet);
    };
  }, []);

  let label = 'Local';
  let dot = 'bg-gray-400';
  let title = 'Données stockées sur cet appareil uniquement (cloud non configuré)';
  if (!online || state.state === 'offline') {
    label = 'Hors ligne';
    dot = 'bg-amber-400';
    title = 'Hors ligne : tout est enregistré sur l’appareil et sera envoyé au retour du réseau';
  } else if (enabled) {
    if (state.state === 'disabled') { label = 'Local'; title = state.reason; }
    else if (state.state === 'syncing') { label = 'Synchro…'; dot = 'bg-blue-400 animate-pulse'; title = 'Synchronisation en cours'; }
    else if (state.state === 'error') { label = 'Erreur synchro'; dot = 'bg-red-500'; title = state.message; }
    else { label = 'Synchronisé'; dot = 'bg-green-400'; title = state.state === 'ok' ? `Dernière synchro : ${new Date(state.at).toLocaleTimeString('fr-FR')}` : 'Synchronisation cloud active'; }
  }
  if (pending > 0 && state.state !== 'syncing') { label += ` (${pending} en attente)`; if (dot === 'bg-green-400') dot = 'bg-amber-400'; }

  return (
    <Link href="/donnees" title={title} aria-label={`État de la synchronisation : ${label}. ${title}`}
      className="inline-flex items-center justify-center gap-1.5 text-xs text-brand-100 px-2 py-1 min-h-9 min-w-9 rounded hover:bg-brand-700">
      <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden />
      <span className="hidden sm:inline">{label}</span>
      <span className="sm:hidden">{pending > 0 ? pending : ''}</span>
    </Link>
  );
}

'use client';
import { useEffect, useState } from 'react';
import { requestPersistence, setDbOwner, sanitizeOwner } from '@/lib/db';
import { loadSettings } from '@/lib/settings';
import { ensureDailySnapshot, legacyAdoptedAt, legacyBatchCount, adoptLegacyData } from '@/lib/storage';
import { startSyncLoop } from '@/lib/sync/runtime';
import { notifyDataChanged } from '@/lib/events';
import { checkReminders } from '@/lib/reminders';

const OWNER_CACHE = 'hydroloop:lastOwner';

/** Identifie le propriétaire des données : session serveur, ou dernier compte connu quand le réseau est coupé. */
async function resolveOwner(): Promise<string> {
  try {
    const res = await fetch('/api/auth/session', { cache: 'no-store', credentials: 'same-origin' });
    if (res.ok) {
      const j = (await res.json()) as { user?: { id?: string; name?: string } };
      const id = j.user?.id || j.user?.name;
      if (id) {
        const owner = sanitizeOwner(id);
        try { localStorage.setItem(OWNER_CACHE, owner); } catch { /* stockage indisponible */ }
        return owner;
      }
      // Pas de session : authentification désactivée → base « local ».
      try { localStorage.removeItem(OWNER_CACHE); } catch { /* ignore */ }
      return 'local';
    }
  } catch { /* hors ligne */ }
  // Hors ligne : on reprend le dernier compte connu sur cet appareil plutôt que d'afficher une base vide.
  try { return localStorage.getItem(OWNER_CACHE) || 'local'; } catch { return 'local'; }
}

/**
 * Sélectionne la base locale de l'utilisateur avant d'afficher quoi que ce soit, charge ses réglages,
 * protège le stockage, prend la sauvegarde quotidienne et lance la synchronisation.
 */
export default function OwnerGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [legacy, setLegacy] = useState(0);
  const [adopting, setAdopting] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      const owner = await resolveOwner();
      setDbOwner(owner);
      try {
        await loadSettings();
        void requestPersistence();
        await ensureDailySnapshot();
        if (owner !== 'local' && !(await legacyAdoptedAt())) setLegacy(await legacyBatchCount());
      } catch (e) {
        setStorageError(e instanceof Error ? e.message : 'Stockage local indisponible.');
      }
      if (cancelled) return;
      setReady(true);
      const stopSync = startSyncLoop();
      void checkReminders().catch(() => undefined);
      const rem = setInterval(() => { void checkReminders().catch(() => undefined); }, 30 * 60_000);
      stop = () => { stopSync(); clearInterval(rem); };
    })();
    return () => { cancelled = true; stop?.(); };
  }, []);

  if (!ready) return <div className="p-8 text-sm text-gray-500" role="status">Chargement des données locales…</div>;

  return (
    <>
      {storageError && (
        <div role="alert" className="bg-red-50 border-b border-red-200 text-red-800 text-sm px-4 py-2">
          ⚠ {storageError} Les modifications ne pourront pas être enregistrées sur cet appareil.
        </div>
      )}
      {legacy > 0 && (
        <div role="status" className="bg-amber-50 border-b border-amber-200 text-amber-900 text-sm px-4 py-2 flex flex-wrap items-center gap-3">
          <span>{legacy} batch(es) créé(s) avant la connexion par compte sont présents sur cet appareil. Les rattacher à votre compte ?</span>
          <button className="btn-secondary text-xs" disabled={adopting} onClick={async () => {
            setAdopting(true);
            try { await adoptLegacyData(); setLegacy(0); notifyDataChanged(); } finally { setAdopting(false); }
          }}>Rattacher à mon compte</button>
          <button className="text-xs underline" onClick={() => setLegacy(0)}>Plus tard</button>
        </div>
      )}
      {children}
    </>
  );
}

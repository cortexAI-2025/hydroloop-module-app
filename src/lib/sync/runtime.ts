import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { dbGet, dbGetAll, dbPut, getDbOwner, metaGet, metaSet } from '../db';
import { LOCAL_WRITE_EVENT, notifyDataChanged } from '../events';
import { pendingCount } from '../storage';
import { runSync } from './engine';
import { SupabaseRemote } from './supabaseRemote';
import type { LocalStore, SyncReport } from './types';
import { SyncAuthError, SyncNetworkError } from './types';

export const SYNC_EVENT = 'hydroloop:sync';

export type SyncState =
  | { state: 'disabled'; reason: string }
  | { state: 'idle' }
  | { state: 'syncing' }
  | { state: 'offline' }
  | { state: 'ok'; at: string; report: SyncReport }
  | { state: 'error'; message: string };

const idbLocal: LocalStore = { all: dbGetAll, get: dbGet, put: dbPut, getMeta: (k) => metaGet(k), setMeta: metaSet };

let current: SyncState = { state: 'idle' };
export const getSyncState = (): SyncState => current;

function emit(s: SyncState) {
  current = s;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<SyncState>(SYNC_EVENT, { detail: s }));
}

/** Les variables publiques Supabase sont-elles présentes dans ce build ? */
export const cloudConfigured = (): boolean => !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

interface TokenInfo { token: string; expiresAt: number; owner: string }
let tokenCache: TokenInfo | null = null;
let clientCache: { client: SupabaseClient; owner: string } | null = null;

class NotAvailable extends Error {}

async function fetchToken(force = false): Promise<TokenInfo> {
  if (!force && tokenCache && tokenCache.expiresAt - Date.now() > 5 * 60_000) return tokenCache;
  let res: Response;
  try {
    res = await fetch('/api/sync/token', { cache: 'no-store', credentials: 'same-origin' });
  } catch (e) {
    throw new SyncNetworkError('Serveur HydroLoop injoignable', e);
  }
  if (res.status === 503) {
    const j = await res.json().catch(() => ({}));
    throw new NotAvailable(j.message || 'Synchronisation non configurée sur le serveur.');
  }
  if (res.status === 401) throw new SyncAuthError('Session expirée : reconnectez-vous.');
  if (!res.ok) throw new Error(`Jeton de synchronisation indisponible (HTTP ${res.status}).`);
  tokenCache = (await res.json()) as TokenInfo;
  return tokenCache;
}

function getClient(owner: string): SupabaseClient {
  if (clientCache?.owner === owner) return clientCache.client;
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    accessToken: async () => (await fetchToken()).token,
    auth: { persistSession: false, autoRefreshToken: false },
  });
  clientCache = { client, owner };
  return client;
}

let running: Promise<SyncState> | null = null;

/** Synchronisation complète (récupération puis envoi). Une seule à la fois, même avec plusieurs onglets ouverts. */
export function syncNow(): Promise<SyncState> {
  if (running) return running;
  running = (async (): Promise<SyncState> => {
    if (!cloudConfigured()) { const s: SyncState = { state: 'disabled', reason: 'Cloud non configuré (variables NEXT_PUBLIC_SUPABASE_*).' }; emit(s); return s; }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { const s: SyncState = { state: 'offline' }; emit(s); return s; }
    emit({ state: 'syncing' });

    const work = async (): Promise<SyncState> => {
      try {
        const { owner } = await fetchToken();
        if (owner !== getDbOwner()) throw new Error('Le compte connecté ne correspond pas à la base locale : rechargez la page.');
        const report = await runSync(idbLocal, new SupabaseRemote(getClient(owner), owner), { onLocalChange: () => undefined });
        if (report.conflicts.length) await metaSet('lastConflicts', { at: new Date().toISOString(), items: report.conflicts });
        await metaSet('lastSyncAt', new Date().toISOString());
        if (report.pulled || report.merged || report.pushed) notifyDataChanged();
        return report.failed.length
          ? { state: 'error', message: `${report.failed.length} batch(es) non synchronisé(s) : ${report.failed[0].message}` }
          : { state: 'ok', at: new Date().toISOString(), report };
      } catch (e) {
        if (e instanceof NotAvailable) return { state: 'disabled', reason: e.message };
        if (e instanceof SyncNetworkError) return { state: 'offline' };
        if (e instanceof SyncAuthError) {
          tokenCache = null; // un seul nouvel essai avec un jeton frais
          try {
            await fetchToken(true);
            const { owner } = tokenCache as unknown as TokenInfo;
            const report = await runSync(idbLocal, new SupabaseRemote(getClient(owner), owner));
            notifyDataChanged();
            return { state: 'ok', at: new Date().toISOString(), report };
          } catch (e2) {
            return { state: 'error', message: e2 instanceof Error ? e2.message : String(e2) };
          }
        }
        return { state: 'error', message: e instanceof Error ? e.message : String(e) };
      }
    };

    let result: SyncState;
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    if (locks?.request) {
      const r = await locks.request('hydroloop-sync', { ifAvailable: true }, async (lock) => (lock ? work() : ({ state: 'idle' } as SyncState)));
      result = r as SyncState;
    } else {
      result = await work();
    }
    emit(result);
    return result;
  })().finally(() => { running = null; });
  return running;
}

/** Déclenche une synchro différée (regroupe les écritures rapprochées). */
let timer: ReturnType<typeof setTimeout> | null = null;
export function scheduleSync(delayMs = 2000) {
  if (!cloudConfigured()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void syncNow(); }, delayMs);
}

/**
 * Pilote la synchro tant que l'application est ouverte : au démarrage, après chaque écriture locale,
 * au retour du réseau, au retour sur l'onglet, puis toutes les 5 minutes.
 */
export function startSyncLoop(): () => void {
  if (typeof window === 'undefined' || !cloudConfigured()) return () => undefined;
  const run = () => { if (navigator.onLine) void syncNow(); };
  const onVisible = () => { if (document.visibilityState === 'visible') run(); };
  const onWrite = () => scheduleSync();
  const onOffline = () => emit({ state: 'offline' });
  run();
  window.addEventListener('online', run);
  window.addEventListener('offline', onOffline);
  window.addEventListener(LOCAL_WRITE_EVENT, onWrite);
  document.addEventListener('visibilitychange', onVisible);
  const interval = setInterval(run, 5 * 60_000);
  return () => {
    window.removeEventListener('online', run);
    window.removeEventListener('offline', onOffline);
    window.removeEventListener(LOCAL_WRITE_EVENT, onWrite);
    document.removeEventListener('visibilitychange', onVisible);
    clearInterval(interval);
    if (timer) clearTimeout(timer);
  };
}

export { pendingCount };

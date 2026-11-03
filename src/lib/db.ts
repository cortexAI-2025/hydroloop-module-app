import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { BatchRecord } from '@/types/batch';
import { sanitizeOwner } from './owner-id';

/**
 * Stockage local (IndexedDB), une base par utilisateur :
 * - `hydroloop-db`            → mode sans authentification (propriétaire « local », compatible avec les versions précédentes)
 * - `hydroloop-db--<user>`    → un utilisateur connecté (isolation des données sur un appareil partagé)
 *
 * Version 2 : ajout des magasins `meta` (curseur de synchro…), `snapshots` (sauvegardes automatiques) et `settings`.
 */

export const DB_BASE_NAME = 'hydroloop-db';
export const DB_VERSION = 2;
const SNAPSHOT_KEEP = 7;

export interface SnapshotRow {
  id?: number;
  createdAt: string;
  reason: string;
  count: number;
  /** JSON.stringify(BatchRecord[]) */
  payload: string;
}

interface HydroLoopDB extends DBSchema {
  batches: {
    key: string;
    value: BatchRecord;
    indexes: { 'by-strain': string; 'by-date': string };
  };
  meta: { key: string; value: unknown };
  settings: { key: string; value: unknown };
  snapshots: { key: number; value: SnapshotRow; indexes: { 'by-date': string } };
}

export class StorageError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'StorageError';
  }
}

let owner = 'local';
let dbPromise: Promise<IDBPDatabase<HydroLoopDB>> | null = null;

export { sanitizeOwner };

export function dbNameFor(o: string): string {
  return o === 'local' ? DB_BASE_NAME : `${DB_BASE_NAME}--${o}`;
}

export const getDbOwner = (): string => owner;

/** Choisit la base de l'utilisateur courant. À appeler avant toute lecture/écriture. */
export function setDbOwner(name: string): void {
  const next = sanitizeOwner(name);
  if (next === owner && dbPromise) return;
  owner = next;
  if (dbPromise) {
    void dbPromise.then((d) => d.close()).catch(() => undefined);
    dbPromise = null;
  }
}

function open(name: string): Promise<IDBPDatabase<HydroLoopDB>> {
  return openDB<HydroLoopDB>(name, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const store = db.createObjectStore('batches', { keyPath: 'id' });
        store.createIndex('by-strain', 'data.SOUCHE' as never);
        store.createIndex('by-date', 'createdAt' as never);
      }
      if (oldVersion < 2) {
        db.createObjectStore('meta');
        db.createObjectStore('settings');
        const snaps = db.createObjectStore('snapshots', { keyPath: 'id', autoIncrement: true });
        snaps.createIndex('by-date', 'createdAt');
      }
    },
    blocked() {
      // Un autre onglet garde l'ancienne version ouverte : la mise à jour attendra sa fermeture.
      console.warn('[HydroLoop] Mise à jour de la base locale en attente : fermez les autres onglets.');
    },
    blocking() {
      // Un autre onglet demande une mise à jour : on libère la connexion.
      void dbPromise?.then((d) => d.close());
      dbPromise = null;
    },
    terminated() {
      dbPromise = null;
    },
  });
}

function getDB(): Promise<IDBPDatabase<HydroLoopDB>> {
  if (!dbPromise) {
    dbPromise = open(dbNameFor(owner)).catch((e) => {
      dbPromise = null;
      throw new StorageError('Stockage local indisponible (navigation privée ou stockage bloqué ?).', e);
    });
  }
  return dbPromise;
}

function wrapWrite<T>(p: Promise<T>): Promise<T> {
  return p.catch((e: unknown) => {
    const name = (e as { name?: string })?.name;
    if (name === 'QuotaExceededError') throw new StorageError('Espace de stockage plein : exportez une sauvegarde puis libérez de la place.', e);
    throw new StorageError('Échec de l\'écriture locale.', e);
  });
}

// ── batches ──────────────────────────────────────────────────────────────────

export async function dbGetAll(): Promise<BatchRecord[]> {
  return (await getDB()).getAll('batches');
}

export async function dbGet(id: string): Promise<BatchRecord | undefined> {
  return (await getDB()).get('batches', id);
}

export async function dbPut(record: BatchRecord): Promise<void> {
  const db = await getDB();
  await wrapWrite(db.put('batches', record).then(() => undefined));
}

/** Écrit plusieurs enregistrements dans une seule transaction : tout ou rien. */
export async function dbPutMany(records: BatchRecord[]): Promise<void> {
  if (records.length === 0) return;
  const db = await getDB();
  const tx = db.transaction('batches', 'readwrite');
  await wrapWrite(Promise.all([...records.map((r) => tx.store.put(r)), tx.done]).then(() => undefined));
}

// ── meta / settings ──────────────────────────────────────────────────────────

export async function metaGet<T = unknown>(key: string): Promise<T | undefined> {
  return (await (await getDB()).get('meta', key)) as T | undefined;
}

export async function metaSet(key: string, value: unknown): Promise<void> {
  const db = await getDB();
  await wrapWrite(db.put('meta', value, key).then(() => undefined));
}

export async function settingGet<T = unknown>(key: string): Promise<T | undefined> {
  return (await (await getDB()).get('settings', key)) as T | undefined;
}

export async function settingSet(key: string, value: unknown): Promise<void> {
  const db = await getDB();
  await wrapWrite(db.put('settings', value, key).then(() => undefined));
}

// ── snapshots (sauvegardes automatiques locales) ─────────────────────────────

export async function snapshotAdd(reason: string, records: BatchRecord[], now: Date = new Date()): Promise<number> {
  const db = await getDB();
  const row: SnapshotRow = { createdAt: now.toISOString(), reason, count: records.length, payload: JSON.stringify(records) };
  const id = await wrapWrite(db.add('snapshots', row));
  const all = await db.getAllKeys('snapshots');
  const excess = all.length - SNAPSHOT_KEEP;
  for (let i = 0; i < excess; i++) await db.delete('snapshots', all[i]);
  return id as number;
}

export async function snapshotList(): Promise<Omit<SnapshotRow, 'payload'>[]> {
  const rows = await (await getDB()).getAll('snapshots');
  return rows.map(({ payload: _p, ...rest }) => { void _p; return rest; }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function snapshotGet(id: number): Promise<BatchRecord[] | undefined> {
  const row = await (await getDB()).get('snapshots', id);
  return row ? (JSON.parse(row.payload) as BatchRecord[]) : undefined;
}

export async function snapshotLatestAt(): Promise<string | undefined> {
  const list = await snapshotList();
  return list[0]?.createdAt;
}

// ── lecture de la base « héritée » (mode sans authentification) ──────────────

/** Nombre de batches dans la base locale sans propriétaire, sans changer de base courante. */
export async function legacyBatchCount(): Promise<number> {
  if (owner === 'local' || typeof indexedDB === 'undefined') return 0;
  try {
    const exists = typeof indexedDB.databases === 'function' ? (await indexedDB.databases()).some((d) => d.name === DB_BASE_NAME) : true;
    if (!exists) return 0;
    const db = await open(DB_BASE_NAME);
    try {
      return await db.count('batches');
    } finally {
      db.close();
    }
  } catch {
    return 0;
  }
}

export async function legacyBatches(): Promise<BatchRecord[]> {
  if (owner === 'local') return [];
  const db = await open(DB_BASE_NAME);
  try {
    return await db.getAll('batches');
  } finally {
    db.close();
  }
}

/** Ferme la connexion courante (tests, changement de compte). */
export async function closeDb(): Promise<void> {
  const p = dbPromise;
  dbPromise = null;
  if (p) (await p.catch(() => null))?.close();
}

/** Estimation de l'espace utilisé (si le navigateur l'expose). */
export async function storageEstimate(): Promise<{ usage?: number; quota?: number; persisted?: boolean }> {
  if (typeof navigator === 'undefined' || !navigator.storage) return {};
  const [est, persisted] = await Promise.all([
    navigator.storage.estimate?.().catch(() => undefined),
    navigator.storage.persisted?.().catch(() => undefined),
  ]);
  return { usage: est?.usage, quota: est?.quota, persisted };
}

/**
 * Demande au navigateur de ne pas évincer le stockage (Android peut vider IndexedDB sous pression mémoire).
 * Retourne true si le stockage est désormais protégé.
 */
export async function requestPersistence(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

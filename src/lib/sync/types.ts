import type { BatchRecord } from '@/types/batch';

/** Version distante d'un batch : contenu + révision cloud + horodatage serveur. */
export interface RemoteBatch {
  record: BatchRecord;
  rev: number;
  /** Horodatage posé par le serveur (pas par l'appareil) : sert de curseur de synchro. */
  serverUpdatedAt: string;
}

export type InsertResult = { status: 'ok'; remote: RemoteBatch } | { status: 'duplicate' };
export type UpdateResult = { status: 'ok'; remote: RemoteBatch } | { status: 'conflict' };

/**
 * Magasin distant (Supabase en production, mémoire dans les tests).
 * Contrat : `insert` échoue (`duplicate`) si l'id existe ; `update` n'écrit que si la révision distante
 * est exactement `expectedRev` (comparaison atomique) et la porte alors à `expectedRev + 1`.
 */
export interface RemoteStore {
  fetchSince(cursor: string | null): Promise<RemoteBatch[]>;
  fetchOne(id: string): Promise<RemoteBatch | null>;
  insert(record: BatchRecord): Promise<InsertResult>;
  update(record: BatchRecord, expectedRev: number): Promise<UpdateResult>;
}

/** Magasin local utilisé par le moteur (IndexedDB en production, mémoire dans les tests). */
export interface LocalStore {
  all(): Promise<BatchRecord[]>;
  get(id: string): Promise<BatchRecord | undefined>;
  put(record: BatchRecord): Promise<void>;
  getMeta(key: string): Promise<unknown>;
  setMeta(key: string, value: unknown): Promise<void>;
}

export interface SyncReport {
  pulled: number;
  pushed: number;
  /** Batches modifiés des deux côtés, fusionnés automatiquement. */
  merged: number;
  conflicts: { id: string; notes: string[] }[];
  failed: { id: string; message: string }[];
  cursor: string | null;
}

export class SyncNetworkError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'SyncNetworkError';
  }
}

/** Jeton refusé (expiré ou invalide) : le moteur de synchro en redemande un puis réessaie. */
export class SyncAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncAuthError';
  }
}

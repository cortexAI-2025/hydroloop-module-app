import type { BatchRecord } from '@/types/batch';
import type { InsertResult, LocalStore, RemoteBatch, RemoteStore, UpdateResult } from './types';
import { SyncNetworkError } from './types';

/** Magasin distant en mémoire : mêmes garanties que la table Supabase (propriétaire, révision, doublon). Tests uniquement. */
export class MemoryRemote implements RemoteStore {
  rows = new Map<string, RemoteBatch>();
  online = true;
  calls = { fetchSince: 0, fetchOne: 0, insert: 0, update: 0 };
  /** Appelé juste avant une écriture : permet de simuler un autre appareil qui écrit en même temps. */
  beforeWrite?: () => void;
  private clock = 0;
  constructor(public readonly owner: string, private readonly shared: Map<string, Map<string, RemoteBatch>> = new Map()) {
    if (!this.shared.has(owner)) this.shared.set(owner, new Map());
    this.rows = this.shared.get(owner)!;
  }

  private check() { if (!this.online) throw new SyncNetworkError('hors ligne'); }
  private tick(): string { return new Date(Date.UTC(2026, 0, 1) + ++MemoryRemote.globalClock * 1000).toISOString(); }
  static globalClock = 0;

  async fetchSince(cursor: string | null) {
    this.check(); this.calls.fetchSince++;
    return [...this.rows.values()].filter((r) => !cursor || r.serverUpdatedAt >= cursor).sort((a, b) => a.serverUpdatedAt.localeCompare(b.serverUpdatedAt)).map(clone);
  }
  async fetchOne(id: string) { this.check(); this.calls.fetchOne++; const r = this.rows.get(id); return r ? clone(r) : null; }
  async insert(record: BatchRecord): Promise<InsertResult> {
    this.check(); this.calls.insert++; this.beforeWrite?.();
    if (this.rows.has(record.id)) return { status: 'duplicate' };
    const remote: RemoteBatch = { record: JSON.parse(JSON.stringify(record)), rev: 1, serverUpdatedAt: this.tick() };
    this.rows.set(record.id, remote);
    return { status: 'ok', remote: clone(remote) };
  }
  async update(record: BatchRecord, expectedRev: number): Promise<UpdateResult> {
    this.check(); this.calls.update++; this.beforeWrite?.();
    const cur = this.rows.get(record.id);
    if (!cur || cur.rev !== expectedRev) return { status: 'conflict' };
    const remote: RemoteBatch = { record: JSON.parse(JSON.stringify(record)), rev: expectedRev + 1, serverUpdatedAt: this.tick() };
    this.rows.set(record.id, remote);
    return { status: 'ok', remote: clone(remote) };
  }
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export class MemoryLocal implements LocalStore {
  rows = new Map<string, BatchRecord>();
  meta = new Map<string, unknown>();
  async all() { return [...this.rows.values()].map(clone); }
  async get(id: string) { const r = this.rows.get(id); return r ? clone(r) : undefined; }
  async put(r: BatchRecord) { this.rows.set(r.id, clone(r)); }
  async getMeta(k: string) { return this.meta.get(k); }
  async setMeta(k: string, v: unknown) { this.meta.set(k, v); }
}

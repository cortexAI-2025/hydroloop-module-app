import type { SupabaseClient } from '@supabase/supabase-js';
import type { BatchRecord } from '@/types/batch';
import { fromRow, toRow } from './rows';
import type { BatchRow } from './rows';
import type { InsertResult, RemoteBatch, RemoteStore, UpdateResult } from './types';
import { SyncAuthError, SyncNetworkError } from './types';

const PAGE = 500;

interface PgError { message?: string; code?: string; status?: number; details?: string }

function classify(err: PgError): Error {
  const msg = `${err.message ?? ''} ${err.details ?? ''}`;
  if (err.status === 401 || err.status === 403 || /JWT|jwt|expired|permission denied|row-level security/i.test(msg)) {
    return new SyncAuthError(err.message || 'Accès cloud refusé');
  }
  if (!err.code && /fetch|network|timeout|ECONN|offline|Load failed/i.test(msg)) return new SyncNetworkError(err.message || 'Réseau indisponible', err);
  if (!err.code && !err.status) return new SyncNetworkError(err.message || 'Réseau indisponible', err);
  return new Error(err.message || `Erreur cloud ${err.code ?? ''}`);
}

/** Implémentation Supabase du magasin distant. L'isolation entre utilisateurs est garantie par les politiques RLS (voir SQL). */
export class SupabaseRemote implements RemoteStore {
  constructor(private readonly client: SupabaseClient, private readonly owner: string) {}

  async fetchSince(cursor: string | null): Promise<RemoteBatch[]> {
    const out: RemoteBatch[] = [];
    for (let from = 0; ; from += PAGE) {
      let q = this.client.from('batches').select('*').eq('owner_id', this.owner);
      if (cursor) q = q.gte('server_updated_at', cursor);
      const { data, error } = await q.order('server_updated_at', { ascending: true }).order('id', { ascending: true }).range(from, from + PAGE - 1);
      if (error) throw classify(error as PgError);
      const rows = (data ?? []) as BatchRow[];
      out.push(...rows.map(fromRow));
      if (rows.length < PAGE) return out;
    }
  }

  async fetchOne(id: string): Promise<RemoteBatch | null> {
    const { data, error } = await this.client.from('batches').select('*').eq('owner_id', this.owner).eq('id', id).maybeSingle();
    if (error) throw classify(error as PgError);
    return data ? fromRow(data as BatchRow) : null;
  }

  async insert(record: BatchRecord): Promise<InsertResult> {
    const { data, error } = await this.client.from('batches').insert(toRow(record, this.owner, 1)).select().single();
    if (error) {
      if ((error as PgError).code === '23505') return { status: 'duplicate' };
      throw classify(error as PgError);
    }
    return { status: 'ok', remote: fromRow(data as BatchRow) };
  }

  async update(record: BatchRecord, expectedRev: number): Promise<UpdateResult> {
    const { owner_id: _o, id: _i, ...patch } = toRow(record, this.owner, expectedRev + 1);
    void _o; void _i;
    const { data, error } = await this.client
      .from('batches')
      .update(patch)
      .eq('owner_id', this.owner)
      .eq('id', record.id)
      .eq('rev', expectedRev) // comparaison-échange atomique : 0 ligne modifiée = quelqu'un a écrit entre-temps
      .select();
    if (error) throw classify(error as PgError);
    const rows = (data ?? []) as BatchRow[];
    if (rows.length === 0) return { status: 'conflict' };
    return { status: 'ok', remote: fromRow(rows[0]) };
  }
}

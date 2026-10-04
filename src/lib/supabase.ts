import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/*
  Setup Supabase (optional — app works without it):
  1. Create a free project at https://supabase.com
  2. In the SQL editor, run:
     ─────────────────────────────────────────────
     CREATE TABLE batches (
       id         TEXT PRIMARY KEY,
       data       JSONB        NOT NULL,
       report     TEXT,
       tracking   JSONB,
       created_at TIMESTAMPTZ  NOT NULL,
       updated_at TIMESTAMPTZ  NOT NULL
     );
     ─────────────────────────────────────────────
  3. Add to .env.local:
       NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
       NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
*/

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (typeof window === 'undefined') return null;
  if (_client) return _client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  _client = createClient(url, key);
  return _client;
}

export const isCloudEnabled = (): boolean =>
  !!(
    typeof window !== 'undefined' &&
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

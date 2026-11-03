import { getToken } from 'next-auth/jwt';
import type { NextRequest } from 'next/server';
import { authEnabled } from '@/lib/auth-config';
import { signJwtHS256 } from '@/lib/jwt';

export const dynamic = 'force-dynamic';

const TTL_SECONDS = 3600;

/**
 * Émet un jeton court (1 h) que Supabase accepte : rôle `authenticated`, `sub` = identifiant de l'utilisateur connecté.
 * Les politiques RLS comparent `owner_id` à ce `sub` : un utilisateur ne peut lire/écrire que ses propres batches,
 * même avec la clé publique `anon` (qui, elle, n'a aucun droit sur la table).
 */
export async function GET(request: NextRequest) {
  const noStore = { 'Cache-Control': 'no-store' };
  if (!authEnabled()) {
    return Response.json({ error: 'sync_requires_auth', message: 'La synchronisation cloud exige l\'authentification (AUTH_USERS).' }, { status: 503, headers: noStore });
  }
  const jwtSecret = process.env.SUPABASE_JWT_SECRET;
  if (!jwtSecret) {
    return Response.json({ error: 'sync_not_configured', message: 'SUPABASE_JWT_SECRET n\'est pas défini sur le serveur.' }, { status: 503, headers: noStore });
  }
  const session = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!session?.sub) return Response.json({ error: 'unauthorized' }, { status: 401, headers: noStore });

  const now = Math.floor(Date.now() / 1000);
  const token = signJwtHS256({ aud: 'authenticated', role: 'authenticated', sub: session.sub, iat: now, exp: now + TTL_SECONDS }, jwtSecret);
  return Response.json({ token, expiresAt: (now + TTL_SECONDS) * 1000, owner: session.sub }, { headers: noStore });
}

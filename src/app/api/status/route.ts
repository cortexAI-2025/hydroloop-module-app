import { authEnabled } from '@/lib/auth-env';

export const dynamic = 'force-dynamic';

/** État de configuration du serveur (sans divulguer de secret). */
export function GET() {
  const auth = authEnabled();
  return Response.json({
    ai: !!process.env.ANTHROPIC_API_KEY,
    model: process.env.ANTHROPIC_MODEL || 'claude-opus-5-5',
    auth,
    cloud: !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_JWT_SECRET && auth),
    /** Connexion activée sans NEXTAUTH_SECRET en production : personne ne pourra se connecter. */
    authMisconfigured: auth && !process.env.NEXTAUTH_SECRET && process.env.NODE_ENV === 'production',
  });
}

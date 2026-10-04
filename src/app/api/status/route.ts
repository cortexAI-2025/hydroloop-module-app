export const dynamic = 'force-dynamic';

/** État de configuration du serveur (sans divulguer de secret). */
export function GET() {
  return Response.json({
    ai: !!process.env.ANTHROPIC_API_KEY,
    model: process.env.ANTHROPIC_MODEL || 'claude-opus-5-5',
    auth: !!(process.env.AUTH_USERNAME && process.env.AUTH_PASSWORD),
    /** Connexion activée sans NEXTAUTH_SECRET en production : personne ne pourra se connecter. */
    authMisconfigured:
      !!(process.env.AUTH_USERNAME && process.env.AUTH_PASSWORD) &&
      !process.env.NEXTAUTH_SECRET &&
      process.env.NODE_ENV === 'production',
  });
}

import NextAuth from 'next-auth';
import { authEnabled } from '@/lib/auth-config';
import { authOptions } from '@/lib/auth-options';

const handler = NextAuth(authOptions);

/**
 * Authentification désactivée (aucun compte configuré) : on répond « pas de session » au lieu de laisser
 * NextAuth échouer faute de secret.
 */
function disabled(request: Request): Response {
  const path = new URL(request.url).pathname;
  if (path.endsWith('/session')) return Response.json({});
  if (path.endsWith('/csrf')) return Response.json({ csrfToken: '' });
  if (path.endsWith('/providers')) return Response.json({});
  return Response.json({ error: 'Authentification désactivée' }, { status: 404 });
}

type Ctx = { params: Promise<{ nextauth: string[] }> };

export async function GET(request: Request, ctx: Ctx) {
  return authEnabled() ? handler(request, ctx) : disabled(request);
}

export async function POST(request: Request, ctx: Ctx) {
  return authEnabled() ? handler(request, ctx) : disabled(request);
}

import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import type { NextAuthOptions } from 'next-auth';
import { timingSafeEqual } from 'node:crypto';

const USERNAME = process.env.AUTH_USERNAME;
const PASSWORD = process.env.AUTH_PASSWORD;
const AUTH_ENABLED = !!(USERNAME && PASSWORD);

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'HydroLoop',
      credentials: {
        username: { label: 'Utilisateur', type: 'text', placeholder: 'admin' },
        password: { label: 'Mot de passe', type: 'password' },
      },
      async authorize(credentials) {
        if (!AUTH_ENABLED || !credentials?.username || !credentials.password) return null;
        if (safeEqual(credentials.username, USERNAME!) && safeEqual(credentials.password, PASSWORD!)) {
          return { id: '1', name: credentials.username, email: `${credentials.username}@hydroloop.local` };
        }
        return null;
      },
    }),
  ],
  pages: { signIn: '/login' },
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },
  secret:
    process.env.NEXTAUTH_SECRET ||
    (process.env.NODE_ENV === 'development' ? 'dev-only-secret' : undefined),
};

const handler = NextAuth(authOptions);

/**
 * Authentification désactivée (AUTH_USERNAME / AUTH_PASSWORD absents) :
 * on répond « pas de session » au lieu de laisser NextAuth échouer faute de secret.
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
  return AUTH_ENABLED ? handler(request, ctx) : disabled(request);
}

export async function POST(request: Request, ctx: Ctx) {
  return AUTH_ENABLED ? handler(request, ctx) : disabled(request);
}

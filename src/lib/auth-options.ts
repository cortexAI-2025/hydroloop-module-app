import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { authEnabled, authenticate } from './auth-config';
import { FailureLimiter } from './rate-limit';

export const loginLimiter = new FailureLimiter(5, 15 * 60_000);

const firstIp = (headers: unknown): string => {
  const h = headers as Record<string, string | string[] | undefined> | undefined;
  const v = h?.['x-forwarded-for'] ?? h?.['x-real-ip'];
  return (Array.isArray(v) ? v[0] : v)?.split(',')[0].trim() || 'unknown';
};

export const sessionMaxAgeSeconds = (env: Record<string, string | undefined> = process.env): number => {
  const h = Number(env.SESSION_MAX_AGE_HOURS);
  return Number.isFinite(h) && h >= 1 ? Math.floor(h * 3600) : 14 * 24 * 3600;
};

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'HydroLoop',
      credentials: {
        username: { label: 'Utilisateur', type: 'text' },
        password: { label: 'Mot de passe', type: 'password' },
      },
      async authorize(credentials, req) {
        if (!authEnabled() || !credentials?.username || !credentials.password) return null;
        const key = `${firstIp(req?.headers)}|${credentials.username.toLowerCase()}`;
        if (loginLimiter.isLocked(key)) return null;
        const user = authenticate(credentials.username, credentials.password);
        if (!user) { loginLimiter.fail(key); return null; }
        loginLimiter.success(key);
        return { id: user.id, name: user.name };
      },
    }),
  ],
  pages: { signIn: '/login' },
  session: { strategy: 'jwt', maxAge: sessionMaxAgeSeconds() },
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub;
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET || (process.env.NODE_ENV === 'development' ? 'dev-only-secret' : undefined),
};

import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import type { NextAuthOptions } from 'next-auth';

const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'HydroLoop',
      credentials: {
        username: { label: 'Utilisateur', type: 'text', placeholder: 'admin' },
        password: { label: 'Mot de passe', type: 'password' },
      },
      async authorize(credentials) {
        if (
          credentials?.username === process.env.AUTH_USERNAME &&
          credentials?.password === process.env.AUTH_PASSWORD
        ) {
          return {
            id: '1',
            name: credentials!.username,
            email: `${credentials!.username}@hydroloop.local`,
          };
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
export { handler as GET, handler as POST };

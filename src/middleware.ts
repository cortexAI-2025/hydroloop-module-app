import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { authEnabled } from '@/lib/auth-env';

/** Ressources nécessaires au chargement hors ligne / à l'installation : jamais derrière la connexion. */
const ALWAYS_PUBLIC = [
  '/login', '/api/auth', '/_next', '/favicon.ico', '/manifest.webmanifest', '/sw.js', '/icon.svg', '/icons/', '/offline.html',
];

const isPublic = (path: string) => ALWAYS_PUBLIC.some((p) => path.startsWith(p));

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const production = process.env.NODE_ENV === 'production';
  const enabled = authEnabled();

  // Sécurisé par défaut : en production, sans comptes configurés, l'application refuse de servir (sauf choix explicite).
  if (!enabled) {
    if (production && process.env.ALLOW_ANONYMOUS !== 'true') {
      const msg = 'Application non configurée : définissez AUTH_USERS (comptes) ou, pour un usage local sans compte, ALLOW_ANONYMOUS=true.';
      return pathname.startsWith('/api/')
        ? NextResponse.json({ error: msg }, { status: 503 })
        : new NextResponse(`<!doctype html><meta charset="utf-8"><title>HydroLoop — configuration requise</title><p style="font-family:sans-serif;max-width:40rem;margin:3rem auto">${msg}</p>`, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    return NextResponse.next();
  }

  const secret = process.env.NEXTAUTH_SECRET || (process.env.NODE_ENV === 'development' ? 'dev-only-secret' : '');
  if (!secret) return NextResponse.json({ error: 'NEXTAUTH_SECRET manquant : connexion impossible.' }, { status: 503 });

  const token = await getToken({ req: request, secret });
  if (!token && pathname.startsWith('/api/')) return NextResponse.json({ error: 'Authentification requise.' }, { status: 401 });
  if (!token) {
    const url = new URL('/login', request.url);
    url.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};

import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

const ALWAYS_PUBLIC = [
  '/login',
  '/api/auth',
  '/_next',
  '/favicon.ico',
  '/manifest.webmanifest',
  '/sw.js',
  '/icon.svg',
];

function isPublic(path: string) {
  return ALWAYS_PUBLIC.some((p) => path.startsWith(p));
}

export async function middleware(request: NextRequest) {
  // Auth is opt-in: skip entirely if env vars are absent
  if (!process.env.AUTH_USERNAME || !process.env.AUTH_PASSWORD) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const secret =
    process.env.NEXTAUTH_SECRET ||
    (process.env.NODE_ENV === 'development' ? 'dev-only-secret' : '');

  const token = await getToken({ req: request, secret });
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

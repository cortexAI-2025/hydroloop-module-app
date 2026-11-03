import { createHmac, timingSafeEqual } from 'node:crypto';

/** JWT HS256 minimal (serveur uniquement) — suffisant pour émettre le jeton court que Supabase vérifie. */

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export interface JwtClaims { [k: string]: unknown; sub?: string; exp?: number; iat?: number }

export function signJwtHS256(claims: JwtClaims, secret: string): string {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(claims));
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest();
  return `${head}.${body}.${b64url(sig)}`;
}

/** Vérifie signature et expiration ; retourne les claims, ou null si invalide. */
export function verifyJwtHS256(token: string, secret: string, nowSec = Math.floor(Date.now() / 1000)): JwtClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts;
  try {
    if (JSON.parse(Buffer.from(head, 'base64url').toString()).alg !== 'HS256') return null;
    const expected = createHmac('sha256', secret).update(`${head}.${body}`).digest();
    const given = Buffer.from(sig, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString()) as JwtClaims;
    if (typeof claims.exp !== 'number' || claims.exp <= nowSec) return null;
    return claims;
  } catch {
    return null;
  }
}

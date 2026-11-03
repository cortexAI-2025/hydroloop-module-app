import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { authEnabled, loadUsers } from './auth-env';
import type { AuthUser } from './auth-env';

/**
 * Configuration de l'authentification (serveur uniquement).
 *
 *   AUTH_USERS="alice:motdepasse,bob:scrypt$<sel>$<hash>"   plusieurs comptes ; mot de passe en clair OU haché (recommandé)
 *   AUTH_USERNAME / AUTH_PASSWORD                            compte unique (compatibilité)
 *
 * Générer un hachage : `npm run auth:hash -- "mon mot de passe"`
 */

export { authEnabled, loadUsers };
export type { AuthUser };

export function hashPassword(password: string, salt: Buffer = randomBytes(16)): string {
  return `scrypt$${salt.toString('hex')}$${scryptSync(password, salt, 32).toString('hex')}`;
}

const DUMMY = hashPassword('dummy-password-for-constant-time', Buffer.alloc(16, 1));

/** Compare un mot de passe à un secret (haché `scrypt$…` ou en clair), en temps constant. */
export function verifyPassword(secret: string, candidate: string): boolean {
  if (secret.startsWith('scrypt$')) {
    const [, saltHex, hashHex] = secret.split('$');
    if (!saltHex || !hashHex) return false;
    const expected = Buffer.from(hashHex, 'hex');
    const actual = scryptSync(candidate, Buffer.from(saltHex, 'hex'), expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
  const a = Buffer.from(secret), b = Buffer.from(candidate);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Retourne l'utilisateur si les identifiants sont bons. Effectue toujours un calcul de hachage (pas de fuite par le temps de réponse). */
export function authenticate(username: string, password: string, users: AuthUser[] = loadUsers()): AuthUser | null {
  const user = users.find((u) => u.name.toLowerCase() === username.trim().toLowerCase());
  const ok = verifyPassword(user?.secret ?? DUMMY, password);
  return user && ok ? user : null;
}

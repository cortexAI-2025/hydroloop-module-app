import { sanitizeOwner } from './owner-id';

/** Lecture de la configuration des comptes — sans dépendance Node, utilisable par le middleware (runtime Edge). */

export interface AuthUser { name: string; id: string; secret: string }

export function loadUsers(env: Record<string, string | undefined> = process.env): AuthUser[] {
  const out: AuthUser[] = [];
  const add = (name: string, secret: string) => {
    name = name.trim();
    if (!name || !secret) return;
    const id = sanitizeOwner(name);
    if (id === 'local' || out.some((u) => u.id === id)) return; // « local » est réservé au mode sans compte
    out.push({ name, id, secret });
  };
  for (const part of (env.AUTH_USERS ?? '').split(',')) {
    const i = part.indexOf(':');
    if (i > 0) add(part.slice(0, i), part.slice(i + 1).trim());
  }
  if (env.AUTH_USERNAME && env.AUTH_PASSWORD) add(env.AUTH_USERNAME, env.AUTH_PASSWORD);
  return out;
}

export const authEnabled = (env: Record<string, string | undefined> = process.env): boolean => loadUsers(env).length > 0;


import { describe, expect, it } from 'vitest';
import { signJwtHS256, verifyJwtHS256 } from './jwt';
import { FailureLimiter, WindowLimiter } from './rate-limit';
import { authenticate, authEnabled, hashPassword, loadUsers, verifyPassword } from './auth-config';
import { sanitizeOwner } from './owner-id';

describe('JWT HS256', () => {
  const now = 1_800_000_000;
  const tok = signJwtHS256({ sub: 'alice', exp: now + 3600 }, 'secret-de-test');
  it('accepte un jeton valide', () => expect(verifyJwtHS256(tok, 'secret-de-test', now)!.sub).toBe('alice'));
  it('refuse un mauvais secret', () => expect(verifyJwtHS256(tok, 'autre', now)).toBeNull());
  it('refuse un jeton expiré', () => expect(verifyJwtHS256(tok, 'secret-de-test', now + 3601)).toBeNull());
  it('refuse un jeton falsifié', () => {
    const [h, , s] = tok.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'bob', exp: now + 3600 })).toString('base64url');
    expect(verifyJwtHS256(`${h}.${forged}.${s}`, 'secret-de-test', now)).toBeNull();
  });
  it('refuse alg=none et les jetons mal formés', () => {
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{"sub":"x","exp":9999999999}').toString('base64url')}.`;
    expect(verifyJwtHS256(none, 'secret-de-test', now)).toBeNull();
    expect(verifyJwtHS256('abc', 'secret-de-test', now)).toBeNull();
  });
});

describe('limiteurs', () => {
  it('WindowLimiter bloque au-delà du maximum puis libère après la fenêtre', () => {
    const l = new WindowLimiter(3, 1000);
    expect([1, 2, 3].map(() => l.hit('k', 0).allowed)).toEqual([true, true, true]);
    const r = l.hit('k', 10);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThan(0);
    expect(l.hit('autre', 10).allowed).toBe(true);
    expect(l.hit('k', 1500).allowed).toBe(true);
  });
  it('FailureLimiter verrouille après 5 échecs et se déverrouille', () => {
    const f = new FailureLimiter(5, 1000);
    for (let i = 0; i < 4; i++) f.fail('u', 0);
    expect(f.isLocked('u', 1)).toBe(false);
    f.fail('u', 1);
    expect(f.isLocked('u', 2)).toBe(true);
    expect(f.isLocked('u', 2000)).toBe(false);
    f.fail('v', 0); f.success('v');
    for (let i = 0; i < 4; i++) f.fail('v', 0);
    expect(f.isLocked('v', 1)).toBe(false);
  });
});

describe('authentification', () => {
  const env = { AUTH_USERS: 'Alice:mdp-alice,bob:' + hashPassword('mdp-bob') };
  const users = loadUsers(env);
  it('charge plusieurs comptes (clair et haché)', () => expect(users.map((u) => u.id)).toEqual(['alice', 'bob']));
  it('authentifie avec le bon mot de passe, insensible à la casse du nom', () => {
    expect(authenticate('alice', 'mdp-alice', users)?.id).toBe('alice');
    expect(authenticate('BOB', 'mdp-bob', users)?.id).toBe('bob');
  });
  it('refuse un mauvais mot de passe ou un compte inconnu', () => {
    expect(authenticate('alice', 'faux', users)).toBeNull();
    expect(authenticate('bob', 'mdp-alice', users)).toBeNull();
    expect(authenticate('inconnu', 'x', users)).toBeNull();
  });
  it('rejette un secret haché mal formé', () => expect(verifyPassword('scrypt$$', 'x')).toBe(false));
  it('l’authentification est désactivée sans compte ; compte historique pris en charge', () => {
    expect(authEnabled({})).toBe(false);
    expect(authEnabled({ AUTH_USERNAME: 'a', AUTH_PASSWORD: 'b' })).toBe(true);
  });
  it('le nom « local » est réservé et les doublons ignorés', () => {
    expect(loadUsers({ AUTH_USERS: 'local:x,a:1,A:2' }).map((u) => u.id)).toEqual(['a']);
  });
  it('les identifiants de propriétaire sont assainis', () => {
    expect(sanitizeOwner('A/../B c')).toMatch(/^[a-z0-9._-]+$/);
  });
});

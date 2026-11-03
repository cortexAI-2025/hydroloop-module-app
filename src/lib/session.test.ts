import { describe, expect, it } from 'vitest';
import { sessionMaxAgeSeconds, authOptions, loginLimiter } from './auth-options';
import { hashPassword } from './auth-config';

describe('sessions', () => {
  it('durée par défaut 14 jours, configurable, bornée à ≥ 1 h', () => {
    expect(sessionMaxAgeSeconds({})).toBe(14 * 86400);
    expect(sessionMaxAgeSeconds({ SESSION_MAX_AGE_HOURS: '8' })).toBe(8 * 3600);
    expect(sessionMaxAgeSeconds({ SESSION_MAX_AGE_HOURS: '0' })).toBe(14 * 86400);
    expect(sessionMaxAgeSeconds({ SESSION_MAX_AGE_HOURS: 'abc' })).toBe(14 * 86400);
  });

  it('stratégie JWT, page de connexion dédiée, identifiant utilisateur propagé à la session', async () => {
    expect(authOptions.session?.strategy).toBe('jwt');
    expect(authOptions.pages?.signIn).toBe('/login');
    const tok = await authOptions.callbacks!.jwt!({ token: {}, user: { id: 'alice', name: 'Alice' } } as never);
    expect((tok as { sub?: string }).sub).toBe('alice');
    const s = await authOptions.callbacks!.session!({ session: { user: { name: 'Alice' }, expires: '' }, token: { sub: 'alice' } } as never);
    expect((s as { user: { id: string } }).user.id).toBe('alice');
  });
});

describe('authorize : verrouillage anti force brute', () => {
  const authorize = (authOptions.providers[0] as unknown as { options: { authorize: (c: unknown, r: unknown) => Promise<unknown> } }).options.authorize;
  const req = { headers: { 'x-forwarded-for': '203.0.113.9' } };

  it('verrouille après 5 échecs, même avec le bon mot de passe, et n’affecte pas les autres comptes', async () => {
    process.env.AUTH_USERS = `alice:${hashPassword('bon-mdp')},bob:autre`;
    const bad = { username: 'alice', password: 'faux' };
    for (let i = 0; i < 5; i++) expect(await authorize(bad, req)).toBeNull();
    expect(await authorize({ username: 'alice', password: 'bon-mdp' }, req)).toBeNull(); // verrouillé
    expect(await authorize({ username: 'bob', password: 'autre' }, req)).toMatchObject({ id: 'bob' });
    expect(await authorize({ username: 'alice', password: 'bon-mdp' }, { headers: { 'x-forwarded-for': '198.51.100.1' } })).toMatchObject({ id: 'alice' }); // autre IP
    loginLimiter.success('203.0.113.9|alice');
    delete process.env.AUTH_USERS;
  });
});

#!/usr/bin/env node
// Lance une instance de RECETTE locale pour tester la PWA sur un téléphone Android : build de production + faux Supabase.
// Aucune donnée réelle, aucun service externe, aucune production. Comptes de test : alice / pw-alice-test, bob / pw-bob-test.
//   node scripts/recette-android.mjs            → puis suivre les instructions affichées (adb reverse, Chrome sur le téléphone)
//   RECETTE_SKIP_BUILD=1 node scripts/recette-android.mjs   → réutilise le dernier build de recette
import { spawn, spawnSync } from 'node:child_process';

const PORT = 3100, MOCK = 3199;
const env = {
  ...process.env,
  AUTH_USERS: 'alice:pw-alice-test,bob:pw-bob-test',
  NEXTAUTH_SECRET: 'recette-nextauth-secret-local',
  NEXTAUTH_URL: `http://localhost:${PORT}`,
  SUPABASE_JWT_SECRET: 'e2e-supabase-jwt-secret',
  NEXT_PUBLIC_SUPABASE_URL: `http://localhost:${MOCK}`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-test-key',
  ANTHROPIC_API_KEY: '',
  MOCK_PORT: String(MOCK),
  NEXT_TELEMETRY_DISABLED: '1',
};

if (!process.env.RECETTE_SKIP_BUILD) {
  console.log('→ build de production (environnement de recette)…');
  const b = spawnSync('npx', ['next', 'build'], { env, stdio: 'inherit' });
  if (b.status !== 0) process.exit(b.status ?? 1);
}
const procs = [
  spawn('node', ['e2e/mock-supabase.mjs'], { env, stdio: 'inherit' }),
  spawn('npx', ['next', 'start', '-p', String(PORT), '-H', '0.0.0.0'], { env, stdio: 'inherit' }),
];
const stop = () => { for (const p of procs) p.kill('SIGTERM'); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);

console.log(`
══ RECETTE ANDROID — instance locale prête (Ctrl+C pour arrêter) ══
1. Téléphone en USB, débogage USB activé ; sur ce poste :
     adb reverse tcp:${PORT} tcp:${PORT}
     adb reverse tcp:${MOCK} tcp:${MOCK}
2. Sur le téléphone, ouvrir Chrome : http://localhost:${PORT}   (contexte sûr → PWA et service worker actifs)
3. Comptes : alice / pw-alice-test   ·   bob / pw-bob-test
4. Dérouler docs/RECETTE_ANDROID.md (A1…U4). Voir l'état du faux cloud : http://localhost:${MOCK}/__rows
5. Débogage : chrome://inspect sur le poste.
Remarque : sans adb, http://<IP-du-poste>:${PORT} s'ouvre mais Chrome désactive le service worker (hors ligne/installation indisponibles).
`);

import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
const MOCK_PORT = 3199;

// Environnement de test : données fictives, faux Supabase local, aucun service réel.
const env = {
  AUTH_USERS: 'alice:pw-alice-test,bob:pw-bob-test',
  NEXTAUTH_SECRET: 'e2e-nextauth-secret',
  NEXTAUTH_URL: `http://localhost:${PORT}`,
  SUPABASE_JWT_SECRET: 'e2e-supabase-jwt-secret',
  NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-test-key',
  ANTHROPIC_API_KEY: '',
  NEXT_TELEMETRY_DISABLED: '1',
};

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: '**/mobile.spec.ts' },
    { name: 'android', use: { ...devices['Pixel 7'] }, testMatch: '**/mobile.spec.ts' },
  ],
  webServer: [
    { command: 'node e2e/mock-supabase.mjs', url: `http://127.0.0.1:${MOCK_PORT}/__stats`, env: { MOCK_PORT: String(MOCK_PORT) }, reuseExistingServer: false },
    {
      // Les variables NEXT_PUBLIC_* sont figées à la compilation : on compile avec l'environnement de test.
      command: `npx next build && npx next start -p ${PORT}`,
      url: `http://localhost:${PORT}/login`,
      timeout: 300_000,
      env,
      reuseExistingServer: false,
    },
  ],
});

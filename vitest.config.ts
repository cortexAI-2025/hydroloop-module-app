import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Les calculs de jours reposent sur le fuseau local : on fige UTC pour des tests reproductibles.
process.env.TZ = 'UTC';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});

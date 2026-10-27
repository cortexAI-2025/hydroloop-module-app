import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleSpec } from '../src/types/module.ts';

test('dôme annulaire 36', () => {
  const s = moduleSpec({ kind: 'dome-36' });
  assert.deepEqual([s.geometry, s.levels, s.plantsPerLevel, s.plants], ['annular', 3, 12, 36]);
});

test('tunnel : 12, 16, 24, 32 plants par niveau', () => {
  for (const n of [12, 16, 24, 32]) {
    const s = moduleSpec({ kind: 'tunnel', plantsPerLevel: n });
    assert.equal(s.geometry, 'horizontal');
    assert.equal(s.plants, n * 3);
  }
  assert.equal(moduleSpec({ kind: 'tunnel', plantsPerLevel: 24, levels: 4 }).plants, 96);
});

test('tunnel sans paramètres : valeurs par défaut', () => {
  const s = moduleSpec({ kind: 'tunnel' });
  assert.equal(s.plantsPerLevel, 12);
  assert.equal(s.levels, 3);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { detectAlerts } from '../src/types/batch.ts';
import { predictHarvest } from '../src/lib/harvest.ts';

const env = { temperature_air_jour: 25, temperature_air_nuit: 22, humidite_relative: 60, pH: 6, EC: 2.0,
  temperature_solution: 20, debit_NFT: 1, oxygene_dissous: 7, PPFD: 0, photopériode: '' };

test('EC par stade', () => {
  assert.equal(detectAlerts({ ...env, EC: 2.0 }, 2).length, 0);
  assert.equal(detectAlerts({ ...env, EC: 2.0 }, 1).length, 1);
  assert.equal(detectAlerts({ ...env, EC: 2.0 }, 3).length, 1);
  assert.equal(detectAlerts({ ...env, EC: 2.6 }, 3).length, 0);
});

test('sans stade : plage globale conservée', () => {
  assert.equal(detectAlerts({ ...env, EC: 2.0 }).length, 0);
  assert.equal(detectAlerts({ ...env, EC: 3.4 }).length, 1);
});

test('harvest : défaut 63 j inchangé', () => {
  assert.equal(predictHarvest(3, 30).confidence, 'low');
  assert.equal(predictHarvest(3, 40).confidence, 'medium');
  assert.match(predictHarvest(3, 58).windowLabel, /imminente/);
  assert.match(predictHarvest(3, 70).windowLabel, /dépassée/);
  assert.equal(predictHarvest(2, 10).daysRemaining, null);
});

test('harvest : floraison de 22 j', () => {
  assert.equal(predictHarvest(3, 5, 22).confidence, 'low');
  assert.equal(predictHarvest(3, 15, 22).confidence, 'medium');
  assert.equal(predictHarvest(3, 18, 22).confidence, 'high');
  assert.match(predictHarvest(3, 21, 22).windowLabel, /imminente/);
  assert.equal(predictHarvest(3, 22, 22).daysRemaining, 0);
});

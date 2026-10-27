import test from 'node:test';
import assert from 'node:assert/strict';
import { computeCycle, stageAt, plantsPerYear, harvestDate, integrationDate, rotationSchedule, validateCycle, elapsedDaysSince } from '../src/lib/cycle.ts';

const ex = { nurseryDays: 12, totalDays: 78 }; // exemple 12 + 3×22

test('phases égales après la nurserie', () => {
  const p = computeCycle(ex);
  assert.equal(p.phaseDays, 22);
  assert.equal(p.integrationDay, 13);
  assert.deepEqual(p.phaseStartDay, { 1: 13, 2: 35, 3: 57 });
  assert.ok(Math.abs(p.harvestsPerYear - 365 / 22) < 1e-9);
});

test('autre variété : durées propres', () => {
  const p = computeCycle({ nurseryDays: 12, totalDays: 12 + 3 * 28 });
  assert.equal(p.phaseDays, 28);
  assert.equal(p.integrationDay, 13);
});

test('stageAt aux frontières', () => {
  assert.equal(stageAt(ex, 0).stage, 'nursery');
  assert.equal(stageAt(ex, 11).stage, 'nursery'); // jour 12
  const j13 = stageAt(ex, 12); // jour 13 = intégration
  assert.equal(j13.stage, 1); assert.equal(j13.phaseDay, 1);
  assert.equal(stageAt(ex, 33).stage, 1); assert.equal(stageAt(ex, 33).phaseDay, 22);
  assert.equal(stageAt(ex, 34).stage, 2); assert.equal(stageAt(ex, 34).phaseDay, 1);
  assert.equal(stageAt(ex, 56).stage, 3); assert.equal(stageAt(ex, 56).phaseDay, 1);
  const last = stageAt(ex, 77); // jour 78
  assert.equal(last.stage, 3); assert.equal(last.phaseDay, 22); assert.equal(last.daysToHarvest, 0);
  assert.equal(stageAt(ex, 78).stage, 'done');
});

test('phase non entière : pas de saut ni de débordement', () => {
  const spec = { nurseryDays: 12, totalDays: 80 }; // 68/3 = 22,67
  const stages = Array.from({ length: 80 }, (_, i) => stageAt(spec, i).stage);
  assert.equal(stages[79], 3);
  const order = stages.filter((s, i) => i === 0 || s !== stages[i - 1]);
  assert.deepEqual(order, ['nursery', 1, 2, 3]);
});

test('production annuelle', () => {
  assert.ok(Math.abs(plantsPerYear(ex, 12) - (12 * 365) / 22) < 1e-9);
});

test('dates', () => {
  assert.equal(harvestDate('2026-01-01', ex), '2026-03-20');
  assert.equal(integrationDate('2026-01-01', ex), '2026-01-13');
  assert.deepEqual(rotationSchedule('2026-01-01', ex, 2), ['2026-03-20', '2026-04-11']);
  assert.equal(elapsedDaysSince('2026-10-01', new Date(2026, 9, 27)), 26);
});

test('validation', () => {
  assert.ok(validateCycle({ nurseryDays: 12, totalDays: 12 }));
  assert.ok(validateCycle({ nurseryDays: -1, totalDays: 50 }));
  assert.equal(validateCycle(ex), null);
  assert.throws(() => computeCycle({ nurseryDays: 20, totalDays: 10 }));
});

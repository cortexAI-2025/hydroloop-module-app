import { describe, expect, it } from 'vitest';
import { mergeRecords, stableStringify } from './merge';
import { makeRecord, withReading } from '@/test/fixtures';

const base = makeRecord();

describe('mergeRecords', () => {
  it('refuse de fusionner deux batches différents', () => {
    expect(() => mergeRecords(base, makeRecord('B2026-09-01-BBBB'))).toThrow();
  });

  it('réunit les relevés saisis en parallèle sur deux appareils (aucune perte)', () => {
    const a = withReading(base, 'r-a', '2026-09-02T08:00:00.000Z', { pH: 5.9 });
    const b = withReading(base, 'r-b', '2026-09-02T09:00:00.000Z', { pH: 6.1 });
    const { record } = mergeRecords(a, b);
    const ids = record.readings!.map((x) => x.id);
    expect(ids).toContain('r-a');
    expect(ids).toContain('r-b');
    expect(record.readings!.length).toBe(base.readings.length + 2);
    // les valeurs courantes suivent le relevé le plus récent
    expect(record.data.DONNEES_ENVIRONNEMENTALES.pH).toBe(6.1);
  });

  it('est commutative : merge(a,b) == merge(b,a)', () => {
    const a = withReading({ ...base, data: { ...base.data, notes: 'A' } }, 'r-a', '2026-09-02T08:00:00.000Z');
    const b = withReading({ ...base, data: { ...base.data, notes: 'B' } }, 'r-b', '2026-09-03T08:00:00.000Z');
    expect(stableStringify(mergeRecords(a, b).record)).toBe(stableStringify(mergeRecords(b, a).record));
  });

  it('est idempotente : merge(x,x) ne change rien et ne crée pas d’événement de fusion', () => {
    const x = withReading(base, 'r-x', '2026-09-02T08:00:00.000Z');
    const { record, notes } = mergeRecords(x, x);
    expect(notes).toEqual([]);
    expect(record.events!.some((e) => e.type === 'merge')).toBe(false);
    expect(record.readings!).toEqual(x.readings);
  });

  it('conserve le niveau le plus avancé', () => {
    const a = { ...base, updatedAt: '2026-09-10T00:00:00.000Z', data: { ...base.data, PHASE_NUMBER: 2 as const, PHASE_DAY: 3 } };
    const b = { ...base, updatedAt: '2026-09-11T00:00:00.000Z' };
    const { record, notes } = mergeRecords(a, b);
    expect(record.data.PHASE_NUMBER).toBe(2);
    expect(notes.join(' ')).toMatch(/niveau/);
  });

  it('une récolte n’est jamais annulée par une version plus récente sans récolte', () => {
    const harvested = { ...base, status: 'harvested' as const, updatedAt: '2026-09-05T00:00:00.000Z', harvest: { date: '2026-09-05T00:00:00.000Z', freshWeightKg: 12 } as never };
    const newerActive = { ...base, updatedAt: '2026-09-20T00:00:00.000Z' };
    const { record } = mergeRecords(harvested, newerActive);
    expect(record.status).toBe('harvested');
    expect(record.harvest).toBeTruthy();
  });

  it('consigne la valeur écartée dans un événement « Fusion » déterministe', () => {
    const a = { ...base, updatedAt: '2026-09-02T00:00:00.000Z', data: { ...base.data, SOUCHE: 'Alpha' } };
    const b = { ...base, updatedAt: '2026-09-03T00:00:00.000Z', data: { ...base.data, SOUCHE: 'Beta' } };
    const r1 = mergeRecords(a, b);
    const r2 = mergeRecords(b, a);
    expect(r1.record.data.SOUCHE).toBe('Beta');
    const m1 = r1.record.events!.find((e) => e.type === 'merge')!;
    expect(m1.summary).toMatch(/Alpha/);
    expect(m1.id).toBe(r2.record.events!.find((e) => e.type === 'merge')!.id);
  });

  it('une suppression ne l’emporte pas sur une activité enregistrée après elle', () => {
    const deleted = { ...base, updatedAt: '2026-09-02T00:00:00.000Z', deletedAt: '2026-09-02T00:00:00.000Z' };
    const active = withReading(base, 'r-late', '2026-09-03T08:00:00.000Z');
    const { record } = mergeRecords(deleted, active);
    expect(record.deletedAt).toBeUndefined();
  });

  it('une suppression postérieure à toute activité est conservée', () => {
    const deleted = { ...base, updatedAt: '2026-12-01T00:00:00.000Z', deletedAt: '2026-12-01T00:00:00.000Z' };
    expect(mergeRecords(deleted, base).record.deletedAt).toBe('2026-12-01T00:00:00.000Z');
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVarietiesCsv, splitCsvLine, varietyKey, fitsModule, VARIETY_CSV_EXAMPLE } from '../src/lib/varieties.ts';

test('import CSV valide, séparateur ; et décimales virgule', () => {
  const r = parseVarietiesCsv(
    'name;breeder;nursery_days;total_days;height_max_cm;thc_pct\nA;B;12;78;100;0,8\nC;D;10;84;;',
  );
  assert.equal(r.errors.length, 0);
  assert.equal(r.ok.length, 2);
  assert.equal(r.ok[0].thcPct, 0.8);
  assert.equal(r.ok[0].status, 'a_verifier');
  assert.equal(r.ok[1].heightMaxCm, undefined);
});

test('lignes invalides rapportées sans bloquer les autres', () => {
  const r = parseVarietiesCsv('name,nursery_days,total_days\nOk,12,78\n,12,78\nBad,12,12\nNaN,x,70');
  assert.equal(r.ok.length, 1);
  assert.deepEqual(r.errors.map((e) => e.line), [3, 4, 5]);
});

test('colonne obligatoire absente', () => {
  const r = parseVarietiesCsv('name;breeder\nA;B');
  assert.equal(r.ok.length, 0);
  assert.match(r.errors[0].message, /nursery_days/);
});

test('guillemets et BOM', () => {
  assert.deepEqual(splitCsvLine('"a;b";"c ""d"""', ';'), ['a;b', 'c "d"']);
  const r = parseVarietiesCsv('﻿name;nursery_days;total_days\n"X; Y";12;78');
  assert.equal(r.ok[0].name, 'X; Y');
});

test('modèle fourni importable', () => {
  assert.equal(parseVarietiesCsv(VARIETY_CSV_EXAMPLE).ok.length, 1);
});

test('hauteur min > max refusée, clé et compatibilité module', () => {
  assert.equal(parseVarietiesCsv('name;nursery_days;total_days;height_min_cm;height_max_cm\nA;12;78;100;50').errors.length, 1);
  assert.equal(varietyKey({ name: ' Foo  Bar', breeder: 'X' }), varietyKey({ name: 'foo bar', breeder: 'x' }));
  assert.equal(fitsModule({ heightMaxCm: 120 }), true);
  assert.equal(fitsModule({ heightMaxCm: 130 }), false);
  assert.equal(fitsModule({}), true);
});

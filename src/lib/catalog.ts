import type { Variety, VarietyDraft } from '@/types/variety';
import type { ModuleRecord, ModuleKindId } from '@/types/module';
import { SEED_VARIETIES } from '@/data/varieties';
import { varietyKey } from './varieties';
import {
  dbGetAllVarieties, dbPutVariety, dbDeleteVariety,
  dbGetAllModules, dbPutModule, dbDeleteModule,
} from './db';

const LS_SEEDED = 'hydroloop_varieties_seeded_v1';

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Variétés triées par nom ; l'exemple de départ est ajouté une seule fois. */
export async function getVarieties(): Promise<Variety[]> {
  if (typeof window !== 'undefined' && !localStorage.getItem(LS_SEEDED)) {
    const existing = await dbGetAllVarieties();
    if (existing.length === 0) for (const d of SEED_VARIETIES) await addVariety(d);
    localStorage.setItem(LS_SEEDED, '1');
  }
  return (await dbGetAllVarieties()).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

export async function getVariety(id: string): Promise<Variety | undefined> {
  return (await dbGetAllVarieties()).find((v) => v.id === id);
}

export async function addVariety(d: VarietyDraft): Promise<Variety> {
  const now = new Date().toISOString();
  const v: Variety = { ...d, id: newId('var'), createdAt: now, updatedAt: now };
  await dbPutVariety(v);
  return v;
}

export async function updateVariety(v: Variety): Promise<void> {
  await dbPutVariety({ ...v, updatedAt: new Date().toISOString() });
}

export async function removeVariety(id: string): Promise<void> {
  await dbDeleteVariety(id);
}

/** Importe des variétés en ignorant celles déjà présentes (nom + breeder). */
export async function importVarieties(drafts: VarietyDraft[]): Promise<{ added: number; skipped: number }> {
  const known = new Set((await dbGetAllVarieties()).map(varietyKey));
  let added = 0;
  let skipped = 0;
  for (const d of drafts) {
    const k = varietyKey(d);
    if (known.has(k)) { skipped++; continue; }
    known.add(k);
    await addVariety(d);
    added++;
  }
  return { added, skipped };
}

export async function getModules(): Promise<ModuleRecord[]> {
  return (await dbGetAllModules()).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

export async function addModule(input: { name: string; kind: ModuleKindId; varietyId?: string; location?: string; notes?: string }): Promise<ModuleRecord> {
  const now = new Date().toISOString();
  const m: ModuleRecord = { ...input, id: newId('mod'), createdAt: now, updatedAt: now };
  await dbPutModule(m);
  return m;
}

export async function updateModule(m: ModuleRecord): Promise<void> {
  await dbPutModule({ ...m, updatedAt: new Date().toISOString() });
}

export async function removeModule(id: string): Promise<void> {
  await dbDeleteModule(id);
}

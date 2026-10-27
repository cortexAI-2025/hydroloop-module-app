import type { VarietyDraft, VarietyStatus } from '../types/variety';

export const VARIETY_CSV_HEADER =
  'name;breeder;nursery_days;total_days;height_min_cm;height_max_cm;thc_pct;cbd_pct;status;source;notes';

export const VARIETY_CSV_EXAMPLE = [
  VARIETY_CSV_HEADER,
  'Variété exemple;Breeder X;12;78;60;100;;;a_verifier;https://exemple.invalid;Remplacer par les données réelles',
].join('\n');

export interface ImportResult {
  ok: VarietyDraft[];
  errors: { line: number; message: string }[];
}

/** Découpe une ligne CSV (séparateur `;` ou `,`, guillemets doubles supportés). */
export function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function num(v: string | undefined): number | undefined {
  if (v === undefined || v === '') return undefined;
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

const STATUSES: VarietyStatus[] = ['exemple', 'a_verifier', 'verifie'];

/** Analyse un CSV de variétés ; chaque ligne invalide est rapportée sans bloquer les autres. */
export function parseVarietiesCsv(text: string): ImportResult {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const result: ImportResult = { ok: [], errors: [] };
  const first = lines.find((l) => l.trim() !== '');
  if (!first) return result;
  const sep = first.includes(';') ? ';' : ',';
  const header = splitCsvLine(first, sep).map((h) => h.toLowerCase());
  const col = (name: string) => header.indexOf(name);
  for (const req of ['name', 'nursery_days', 'total_days']) {
    if (col(req) < 0) {
      result.errors.push({ line: 1, message: `Colonne obligatoire absente : ${req}` });
      return result;
    }
  }
  const start = lines.indexOf(first);
  lines.forEach((raw, idx) => {
    if (idx <= start || raw.trim() === '') return;
    const f = splitCsvLine(raw, sep);
    const get = (n: string) => (col(n) >= 0 ? f[col(n)] : undefined);
    const line = idx + 1;
    const name = (get('name') ?? '').trim();
    const nurseryDays = num(get('nursery_days'));
    const totalDays = num(get('total_days'));
    if (!name) return void result.errors.push({ line, message: 'Nom manquant' });
    if (nurseryDays === undefined || Number.isNaN(nurseryDays) || nurseryDays < 0)
      return void result.errors.push({ line, message: `${name} : nurserie invalide` });
    if (totalDays === undefined || Number.isNaN(totalDays) || totalDays <= nurseryDays)
      return void result.errors.push({ line, message: `${name} : durée totale invalide (doit dépasser la nurserie)` });
    const optional = ['height_min_cm', 'height_max_cm', 'thc_pct', 'cbd_pct'].map((n) => num(get(n)));
    if (optional.some((v) => v !== undefined && Number.isNaN(v)))
      return void result.errors.push({ line, message: `${name} : valeur numérique invalide` });
    const [heightMinCm, heightMaxCm, thcPct, cbdPct] = optional;
    if (heightMinCm !== undefined && heightMaxCm !== undefined && heightMinCm > heightMaxCm)
      return void result.errors.push({ line, message: `${name} : hauteur min > max` });
    const st = (get('status') ?? '').toLowerCase() as VarietyStatus;
    result.ok.push({
      name,
      breeder: (get('breeder') ?? '').trim(),
      nurseryDays,
      totalDays,
      heightMinCm,
      heightMaxCm,
      thcPct,
      cbdPct,
      status: STATUSES.includes(st) ? st : 'a_verifier',
      source: get('source') || undefined,
      notes: get('notes') || undefined,
    });
  });
  return result;
}

/** Clé de dédoublonnage : nom + breeder, insensible à la casse et aux espaces. */
export function varietyKey(v: { name: string; breeder: string }): string {
  return `${v.name}|${v.breeder}`.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Hauteur adulte la plus grande connue, ou null. */
export function maxHeightCm(v: { heightMinCm?: number; heightMaxCm?: number }): number | null {
  return v.heightMaxCm ?? v.heightMinCm ?? null;
}

/** Niveau minimal compatible avec la hauteur adulte : N3 (bas) accepte jusqu'à 120 cm. */
export const LEVEL_MAX_HEIGHT_CM = 120;
export function fitsModule(v: { heightMinCm?: number; heightMaxCm?: number }): boolean {
  const h = maxHeightCm(v);
  return h === null || h <= LEVEL_MAX_HEIGHT_CM;
}

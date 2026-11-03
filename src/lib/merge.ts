import type { BatchEvent, BatchRecord, Reading } from '@/types/batch';

/**
 * Fusion de deux versions d'un même batch (synchronisation, import de sauvegarde).
 *
 * Principes :
 * - **Rien n'est perdu** : relevés et événements sont des journaux « append-only », on en fait l'union (par id).
 * - **Déterministe et symétrique** : merge(a, b) === merge(b, a), pour que deux appareils qui fusionnent
 *   chacun de leur côté convergent vers le même résultat.
 * - **Pas de retour en arrière** : une récolte n'est jamais annulée, le niveau le plus avancé est conservé.
 * - **Traçable** : toute valeur écartée (champ modifié des deux côtés) est consignée dans un événement « Fusion ».
 */

export interface MergeResult {
  record: BatchRecord;
  /** Descriptions des valeurs écartées / décisions prises (vide si les versions étaient compatibles). */
  notes: string[];
}

const SCALAR_FIELDS = [
  'SOUCHE', 'MODULE_ID', 'MODULE_TYPE', 'OPERATEUR', 'DATE_SEMIS', 'HISTORIQUE_TAILLES', 'DERNIERS_RELEVES_RACINAIRES', 'notes',
] as const;

const FIELD_LABELS: Record<(typeof SCALAR_FIELDS)[number], string> = {
  SOUCHE: 'souche', MODULE_ID: 'module', MODULE_TYPE: 'nombre de plants', OPERATEUR: 'responsable', DATE_SEMIS: 'date de semis',
  HISTORIQUE_TAILLES: 'historique des tailles', DERNIERS_RELEVES_RACINAIRES: 'relevés racinaires', notes: 'notes',
};

/** Sérialisation JSON à clés triées, pour comparer et hacher sans dépendre de l'ordre des clés. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
}

/** Petit hachage non cryptographique (djb2) — suffisant pour des identifiants d'événements déterministes. */
export function shortHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const strip = (r: BatchRecord): BatchRecord => {
  const { sync: _sync, rev: _rev, ...rest } = r;
  void _sync; void _rev;
  return rest;
};

function unionById<T extends { id: string; at: string }>(a: T[] = [], b: T[] = [], prefer: 'a' | 'b'): T[] {
  const m = new Map<string, T>();
  for (const x of prefer === 'a' ? [...b, ...a] : [...a, ...b]) m.set(x.id, x);
  return [...m.values()].sort((x, y) => x.at.localeCompare(y.at) || x.id.localeCompare(y.id));
}

const fmt = (v: unknown) => (v === undefined || v === null || v === '' ? '—' : String(v));

export function lastActivityAt(r: BatchRecord): string {
  const ts = [
    ...(r.readings ?? []).map((x) => x.at),
    ...(r.events ?? []).filter((e) => e.type !== 'merge').map((e) => e.at),
  ];
  return ts.sort().at(-1) ?? r.createdAt;
}

export function mergeRecords(a: BatchRecord, b: BatchRecord): MergeResult {
  if (a.id !== b.id) throw new Error(`Fusion impossible : identifiants différents (${a.id} / ${b.id}).`);

  // Ordre déterministe : la version la plus récente fournit les champs « scalaires ».
  const [older, newer] = [a, b].sort((x, y) => {
    const c = x.updatedAt.localeCompare(y.updatedAt);
    return c !== 0 ? c : stableStringify(strip(x)).localeCompare(stableStringify(strip(y)));
  });
  const notes: string[] = [];

  const readings = unionById<Reading>(older.readings, newer.readings, 'b');
  const events = unionById<BatchEvent>(older.events, newer.events, 'b');

  // ── data
  const data = { ...newer.data };
  for (const f of SCALAR_FIELDS) {
    const vo = older.data[f], vn = newer.data[f];
    if ((vo ?? '') !== (vn ?? '')) notes.push(`${FIELD_LABELS[f]} : « ${fmt(vo)} » non retenu (retenu : « ${fmt(vn)} »)`);
  }

  // ── niveau : le plus avancé l'emporte
  const phaseOwner = older.data.PHASE_NUMBER > newer.data.PHASE_NUMBER ? older : newer;
  data.PHASE_NUMBER = phaseOwner.data.PHASE_NUMBER;
  data.PHASE_DAY = phaseOwner.data.PHASE_DAY;
  if (older.data.PHASE_NUMBER !== newer.data.PHASE_NUMBER) {
    notes.push(`niveau : ${Math.min(older.data.PHASE_NUMBER, newer.data.PHASE_NUMBER)} et ${phaseOwner.data.PHASE_NUMBER} saisis en parallèle (niveau le plus avancé retenu)`);
  }
  const phaseStartedAt = phaseOwner.phaseStartedAt ?? newer.phaseStartedAt ?? older.phaseStartedAt;

  // ── valeurs courantes = dernier relevé connu
  const latest = [...readings].sort((x, y) => y.at.localeCompare(x.at))[0];
  if (latest) data.DONNEES_ENVIRONNEMENTALES = latest.env;

  // ── récolte : irréversible
  let harvest = newer.harvest ?? older.harvest;
  if (older.harvest && newer.harvest && stableStringify(older.harvest) !== stableStringify(newer.harvest)) {
    notes.push(`récolte concurrente non retenue : ${older.harvest.freshWeightKg} kg le ${older.harvest.date.slice(0, 10)} (retenue : ${newer.harvest.freshWeightKg} kg le ${newer.harvest.date.slice(0, 10)})`);
    harvest = newer.harvest;
  }
  const status = older.status === 'harvested' || newer.status === 'harvested' || harvest ? 'harvested' : 'active';

  // ── rapport : le plus récent
  const reportOwner = (older.reportAt ?? '') > (newer.reportAt ?? '') ? older : newer;

  // ── durées cibles
  const levelTargetDays = newer.levelTargetDays ?? older.levelTargetDays;
  if (older.levelTargetDays && newer.levelTargetDays && stableStringify(older.levelTargetDays) !== stableStringify(newer.levelTargetDays)) {
    notes.push(`durées cibles : ${stableStringify(older.levelTargetDays)} non retenu`);
  }

  const merged: BatchRecord = {
    id: a.id,
    data,
    createdAt: older.createdAt < newer.createdAt ? older.createdAt : newer.createdAt,
    updatedAt: older.updatedAt > newer.updatedAt ? older.updatedAt : newer.updatedAt,
    status,
    phaseStartedAt,
    levelTargetDays,
    readings,
    events,
    harvest,
    report: reportOwner.report,
    reportSource: reportOwner.reportSource,
    reportAt: reportOwner.reportAt,
    reportInputHash: reportOwner.reportInputHash,
    rev: Math.max(a.rev ?? 1, b.rev ?? 1),
  };

  // ── suppression logique : n'écrase jamais une activité plus récente
  const deletedAt = [older.deletedAt, newer.deletedAt].filter(Boolean).sort().at(-1);
  if (deletedAt) {
    if (lastActivityAt(merged) > deletedAt) notes.push('batch restauré : activité enregistrée après sa suppression');
    else merged.deletedAt = deletedAt;
  }

  for (const k of Object.keys(merged) as (keyof BatchRecord)[]) if (merged[k] === undefined) delete merged[k];

  if (notes.length) {
    const summary = `Fusion automatique après modifications simultanées — ${notes.join(' ; ')}`;
    merged.events = [...events, { id: `m-${shortHash(summary)}`, at: merged.updatedAt, type: 'merge' as const, summary }]
      .sort((x, y) => x.at.localeCompare(y.at) || x.id.localeCompare(y.id));
  }
  return { record: merged, notes };
}

/** Deux enregistrements ont-ils le même contenu métier (hors informations de synchronisation) ? */
export function sameContent(a: BatchRecord, b: BatchRecord): boolean {
  return stableStringify(strip(a)) === stableStringify(strip(b));
}

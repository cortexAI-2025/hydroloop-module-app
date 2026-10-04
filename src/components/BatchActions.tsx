'use client';
import { useState } from 'react';
import Modal from './Modal';
import EnvFields from './EnvFields';
import AlertBadge from './AlertBadge';
import type { BatchEventType, EnvironmentalData, HarvestData, ModuleType, PhaseNumber, TrackedBatch } from '@/types/batch';
import { PHASE_LABELS, detectAlerts } from '@/types/batch';
import { uid } from '@/lib/tracking';

const OPERATOR_KEY = 'hydroloop_operator';

export function rememberedOperator(): string {
  try { return localStorage.getItem(OPERATOR_KEY) ?? ''; } catch { return ''; }
}

export function rememberOperator(name: string) {
  try { if (name) localStorage.setItem(OPERATOR_KEY, name); } catch { /* stockage indisponible */ }
}

function nowLocalInput(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function OperatorField({ value, onChange, required }: { value: string; onChange: (v: string) => void; required?: boolean }) {
  return (
    <div>
      <label className="label" htmlFor="operator">Opérateur{required ? ' *' : ''}</label>
      <input id="operator" className="input" value={value} required={required} autoComplete="name"
        placeholder="Nom de la personne" onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

// ─── Nouveau relevé ──────────────────────────────────────────────────────────

export function ReadingModal({
  batch, open, onClose, onSubmit,
}: {
  batch: TrackedBatch;
  open: boolean;
  onClose: () => void;
  onSubmit: (env: EnvironmentalData, opts: { operator?: string; note?: string; at: string }) => Promise<void>;
}) {
  const [env, setEnv] = useState<EnvironmentalData>(batch.data.DONNEES_ENVIRONNEMENTALES);
  const [operator, setOperator] = useState(rememberedOperator);
  const [note, setNote] = useState('');
  const [initialAt] = useState(nowLocalInput);
  const [at, setAt] = useState(initialAt);
  const [saving, setSaving] = useState(false);
  const alerts = detectAlerts(env);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    rememberOperator(operator);
    try {
      // Heure non modifiée : on horodate à la seconde près (le champ est arrondi à la minute)
      const when = at === initialAt ? new Date().toISOString() : new Date(at).toISOString();
      await onSubmit(env, { operator: operator || undefined, note: note || undefined, at: when });
      setNote('');
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Nouveau relevé — niveau ${batch.data.PHASE_NUMBER}`} open={open} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-xs text-gray-500">Pré-rempli avec le dernier relevé : ne modifiez que ce qui a changé.</p>
        <EnvFields value={env} phase={batch.data.PHASE_NUMBER} onChange={(k, v) => setEnv((x) => ({ ...x, [k]: v }))} />
        {alerts.length > 0 && <AlertBadge alerts={alerts} />}
        <div className="grid sm:grid-cols-2 gap-3">
          <OperatorField value={operator} onChange={setOperator} />
          <div>
            <label className="label" htmlFor="reading-at">Date et heure du relevé</label>
            <input id="reading-at" className="input" type="datetime-local" required value={at} max={nowLocalInput()}
              onChange={(e) => setAt(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="reading-note">Observation (optionnel)</label>
          <input id="reading-note" className="input" value={note} placeholder="ex : feuilles basses jaunissantes"
            onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer le relevé'}</button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Journal (taille, contrôle racinaire, traitement, note) ──────────────────

const LOG_TYPES: { type: BatchEventType; label: string; placeholder: string }[] = [
  { type: 'pruning', label: 'Taille', placeholder: 'ex : effeuillage des étages bas, ~15 g/plante retirés' },
  { type: 'root_check', label: 'Contrôle racinaire', placeholder: 'ex : racines blanc crème, denses, pas de Pythium' },
  { type: 'treatment', label: 'Traitement', placeholder: 'ex : Trichoderma 2 g/L dans le réservoir N2' },
  { type: 'note', label: 'Note libre', placeholder: 'Observation, incident, maintenance…' },
];

export function LogModal({
  open, onClose, onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (type: BatchEventType, summary: string, operator?: string) => Promise<void>;
}) {
  const [type, setType] = useState<BatchEventType>('pruning');
  const [summary, setSummary] = useState('');
  const [operator, setOperator] = useState(rememberedOperator);
  const current = LOG_TYPES.find((t) => t.type === type)!;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    rememberOperator(operator);
    await onSubmit(type, summary.trim(), operator || undefined);
    setSummary('');
    onClose();
  }

  return (
    <Modal title="Ajouter au journal" open={open} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {LOG_TYPES.map((t) => (
            <button key={t.type} type="button" onClick={() => setType(t.type)}
              className={`rounded-lg border-2 px-3 py-2 text-sm font-semibold text-left ${type === t.type ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-gray-200 text-gray-600'}`}>
              {t.label}
            </button>
          ))}
        </div>
        <div>
          <label className="label" htmlFor="log-summary">Description *</label>
          <textarea id="log-summary" className="input resize-none" rows={3} required value={summary}
            placeholder={current.placeholder} onChange={(e) => setSummary(e.target.value)} />
        </div>
        <OperatorField value={operator} onChange={setOperator} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn-primary">Ajouter</button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Changement de niveau ────────────────────────────────────────────────────

export function AdvanceModal({
  batch, day, open, onClose, onConfirm,
}: {
  batch: TrackedBatch;
  day: number;
  open: boolean;
  onClose: () => void;
  onConfirm: (operator?: string) => Promise<void>;
}) {
  const [operator, setOperator] = useState(rememberedOperator);
  const from = batch.data.PHASE_NUMBER;
  const to = (from + 1) as PhaseNumber;
  const target = batch.levelTargetDays[from];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    rememberOperator(operator);
    await onConfirm(operator || undefined);
    onClose();
  }

  return (
    <Modal title={`Monter au niveau ${to}`} open={open} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-gray-700">
          La cohorte passe du niveau {from} ({PHASE_LABELS[from]}) au niveau {to} ({PHASE_LABELS[to]}).
          Le compteur de jours repart à 1.
        </p>
        {day < target && (
          <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
            ⚠️ Jour {day} sur {target} prévus pour ce niveau : le transfert est anticipé.
          </div>
        )}
        <ul className="text-xs text-gray-600 list-disc pl-5 space-y-1">
          <li>Vérifier que le niveau {to} est libéré et nettoyé.</li>
          <li>Ajuster la solution du réservoir R{to} à l&apos;EC cible du niveau.</li>
          {to === 3 && <li>Passer la photopériode en 12/12 (mise à jour automatique).</li>}
        </ul>
        <OperatorField value={operator} onChange={setOperator} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn-primary">Confirmer le transfert</button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Récolte ─────────────────────────────────────────────────────────────────

export function HarvestModal({
  batch, open, onClose, onSubmit,
}: {
  batch: TrackedBatch;
  open: boolean;
  onClose: () => void;
  onSubmit: (h: HarvestData) => Promise<void>;
}) {
  const [h, setH] = useState({
    date: new Date().toISOString().slice(0, 10),
    plantsHarvested: String(batch.data.MODULE_TYPE),
    freshWeightKg: '',
    operator: rememberedOperator(),
    freezeTempC: '-40',
    freezeDelayMin: '',
    destination: '',
    lotNumber: `${batch.id}-L1`,
    notes: '',
  });
  const set = (k: keyof typeof h) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setH((x) => ({ ...x, [k]: e.target.value }));
  const num = (s: string) => (s.trim() === '' ? undefined : Number(s));
  const weight = Number(h.freshWeightKg);
  const plants = Number(h.plantsHarvested);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    rememberOperator(h.operator);
    await onSubmit({
      date: new Date(h.date).toISOString(),
      plantsHarvested: plants,
      freshWeightKg: weight,
      operator: h.operator.trim(),
      freezeTempC: num(h.freezeTempC),
      freezeDelayMin: num(h.freezeDelayMin),
      destination: h.destination.trim() || undefined,
      lotNumber: h.lotNumber.trim() || undefined,
      notes: h.notes.trim() || undefined,
    });
    onClose();
  }

  return (
    <Modal title="Enregistrer la récolte" open={open} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid sm:grid-cols-3 gap-3">
          <div>
            <label className="label" htmlFor="h-date">Date de récolte *</label>
            <input id="h-date" className="input" type="date" required value={h.date} onChange={set('date')} />
          </div>
          <div>
            <label className="label" htmlFor="h-plants">Plants récoltés *</label>
            <input id="h-plants" className="input" type="number" min={1} max={batch.data.MODULE_TYPE} required
              value={h.plantsHarvested} onChange={set('plantsHarvested')} />
          </div>
          <div>
            <label className="label" htmlFor="h-weight">Masse fraîche (kg) *</label>
            <input id="h-weight" className="input" type="number" step="0.01" min={0} required inputMode="decimal"
              value={h.freshWeightKg} onChange={set('freshWeightKg')} />
          </div>
          <div>
            <label className="label" htmlFor="h-freeze">T° de congélation (°C)</label>
            <input id="h-freeze" className="input" type="number" step="1" value={h.freezeTempC} onChange={set('freezeTempC')} />
          </div>
          <div>
            <label className="label" htmlFor="h-delay">Délai récolte → froid (min)</label>
            <input id="h-delay" className="input" type="number" min={0} value={h.freezeDelayMin} onChange={set('freezeDelayMin')} />
          </div>
          <div>
            <label className="label" htmlFor="h-lot">N° de lot</label>
            <input id="h-lot" className="input font-mono" value={h.lotNumber} onChange={set('lotNumber')} />
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <OperatorField value={h.operator} onChange={(v) => setH((x) => ({ ...x, operator: v }))} required />
          <div>
            <label className="label" htmlFor="h-dest">Destination</label>
            <input id="h-dest" className="input" value={h.destination} placeholder="Acheteur / transformateur agréé"
              onChange={set('destination')} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="h-notes">Notes</label>
          <textarea id="h-notes" className="input resize-none" rows={2} value={h.notes} onChange={set('notes')} />
        </div>
        {weight > 0 && plants > 0 && (
          <div className="text-sm text-gray-700 bg-gray-50 rounded-md px-3 py-2">
            Rendement : <strong>{Math.round((weight * 1000) / plants)} g/plante</strong>
          </div>
        )}
        {h.freezeDelayMin !== '' && Number(h.freezeDelayMin) > 120 && (
          <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
            ⚠️ Délai supérieur à 2 h : risque d&apos;oxydation enzymatique (cible &lt; 2 h).
          </div>
        )}
        <p className="text-xs text-gray-500">La récolte clôt le batch : il passe en statut « Récolté » et n&apos;accepte plus de relevés.</p>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn-primary">Enregistrer la récolte</button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Modifier le batch ───────────────────────────────────────────────────────

export function EditModal({
  batch, open, onClose, onSubmit,
}: {
  batch: TrackedBatch;
  open: boolean;
  onClose: () => void;
  onSubmit: (b: TrackedBatch) => Promise<void>;
}) {
  const [f, setF] = useState({
    SOUCHE: batch.data.SOUCHE,
    MODULE_ID: batch.data.MODULE_ID ?? '',
    MODULE_TYPE: batch.data.MODULE_TYPE,
    DATE_SEMIS: batch.data.DATE_SEMIS,
    OPERATEUR: batch.data.OPERATEUR ?? '',
    t1: batch.levelTargetDays[1],
    t2: batch.levelTargetDays[2],
    t3: batch.levelTargetDays[3],
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const changes: string[] = [];
    if (f.SOUCHE !== batch.data.SOUCHE) changes.push(`souche → ${f.SOUCHE}`);
    if ((f.MODULE_ID || '') !== (batch.data.MODULE_ID ?? '')) changes.push(`module → ${f.MODULE_ID || '—'}`);
    if (f.MODULE_TYPE !== batch.data.MODULE_TYPE) changes.push(`${f.MODULE_TYPE} plants`);
    if (f.DATE_SEMIS !== batch.data.DATE_SEMIS) changes.push(`semis → ${f.DATE_SEMIS}`);
    if ((f.OPERATEUR || '') !== (batch.data.OPERATEUR ?? '')) changes.push(`responsable → ${f.OPERATEUR || '—'}`);
    const t = { 1: f.t1, 2: f.t2, 3: f.t3 } as Record<PhaseNumber, number>;
    if ([1, 2, 3].some((p) => t[p as PhaseNumber] !== batch.levelTargetDays[p as PhaseNumber]))
      changes.push(`durées cibles ${f.t1}/${f.t2}/${f.t3} j`);
    const next: TrackedBatch = {
      ...batch,
      levelTargetDays: t,
      data: {
        ...batch.data,
        SOUCHE: f.SOUCHE.trim(),
        MODULE_ID: f.MODULE_ID.trim() || undefined,
        MODULE_TYPE: f.MODULE_TYPE,
        DATE_SEMIS: f.DATE_SEMIS,
        OPERATEUR: f.OPERATEUR.trim() || undefined,
      },
      events: changes.length
        ? [...batch.events, { id: uid('e-'), at: new Date().toISOString(), type: 'edit', summary: `Modifié : ${changes.join(', ')}`, operator: rememberedOperator() || undefined }]
        : batch.events,
    };
    await onSubmit(next);
    onClose();
  }

  return (
    <Modal title="Modifier le batch" open={open} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="ed-strain">Souche *</label>
            <input id="ed-strain" className="input" required value={f.SOUCHE} onChange={(e) => setF((x) => ({ ...x, SOUCHE: e.target.value }))} />
          </div>
          <div>
            <label className="label" htmlFor="ed-module">Module A-Frame</label>
            <input id="ed-module" className="input font-mono" value={f.MODULE_ID} placeholder="ex : A-03"
              onChange={(e) => setF((x) => ({ ...x, MODULE_ID: e.target.value.toUpperCase() }))} />
          </div>
          <div>
            <label className="label" htmlFor="ed-type">Plants</label>
            <select id="ed-type" className="input" value={f.MODULE_TYPE}
              onChange={(e) => setF((x) => ({ ...x, MODULE_TYPE: Number(e.target.value) as ModuleType }))}>
              {[12, 24, 36, 48].map((n) => <option key={n} value={n}>{n} plants</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="ed-sow">Date de semis</label>
            <input id="ed-sow" className="input" type="date" required value={f.DATE_SEMIS}
              onChange={(e) => setF((x) => ({ ...x, DATE_SEMIS: e.target.value }))} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="ed-op">Responsable du batch</label>
            <input id="ed-op" className="input" value={f.OPERATEUR} onChange={(e) => setF((x) => ({ ...x, OPERATEUR: e.target.value }))} />
          </div>
        </div>
        <fieldset>
          <legend className="label">Durée cible par niveau (jours) — rotation HydroLoop : 20 à 27 j</legend>
          <div className="grid grid-cols-3 gap-3">
            {(['t1', 't2', 't3'] as const).map((k, i) => (
              <div key={k}>
                <label className="text-xs text-gray-500" htmlFor={`ed-${k}`}>Niveau {i + 1}</label>
                <input id={`ed-${k}`} className="input" type="number" min={5} max={90} required value={f[k]}
                  onChange={(e) => setF((x) => ({ ...x, [k]: Number(e.target.value) }))} />
              </div>
            ))}
          </div>
        </fieldset>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn-primary">Enregistrer</button>
        </div>
      </form>
    </Modal>
  );
}

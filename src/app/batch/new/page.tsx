'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { saveBatch, generateBatchId } from '@/lib/storage';
import type { BatchFormData, PhaseNumber, ModuleType } from '@/types/batch';
import AlertBadge from '@/components/AlertBadge';
import { detectAlerts } from '@/types/batch';
import type { Variety } from '@/types/variety';
import type { ModuleRecord } from '@/types/module';
import { MODULE_KINDS } from '@/types/module';
import { computeCycle, stageAt, elapsedDaysSince, harvestDate, validateCycle } from '@/lib/cycle';
import { getVarieties, getModules } from '@/lib/catalog';

const defaultEnv = {
  temperature_air_jour: 24,
  temperature_air_nuit: 18,
  humidite_relative: 55,
  pH: 6.0,
  EC: 1.8,
  temperature_solution: 20,
  debit_NFT: 0.8,
  oxygene_dissous: 7.5,
  PPFD: 650,
  photopériode: '18/6',
};

const phasePhotopériode: Record<number, string> = { 1: '18/6', 2: '18/6', 3: '12/12' };

export default function NewBatchPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState<BatchFormData>({
    BATCH_ID: '',
    SOUCHE: '',
    PHASE_NUMBER: 1,
    PHASE_DAY: 1,
    MODULE_TYPE: 24,
    DATE_SEMIS: new Date().toISOString().slice(0, 10),
    DONNEES_ENVIRONNEMENTALES: defaultEnv,
    HISTORIQUE_TAILLES: '',
    DERNIERS_RELEVES_RACINAIRES: '',
    notes: '',
  });

  const [varieties, setVarieties] = useState<Variety[]>([]);
  const [modules, setModules] = useState<ModuleRecord[]>([]);

  useEffect(() => {
    generateBatchId().then((id) => setForm((f) => ({ ...f, BATCH_ID: id })));
    getVarieties().then(setVarieties).catch(() => {});
    getModules().then(setModules).catch(() => {});
  }, []);

  const variety = varieties.find((v) => v.id === form.VARIETY_ID);
  const cycleOk = variety ? validateCycle(variety) === null : false;
  const plan = variety && cycleOk ? computeCycle(variety) : null;
  const position = variety && cycleOk ? stageAt(variety, elapsedDaysSince(form.DATE_SEMIS)) : null;

  // Variété choisie : la phase et le jour de phase se déduisent de la date de semis.
  useEffect(() => {
    if (!variety || !cycleOk) return;
    const pos = stageAt(variety, elapsedDaysSince(form.DATE_SEMIS));
    if (pos.stage === 'nursery' || pos.stage === 'done') return;
    setForm((f) => ({
      ...f,
      PHASE_NUMBER: pos.stage as PhaseNumber,
      PHASE_DAY: pos.phaseDay,
      DONNEES_ENVIRONNEMENTALES: { ...f.DONNEES_ENVIRONNEMENTALES, photopériode: phasePhotopériode[pos.stage as number] },
    }));
  }, [variety, cycleOk, form.DATE_SEMIS]);

  function onVarietyChange(id: string) {
    const v = varieties.find((x) => x.id === id);
    setForm((f) => ({ ...f, VARIETY_ID: id || undefined, SOUCHE: v ? v.name : f.SOUCHE }));
  }

  function onModuleChange(id: string) {
    const m = modules.find((x) => x.id === id);
    const v = m?.varietyId ? varieties.find((x) => x.id === m.varietyId) : undefined;
    setForm((f) => ({
      ...f,
      MODULE_ID: id || undefined,
      MODULE_TYPE: m ? (MODULE_KINDS[m.kind].plants as ModuleType) : f.MODULE_TYPE,
      VARIETY_ID: v ? v.id : f.VARIETY_ID,
      SOUCHE: v ? v.name : f.SOUCHE,
    }));
  }

  const alerts = detectAlerts(form.DONNEES_ENVIRONNEMENTALES, form.PHASE_NUMBER);

  function setEnv(field: string, value: number | string) {
    setForm((f) => ({
      ...f,
      DONNEES_ENVIRONNEMENTALES: { ...f.DONNEES_ENVIRONNEMENTALES, [field]: value },
    }));
  }

  function onPhaseChange(phase: PhaseNumber) {
    setForm((f) => ({
      ...f,
      PHASE_NUMBER: phase,
      DONNEES_ENVIRONNEMENTALES: {
        ...f.DONNEES_ENVIRONNEMENTALES,
        photopériode: phasePhotopériode[phase],
      },
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await saveBatch({
        ...form,
        LEVEL: form.PHASE_NUMBER,
        ...(variety && plan
          ? { CYCLE: { nurseryDays: variety.nurseryDays, totalDays: variety.totalDays }, FLOWERING_DAYS: plan.phaseDays }
          : {}),
      });
      router.push(`/batch/${form.BATCH_ID}`);
    } catch {
      setSaving(false);
      alert('Erreur lors de la sauvegarde. Vérifiez les permissions IndexedDB.');
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Nouveau batch</h1>
        <p className="text-sm text-gray-500 mt-1">
          Renseignez les données du batch pour générer le rapport d'analyse A-Frame NFT.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Identification */}
        <section className="card">
          <div className="section-title">Identification du batch</div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Batch ID (auto-généré)</label>
              <input className="input bg-gray-50 font-mono" value={form.BATCH_ID} readOnly />
            </div>
            <div>
              <label className="label">Module</label>
              <select className="input" value={form.MODULE_ID ?? ''} onChange={(e) => onModuleChange(e.target.value)}>
                <option value="">— non rattaché —</option>
                {modules.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Variété du catalogue</label>
              <select className="input" value={form.VARIETY_ID ?? ''} onChange={(e) => onVarietyChange(e.target.value)}>
                <option value="">— saisie libre —</option>
                {varieties.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Souche *</label>
              <input
                className="input"
                placeholder="ex : Amnesia Haze, OG Kush…"
                required
                value={form.SOUCHE}
                onChange={(e) => setForm((f) => ({ ...f, SOUCHE: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">Date de semis *</label>
              <input
                className="input"
                type="date"
                required
                value={form.DATE_SEMIS}
                onChange={(e) => setForm((f) => ({ ...f, DATE_SEMIS: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">Module (nombre de plants)</label>
              <select
                className="input"
                value={form.MODULE_TYPE}
                onChange={(e) => setForm((f) => ({ ...f, MODULE_TYPE: Number(e.target.value) as ModuleType }))}
              >
                {[12, 24, 36, 48].map((n) => (
                  <option key={n} value={n}>{n} plants</option>
                ))}
              </select>
            </div>
          </div>
          {plan && variety && position && (
            <p className="mt-3 rounded-md bg-brand-50 px-3 py-2 text-xs text-brand-800">
              Cycle {variety.totalDays} j : nurserie {plan.nurseryDays} j, puis 3 phases de {plan.phaseDays.toFixed(1)} j.
              Intégration au module le {new Date(form.DATE_SEMIS + 'T00:00:00').toLocaleDateString('fr-FR')} + {plan.nurseryDays} j (J+{plan.integrationDay}).
              Récolte prévue le {new Date(harvestDate(form.DATE_SEMIS, variety) + 'T00:00:00').toLocaleDateString('fr-FR')}.
              {position.stage === 'nursery' && ` Actuellement en nurserie (jour ${position.phaseDay}/${plan.nurseryDays}).`}
              {position.stage === 'done' && ' Le cycle est terminé à cette date.'}
            </p>
          )}
        </section>

        {/* Phase */}
        <section className="card">
          <div className="section-title">Phase de croissance</div>
          <div className="grid sm:grid-cols-3 gap-3 mb-4">
            {([1, 2, 3] as PhaseNumber[]).map((ph) => {
              const labels = { 1: 'Phase 1 — Croissance', 2: 'Phase 2 — Stretch', 3: 'Phase 3 — Floraison' };
              const colors = {
                1: 'border-blue-400 bg-blue-50 text-blue-800',
                2: 'border-amber-400 bg-amber-50 text-amber-800',
                3: 'border-purple-400 bg-purple-50 text-purple-800',
              };
              const sel = form.PHASE_NUMBER === ph;
              return (
                <button
                  key={ph}
                  type="button"
                  onClick={() => onPhaseChange(ph)}
                  className={`rounded-lg border-2 px-3 py-3 text-sm font-semibold text-left transition-all
                    ${sel ? colors[ph] : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}
                >
                  {labels[ph]}
                </button>
              );
            })}
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Jour de phase actuel *</label>
              <input
                className="input"
                type="number"
                min={1}
                max={120}
                required
                value={form.PHASE_DAY}
                onChange={(e) => setForm((f) => ({ ...f, PHASE_DAY: Number(e.target.value) }))}
              />
            </div>
          </div>
        </section>

        {/* Environnement */}
        <section className="card">
          <div className="section-title">Données environnementales</div>
          {alerts.length > 0 && (
            <div className="mb-4">
              <AlertBadge alerts={alerts} />
            </div>
          )}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <EF label="Temp. air jour (°C)" hint="Idéal : 22–26°C">
              <input className="input" type="number" step="0.1" value={form.DONNEES_ENVIRONNEMENTALES.temperature_air_jour}
                onChange={(e) => setEnv('temperature_air_jour', Number(e.target.value))} />
            </EF>
            <EF label="Temp. air nuit (°C)" hint="Idéal : 16–20°C">
              <input className="input" type="number" step="0.1" value={form.DONNEES_ENVIRONNEMENTALES.temperature_air_nuit}
                onChange={(e) => setEnv('temperature_air_nuit', Number(e.target.value))} />
            </EF>
            <EF label="Humidité relative (%)" hint="Idéal : 40–65%">
              <input className="input" type="number" min={0} max={100} value={form.DONNEES_ENVIRONNEMENTALES.humidite_relative}
                onChange={(e) => setEnv('humidite_relative', Number(e.target.value))} />
            </EF>
            <EF label="pH solution" hint="Plage : 5.5–6.5">
              <input className="input" type="number" step="0.1" min={4} max={8} value={form.DONNEES_ENVIRONNEMENTALES.pH}
                onChange={(e) => setEnv('pH', Number(e.target.value))} />
            </EF>
            <EF label="EC (mS/cm)" hint="Plage : 0.8–3.0">
              <input className="input" type="number" step="0.1" min={0} value={form.DONNEES_ENVIRONNEMENTALES.EC}
                onChange={(e) => setEnv('EC', Number(e.target.value))} />
            </EF>
            <EF label="Temp. solution (°C)" hint="Max : 22°C">
              <input className="input" type="number" step="0.1" value={form.DONNEES_ENVIRONNEMENTALES.temperature_solution}
                onChange={(e) => setEnv('temperature_solution', Number(e.target.value))} />
            </EF>
            <EF label="Débit NFT (L/min)" hint="Min : 0.5 L/min">
              <input className="input" type="number" step="0.1" min={0} value={form.DONNEES_ENVIRONNEMENTALES.debit_NFT}
                onChange={(e) => setEnv('debit_NFT', Number(e.target.value))} />
            </EF>
            <EF label="O₂ dissous (mg/L)" hint="Min : 6 mg/L">
              <input className="input" type="number" step="0.1" min={0} value={form.DONNEES_ENVIRONNEMENTALES.oxygene_dissous}
                onChange={(e) => setEnv('oxygene_dissous', Number(e.target.value))} />
            </EF>
            <EF label="PPFD (µmol/m²/s)" hint="Ph.3 : 700–1 000">
              <input className="input" type="number" min={0} value={form.DONNEES_ENVIRONNEMENTALES.PPFD}
                onChange={(e) => setEnv('PPFD', Number(e.target.value))} />
            </EF>
            <EF label="Photopériode (h/h)" hint="ex : 18/6 ou 12/12">
              <input className="input" type="text" value={form.DONNEES_ENVIRONNEMENTALES.photopériode}
                onChange={(e) => setEnv('photopériode', e.target.value)} />
            </EF>
          </div>
        </section>

        {/* Observations */}
        <section className="card">
          <div className="section-title">Observations culturales</div>
          <div className="space-y-4">
            <div>
              <label className="label">Historique des tailles</label>
              <textarea className="input resize-none" rows={2}
                placeholder="ex : 2 tailles — Jour 21 et Jour 28 de floraison"
                value={form.HISTORIQUE_TAILLES}
                onChange={(e) => setForm((f) => ({ ...f, HISTORIQUE_TAILLES: e.target.value }))} />
            </div>
            <div>
              <label className="label">Derniers relevés racinaires</label>
              <textarea className="input resize-none" rows={2}
                placeholder="ex : densité moyenne, couleur blanc crème, pas de pathogènes"
                value={form.DERNIERS_RELEVES_RACINAIRES}
                onChange={(e) => setForm((f) => ({ ...f, DERNIERS_RELEVES_RACINAIRES: e.target.value }))} />
            </div>
            <div>
              <label className="label">Notes additionnelles</label>
              <textarea className="input resize-none" rows={2}
                placeholder="Observations libres, traitements en cours, incidents…"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
        </section>

        <div className="flex justify-end gap-3">
          <button type="button" className="btn-secondary" onClick={() => router.push('/')}>
            Annuler
          </button>
          <button type="submit" className="btn-primary px-6" disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer et analyser →'}
          </button>
        </div>
      </form>
    </div>
  );
}

function EF({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">
        {label}
        {hint && <span className="text-gray-400 font-normal ml-1">({hint})</span>}
      </label>
      {children}
    </div>
  );
}

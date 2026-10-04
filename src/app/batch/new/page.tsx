'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { saveBatch, generateBatchId } from '@/lib/storage';
import type { BatchFormData, PhaseNumber, ModuleType } from '@/types/batch';
import AlertBadge from '@/components/AlertBadge';
import EnvFields from '@/components/EnvFields';
import { rememberOperator, rememberedOperator } from '@/components/BatchActions';
import { detectAlerts } from '@/types/batch';

const defaultEnv = {
  temperature_air_jour: 24,
  temperature_air_nuit: 18,
  humidite_relative: 55,
  pH: 6.0,
  EC: 1.4,
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
    MODULE_TYPE: 48,
    MODULE_ID: '',
    OPERATEUR: '',
    DATE_SEMIS: new Date().toISOString().slice(0, 10),
    DONNEES_ENVIRONNEMENTALES: defaultEnv,
    HISTORIQUE_TAILLES: '',
    DERNIERS_RELEVES_RACINAIRES: '',
    notes: '',
  });

  useEffect(() => {
    generateBatchId().then((id) => setForm((f) => ({ ...f, BATCH_ID: id })));
    const op = rememberedOperator();
    if (op) setForm((f) => ({ ...f, OPERATEUR: f.OPERATEUR || op }));
  }, []);

  const alerts = detectAlerts(form.DONNEES_ENVIRONNEMENTALES);

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
      rememberOperator(form.OPERATEUR ?? '');
      await saveBatch({
        ...form,
        SOUCHE: form.SOUCHE.trim(),
        MODULE_ID: form.MODULE_ID?.trim() || undefined,
        OPERATEUR: form.OPERATEUR?.trim() || undefined,
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
          Enregistrez la cohorte à son entrée dans le module : le suivi (relevés, changements de niveau, récolte) se fait ensuite depuis la fiche du batch.
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
              <label className="label">Souche *</label>
              <input
                className="input"
                placeholder="ex : Beldiya Auto, Auto Sour RNA…"
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
                  <option key={n} value={n}>{n} plants{n === 48 ? ' (standard)' : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Module A-Frame</label>
              <input
                className="input font-mono"
                placeholder="ex : A-03"
                value={form.MODULE_ID}
                onChange={(e) => setForm((f) => ({ ...f, MODULE_ID: e.target.value.toUpperCase() }))}
              />
            </div>
            <div>
              <label className="label">Responsable du batch</label>
              <input
                className="input"
                placeholder="Nom de l'opérateur"
                autoComplete="name"
                value={form.OPERATEUR}
                onChange={(e) => setForm((f) => ({ ...f, OPERATEUR: e.target.value }))}
              />
            </div>
          </div>
        </section>

        {/* Phase */}
        <section className="card">
          <div className="section-title">Niveau de départ</div>
          <div className="grid sm:grid-cols-3 gap-3 mb-4">
            {([1, 2, 3] as PhaseNumber[]).map((ph) => {
              const labels = { 1: 'Niveau 1 — Croissance', 2: 'Niveau 2 — Stretch', 3: 'Niveau 3 — Floraison' };
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
              <label className="label">Jour dans ce niveau * <span className="text-gray-400 font-normal">(1 pour une entrée aujourd&apos;hui)</span></label>
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
          <div className="section-title">Premier relevé environnemental</div>
          {alerts.length > 0 && (
            <div className="mb-4">
              <AlertBadge alerts={alerts} />
            </div>
          )}
          <EnvFields
            value={form.DONNEES_ENVIRONNEMENTALES}
            phase={form.PHASE_NUMBER}
            onChange={(k, v) => setEnv(k, v)}
          />
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
            {saving ? 'Enregistrement…' : 'Créer le batch →'}
          </button>
        </div>
      </form>
    </div>
  );
}

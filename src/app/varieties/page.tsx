'use client';
import { useCallback, useEffect, useState } from 'react';
import type { Variety, VarietyStatus } from '@/types/variety';
import { VARIETY_STATUS_LABELS } from '@/types/variety';
import { computeCycle, validateCycle, DEFAULT_NURSERY_DAYS } from '@/lib/cycle';
import { parseVarietiesCsv, VARIETY_CSV_EXAMPLE, fitsModule } from '@/lib/varieties';
import { getVarieties, addVariety, removeVariety, importVarieties } from '@/lib/catalog';

const STATUS_STYLE: Record<VarietyStatus, string> = {
  exemple: 'bg-gray-100 text-gray-700',
  a_verifier: 'bg-amber-100 text-amber-800',
  verifie: 'bg-green-100 text-green-800',
};

const EMPTY = { name: '', breeder: '', nurseryDays: String(DEFAULT_NURSERY_DAYS), totalDays: '', heightMaxCm: '', thcPct: '', cbdPct: '', source: '' };

const numOrUndef = (v: string) => (v.trim() === '' ? undefined : Number(v.replace(',', '.')));

export default function VarietiesPage() {
  const [items, setItems] = useState<Variety[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [csv, setCsv] = useState('');
  const [importMsg, setImportMsg] = useState('');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => setItems(await getVarieties()), []);
  useEffect(() => { void load(); }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const nurseryDays = Number(form.nurseryDays);
    const totalDays = Number(form.totalDays);
    const problem = validateCycle({ nurseryDays, totalDays });
    if (!form.name.trim()) return setError('Nom obligatoire');
    if (problem) return setError(problem);
    setError('');
    await addVariety({
      name: form.name.trim(),
      breeder: form.breeder.trim(),
      nurseryDays,
      totalDays,
      heightMaxCm: numOrUndef(form.heightMaxCm),
      thcPct: numOrUndef(form.thcPct),
      cbdPct: numOrUndef(form.cbdPct),
      source: form.source.trim() || undefined,
      status: 'a_verifier',
    });
    setForm(EMPTY);
    await load();
  }

  async function runImport() {
    const res = parseVarietiesCsv(csv);
    const { added, skipped } = await importVarieties(res.ok);
    const errs = res.errors.map((e) => `ligne ${e.line} : ${e.message}`).join(' · ');
    setImportMsg(`${added} ajoutée(s), ${skipped} déjà présente(s)${errs ? ` — ${res.errors.length} erreur(s) : ${errs}` : ''}`);
    if (added > 0) setCsv('');
    await load();
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) setCsv(await f.text());
  }

  const q = query.trim().toLowerCase();
  const shown = items.filter((v) => !q || `${v.name} ${v.breeder}`.toLowerCase().includes(q));

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Variétés autofloraison</h1>
        <p className="text-sm text-gray-600">
          Chaque variété a ses durées : nurserie, puis le temps restant est partagé en 3 phases égales (croissance, stretch, floraison).
          Les variétés importées restent « À vérifier » tant que la fiche breeder ou le COA n&apos;est pas confirmé.
        </p>
      </div>

      <section className="card">
        <h2 className="section-title">Ajouter une variété</h2>
        <form onSubmit={submit} className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="col-span-2"><label className="label">Nom *</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="col-span-2"><label className="label">Breeder</label>
            <input className="input" value={form.breeder} onChange={(e) => setForm({ ...form, breeder: e.target.value })} /></div>
          <div><label className="label">Nurserie (j) *</label>
            <input className="input" inputMode="numeric" value={form.nurseryDays} onChange={(e) => setForm({ ...form, nurseryDays: e.target.value })} /></div>
          <div><label className="label">Durée totale seed-to-yield (j) *</label>
            <input className="input" inputMode="numeric" value={form.totalDays} onChange={(e) => setForm({ ...form, totalDays: e.target.value })} /></div>
          <div><label className="label">Hauteur adulte max (cm)</label>
            <input className="input" inputMode="numeric" value={form.heightMaxCm} onChange={(e) => setForm({ ...form, heightMaxCm: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label">THC %</label>
              <input className="input" inputMode="decimal" value={form.thcPct} onChange={(e) => setForm({ ...form, thcPct: e.target.value })} /></div>
            <div><label className="label">CBD %</label>
              <input className="input" inputMode="decimal" value={form.cbdPct} onChange={(e) => setForm({ ...form, cbdPct: e.target.value })} /></div>
          </div>
          <div className="col-span-2 md:col-span-3"><label className="label">Source (URL fiche, COA)</label>
            <input className="input" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} /></div>
          <div className="flex items-end"><button className="btn-primary w-full justify-center" type="submit">Ajouter</button></div>
        </form>
        {form.totalDays && !validateCycle({ nurseryDays: Number(form.nurseryDays), totalDays: Number(form.totalDays) }) && (
          <p className="mt-2 text-xs text-gray-600">
            → {(() => { const p = computeCycle({ nurseryDays: Number(form.nurseryDays), totalDays: Number(form.totalDays) });
              return `phases de ${p.phaseDays.toFixed(1)} j, intégration au jour ${p.integrationDay}, ${p.harvestsPerYear.toFixed(1)} récoltes/an`; })()}
          </p>
        )}
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </section>

      <section className="card">
        <h2 className="section-title">Importer un catalogue (CSV)</h2>
        <p className="text-xs text-gray-600 mb-2">
          Colonnes : name ; breeder ; nursery_days ; total_days ; height_min_cm ; height_max_cm ; thc_pct ; cbd_pct ; status ; source ; notes
          (les 3 premières sont obligatoires). Les doublons (nom + breeder) sont ignorés.
        </p>
        <div className="flex flex-wrap gap-2 mb-2">
          <input type="file" accept=".csv,text/csv,text/plain" onChange={onFile} className="text-sm" />
          <button type="button" className="btn-secondary" onClick={() => setCsv(VARIETY_CSV_EXAMPLE)}>Insérer le modèle</button>
        </div>
        <textarea className="input font-mono text-xs" rows={5} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder="Coller le CSV ici" />
        <div className="mt-2 flex items-center gap-3">
          <button type="button" className="btn-primary" disabled={!csv.trim()} onClick={runImport}>Importer</button>
          {importMsg && <span className="text-xs text-gray-700">{importMsg}</span>}
        </div>
      </section>

      <section className="card">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="section-title !mb-0">Catalogue ({items.length})</h2>
          <input className="input max-w-xs" placeholder="Rechercher…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {shown.length === 0 ? (
          <p className="text-sm text-gray-500">Aucune variété.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b">
                  <th className="py-2 pr-3">Variété</th><th className="pr-3">Nurserie</th><th className="pr-3">Total</th>
                  <th className="pr-3">Phase</th><th className="pr-3">Récoltes/an</th><th className="pr-3">Hauteur</th><th className="pr-3">Statut</th><th />
                </tr>
              </thead>
              <tbody>
                {shown.map((v) => {
                  const p = computeCycle(v);
                  return (
                    <tr key={v.id} className="border-b last:border-0">
                      <td className="py-2 pr-3"><div className="font-medium">{v.name}</div><div className="text-xs text-gray-500">{v.breeder}</div></td>
                      <td className="pr-3">{v.nurseryDays} j</td>
                      <td className="pr-3">{v.totalDays} j</td>
                      <td className="pr-3">{p.phaseDays.toFixed(1)} j</td>
                      <td className="pr-3">{p.harvestsPerYear.toFixed(1)}</td>
                      <td className="pr-3">
                        {v.heightMaxCm ? `≤ ${v.heightMaxCm} cm` : '—'}
                        {!fitsModule(v) && <span className="ml-1 text-xs text-red-600" title="Dépasse 120 cm : ne tient pas au niveau 3">⚠</span>}
                      </td>
                      <td className="pr-3"><span className={`px-2 py-0.5 rounded text-xs ${STATUS_STYLE[v.status]}`}>{VARIETY_STATUS_LABELS[v.status]}</span></td>
                      <td className="text-right">
                        <button className="text-xs text-red-600 hover:underline" onClick={async () => {
                          if (confirm(`Supprimer « ${v.name} » ?`)) { await removeVariety(v.id); await load(); }
                        }}>Supprimer</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

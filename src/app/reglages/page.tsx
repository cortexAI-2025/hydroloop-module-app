'use client';
import { useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, loadSettings, resetThresholds, saveSettings } from '@/lib/settings';
import type { AppSettings } from '@/lib/settings';
import { enableReminders } from '@/lib/reminders';
import { METRIC_KEYS, METRIC_META } from '@/lib/thresholds';
import type { MetricKey, Severity } from '@/lib/thresholds';

const num = (v: string): number | undefined => (v.trim() === '' || Number.isNaN(Number(v)) ? undefined : Number(v));

export default function SettingsPage() {
  const [s, setS] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => { void loadSettings().then(setS); }, []);

  const setMetric = (k: MetricKey, patch: Partial<AppSettings['thresholds']['metrics'][MetricKey]>) =>
    setS((cur) => ({ ...cur, thresholds: { ...cur.thresholds, metrics: { ...cur.thresholds.metrics, [k]: { ...cur.thresholds.metrics[k], ...patch } } } }));

  async function save() {
    const r = await saveSettings(s);
    setMsg(r.saved ? { ok: true, text: 'Réglages enregistrés. Ils s’appliquent immédiatement aux alertes, rapports et prévisions.' } : { ok: false, text: r.errors.join(' ') });
  }

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-6 sm:py-8 space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Réglages agronomiques</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Seuils d’alerte et durées utilisés partout dans l’application. Les valeurs par défaut sont indicatives (voir <code>docs/SEUILS.md</code>) : adaptez-les à votre variété et à votre installation.
        </p>
      </div>

      {msg && <div role="status" className={`rounded-lg px-4 py-2 text-sm border ${msg.ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-700'}`}>{msg.text}</div>}

      <section className="card overflow-x-auto">
        <div className="section-title">Seuils par paramètre</div>
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b">
              <th className="py-1.5 pr-2">Paramètre</th><th>Actif</th><th>Minimum</th><th>Maximum</th><th>Gravité</th>
            </tr>
          </thead>
          <tbody>
            {METRIC_KEYS.map((k) => {
              const r = s.thresholds.metrics[k];
              return (
                <tr key={k} className="border-b border-gray-50 align-top">
                  <td className="py-2 pr-2">
                    <div className="font-medium text-gray-800">{METRIC_META[k].label} <span className="text-gray-400 text-xs">{METRIC_META[k].unit}</span></div>
                    <div className="text-xs text-gray-500 max-w-xs">{METRIC_META[k].rationale}</div>
                  </td>
                  <td><input type="checkbox" checked={r.enabled} aria-label={`Activer l’alerte ${METRIC_META[k].label}`} onChange={(e) => setMetric(k, { enabled: e.target.checked })} /></td>
                  <td><input className="input w-24" inputMode="decimal" aria-label={`Minimum ${METRIC_META[k].label}`} value={r.min ?? ''} placeholder="—" onChange={(e) => setMetric(k, { min: num(e.target.value) })} /></td>
                  <td><input className="input w-24" inputMode="decimal" aria-label={`Maximum ${METRIC_META[k].label}`} value={r.max ?? ''} placeholder="—" onChange={(e) => setMetric(k, { max: num(e.target.value) })} /></td>
                  <td>
                    <select className="input" aria-label={`Gravité ${METRIC_META[k].label}`} value={r.severity} onChange={(e) => setMetric(k, { severity: e.target.value as Severity })}>
                      <option value="warning">Avertissement</option><option value="danger">Danger</option>
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="card">
        <div className="section-title">EC cible par niveau (mS/cm)</div>
        <div className="grid sm:grid-cols-3 gap-3">
          {([1, 2, 3] as const).map((lvl) => (
            <div key={lvl} className="flex items-center gap-2 text-sm">
              <span className="w-16 text-gray-600">Niveau {lvl}</span>
              {[0, 1].map((i) => (
                <input key={i} className="input w-20" inputMode="decimal" aria-label={`EC ${i === 0 ? 'minimum' : 'maximum'} niveau ${lvl}`}
                  value={s.thresholds.ecByLevel[lvl][i]}
                  onChange={(e) => {
                    const v = num(e.target.value) ?? 0;
                    setS((cur) => { const pair = [...cur.thresholds.ecByLevel[lvl]] as [number, number]; pair[i] = v; return { ...cur, thresholds: { ...cur.thresholds, ecByLevel: { ...cur.thresholds.ecByLevel, [lvl]: pair } } }; });
                  }} />
              ))}
            </div>
          ))}
        </div>
      </section>

      <section className="card grid sm:grid-cols-2 gap-4 text-sm">
        <div className="sm:col-span-2 section-title">Durées et relevés</div>
        <label className="block">Relevé en retard après (heures)
          <input className="input mt-1 w-28" inputMode="numeric" value={s.thresholds.readingDueHours} onChange={(e) => setS({ ...s, thresholds: { ...s.thresholds, readingDueHours: num(e.target.value) ?? 0 } })} />
        </label>
        <div>
          <div className="mb-1">Durée cible des niveaux pour les <em>nouveaux</em> batches (jours)</div>
          <div className="flex gap-2">
            {([1, 2, 3] as const).map((lvl) => (
              <input key={lvl} className="input w-20" inputMode="numeric" aria-label={`Durée niveau ${lvl}`} value={s.thresholds.levelTargetDays[lvl]}
                onChange={(e) => setS({ ...s, thresholds: { ...s.thresholds, levelTargetDays: { ...s.thresholds.levelTargetDays, [lvl]: num(e.target.value) ?? 0 } } })} />
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1">Fourchette de durée du niveau 3 pour la prévision de récolte (jours)</div>
          <div className="flex gap-2">
            <input className="input w-20" inputMode="numeric" aria-label="Durée minimale niveau 3" value={s.thresholds.harvestWindow.minDays} onChange={(e) => setS({ ...s, thresholds: { ...s.thresholds, harvestWindow: { ...s.thresholds.harvestWindow, minDays: num(e.target.value) ?? 0 } } })} />
            <input className="input w-20" inputMode="numeric" aria-label="Durée maximale niveau 3" value={s.thresholds.harvestWindow.maxDays} onChange={(e) => setS({ ...s, thresholds: { ...s.thresholds, harvestWindow: { ...s.thresholds.harvestWindow, maxDays: num(e.target.value) ?? 0 } } })} />
          </div>
        </div>
        <label className="flex items-center gap-2 sm:col-span-2">
          <input type="checkbox" checked={s.reminders} onChange={async (e) => {
            const on = e.target.checked;
            if (on && !(await enableReminders())) { setMsg({ ok: false, text: 'Notifications refusées ou indisponibles sur cet appareil.' }); return; }
            setS({ ...s, reminders: on });
          }} />
          Rappels de relevé en retard (notification locale quand l’application est ouverte)
        </label>
      </section>

      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" onClick={save}>Enregistrer</button>
        <button className="btn-secondary" onClick={async () => { setS(await resetThresholds(s)); setMsg({ ok: true, text: 'Seuils par défaut rétablis.' }); }}>Rétablir les valeurs par défaut</button>
      </div>
    </div>
  );
}

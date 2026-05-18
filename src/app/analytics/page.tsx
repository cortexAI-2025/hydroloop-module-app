'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getBatches } from '@/lib/storage';
import { pushAll, pullAll } from '@/lib/sync';
import { isCloudEnabled } from '@/lib/supabase';
import type { BatchRecord } from '@/types/batch';
import { PHASE_LABELS, detectAlerts } from '@/types/batch';

interface Stats {
  total: number;
  withReport: number;
  alertRate: number; // % of batches with at least one alert
  strainCounts: [string, number][];
  phaseCounts: [string, number][];
  moduleCounts: [string, number][];
  alertBreakdown: { label: string; count: number; pct: number }[];
  avgEnv: Record<string, number>;
  timeline: { date: string; count: number }[];
}

function compute(batches: BatchRecord[]): Stats {
  const total = batches.length;
  const withReport = batches.filter((b) => b.report).length;

  // Strain counts
  const strainMap = new Map<string, number>();
  for (const b of batches) strainMap.set(b.data.SOUCHE, (strainMap.get(b.data.SOUCHE) ?? 0) + 1);
  const strainCounts = [...strainMap.entries()].sort((a, b) => b[1] - a[1]);

  // Phase counts
  const phaseMap = new Map<string, number>();
  for (const b of batches) {
    const label = `Phase ${b.data.PHASE_NUMBER} — ${PHASE_LABELS[b.data.PHASE_NUMBER]}`;
    phaseMap.set(label, (phaseMap.get(label) ?? 0) + 1);
  }
  const phaseCounts = [...phaseMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  // Module counts
  const modMap = new Map<string, number>();
  for (const b of batches) {
    const k = `${b.data.MODULE_TYPE} plants`;
    modMap.set(k, (modMap.get(k) ?? 0) + 1);
  }
  const moduleCounts = [...modMap.entries()].sort((a, b) => {
    return parseInt(a[0]) - parseInt(b[0]);
  });

  // Alert rate and breakdown
  const alertFields: Record<string, { label: string; count: number }> = {
    pH: { label: 'pH hors plage (5.5–6.5)', count: 0 },
    oxygene_dissous: { label: 'O₂ dissous < 6 mg/L', count: 0 },
    temperature_solution: { label: 'T° solution > 22°C', count: 0 },
    EC: { label: 'EC hors plage (0.8–3.0)', count: 0 },
    debit_NFT: { label: 'Débit NFT < 0.5 L/min', count: 0 },
  };

  let alertedBatches = 0;
  for (const b of batches) {
    const alerts = detectAlerts(b.data.DONNEES_ENVIRONNEMENTALES);
    if (alerts.length > 0) alertedBatches++;
    const seenFields = new Set<string>();
    for (const a of alerts) {
      if (!seenFields.has(a.field) && alertFields[a.field]) {
        alertFields[a.field].count++;
        seenFields.add(a.field);
      }
    }
  }

  const alertBreakdown = Object.values(alertFields)
    .map((a) => ({ ...a, pct: total > 0 ? Math.round((a.count / total) * 100) : 0 }))
    .sort((a, b) => b.count - a.count)
    .filter((a) => a.count > 0 || true);

  // Average env values
  const envKeys = [
    'pH', 'EC', 'oxygene_dissous', 'temperature_solution',
    'temperature_air_jour', 'humidite_relative', 'PPFD', 'debit_NFT',
  ] as const;
  const avgEnv: Record<string, number> = {};
  if (total > 0) {
    for (const k of envKeys) {
      const sum = batches.reduce((s, b) => s + (b.data.DONNEES_ENVIRONNEMENTALES[k] as number), 0);
      avgEnv[k] = Math.round((sum / total) * 10) / 10;
    }
  }

  // Timeline (last 60 days, group by date)
  const dateMap = new Map<string, number>();
  for (const b of batches) {
    const d = b.createdAt.slice(0, 10);
    dateMap.set(d, (dateMap.get(d) ?? 0) + 1);
  }
  const timeline = [...dateMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-30)
    .map(([date, count]) => ({ date, count }));

  return {
    total,
    withReport,
    alertRate: total > 0 ? Math.round((alertedBatches / total) * 100) : 0,
    strainCounts,
    phaseCounts,
    moduleCounts,
    alertBreakdown,
    avgEnv,
    timeline,
  };
}

export default function AnalyticsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const cloudEnabled = isCloudEnabled();

  useEffect(() => {
    getBatches().then((b) => setStats(compute(b)));
  }, []);

  async function handlePushAll() {
    setSyncing(true);
    setSyncMsg('');
    const result = await pushAll();
    setSyncMsg(
      result.error
        ? `Erreur : ${result.error}`
        : `✅ ${result.pushed} batch${result.pushed > 1 ? 'es' : ''} synchronisé${result.pushed > 1 ? 's' : ''} vers le cloud.`,
    );
    setSyncing(false);
  }

  async function handlePullAll() {
    setSyncing(true);
    setSyncMsg('');
    await pullAll();
    const b = await getBatches();
    setStats(compute(b));
    setSyncMsg('✅ Données synchronisées depuis le cloud.');
    setSyncing(false);
  }

  if (!stats) return <Loader />;

  const maxStrain = Math.max(1, ...stats.strainCounts.map(([, n]) => n));
  const maxAlert = Math.max(1, ...stats.alertBreakdown.map((a) => a.count));
  const maxTimeline = Math.max(1, ...stats.timeline.map((t) => t.count));

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analytiques</h1>
          <p className="text-sm text-gray-500 mt-0.5">Vue globale de la production HydroLoop™</p>
        </div>
        {cloudEnabled && (
          <div className="flex items-center gap-2 flex-wrap">
            {syncMsg && <span className="text-xs text-gray-600">{syncMsg}</span>}
            <button className="btn-secondary text-xs" onClick={handlePullAll} disabled={syncing}>
              ↓ Sync cloud → local
            </button>
            <button className="btn-primary text-xs" onClick={handlePushAll} disabled={syncing}>
              ↑ Sync local → cloud
            </button>
          </div>
        )}
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <StatCard label="Batches total" value={stats.total} icon="🌿" color="text-brand-700" />
        <StatCard label="Rapports générés" value={`${stats.withReport}/${stats.total}`} icon="📊" color="text-blue-700" />
        <StatCard label="Taux d'alertes" value={`${stats.alertRate}%`} icon="⚠️" color={stats.alertRate > 50 ? 'text-red-600' : 'text-amber-600'} />
        <StatCard label="Souches distinctes" value={stats.strainCounts.length} icon="🧬" color="text-purple-700" />
      </div>

      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        {/* Strain distribution */}
        <div className="card">
          <div className="section-title mb-4">Batches par souche</div>
          {stats.strainCounts.length === 0 ? (
            <Empty />
          ) : (
            <div className="space-y-3">
              {stats.strainCounts.map(([strain, n]) => (
                <div key={strain} className="flex items-center gap-3">
                  <Link
                    href={`/batch/compare/${encodeURIComponent(strain)}`}
                    className="w-32 text-sm text-brand-700 hover:underline text-right truncate shrink-0"
                  >
                    {strain}
                  </Link>
                  <div className="flex-1 bg-gray-100 rounded-full h-6 overflow-hidden">
                    <div
                      className="h-full bg-brand-500 rounded-full flex items-center justify-end pr-2 transition-all"
                      style={{ width: `${(n / maxStrain) * 100}%` }}
                    >
                      <span className="text-xs text-white font-bold">{n}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Alert breakdown */}
        <div className="card">
          <div className="section-title mb-4">Fréquence des alertes</div>
          {stats.alertBreakdown.every((a) => a.count === 0) ? (
            <div className="text-center py-8 text-green-600 font-semibold">
              ✅ Aucune alerte détectée sur l'ensemble des batches
            </div>
          ) : (
            <div className="space-y-3">
              {stats.alertBreakdown.map((a) => (
                <div key={a.label} className="flex items-center gap-3">
                  <div className="w-40 text-xs text-gray-600 text-right shrink-0">{a.label}</div>
                  <div className="flex-1 bg-gray-100 rounded-full h-6 overflow-hidden">
                    <div
                      className={`h-full rounded-full flex items-center justify-end pr-2 transition-all ${a.pct > 50 ? 'bg-red-500' : a.pct > 25 ? 'bg-amber-500' : 'bg-gray-400'}`}
                      style={{ width: a.count > 0 ? `${(a.count / maxAlert) * 100}%` : '0%' }}
                    >
                      {a.count > 0 && <span className="text-xs text-white font-bold">{a.count}</span>}
                    </div>
                  </div>
                  <div className="text-xs text-gray-400 w-8 text-right shrink-0">{a.pct}%</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6 mb-6">
        {/* Phase distribution */}
        <div className="card">
          <div className="section-title mb-4">Répartition des phases</div>
          <div className="space-y-3">
            {stats.phaseCounts.map(([phase, n]) => {
              const colors = ['bg-blue-400', 'bg-amber-400', 'bg-purple-400'];
              const idx = parseInt(phase[6]) - 1;
              return (
                <div key={phase} className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full shrink-0 ${colors[idx]}`} />
                  <div className="text-sm text-gray-600 flex-1">{phase}</div>
                  <div className="text-sm font-bold text-gray-800">{n}</div>
                </div>
              );
            })}
            {stats.phaseCounts.length === 0 && <Empty />}
          </div>
        </div>

        {/* Module distribution */}
        <div className="card">
          <div className="section-title mb-4">Modules utilisés</div>
          <div className="space-y-3">
            {stats.moduleCounts.map(([mod, n]) => (
              <div key={mod} className="flex items-center gap-3">
                <div className="text-sm text-gray-600 flex-1">{mod}</div>
                <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                  <div
                    className="h-full bg-brand-400 rounded-full transition-all"
                    style={{ width: `${(n / stats.total) * 100}%` }}
                  />
                </div>
                <div className="text-sm font-bold text-gray-800 w-6 text-right">{n}</div>
              </div>
            ))}
            {stats.moduleCounts.length === 0 && <Empty />}
          </div>
        </div>

        {/* Avg env values */}
        <div className="card">
          <div className="section-title mb-4">Moyennes environnementales</div>
          {stats.total === 0 ? <Empty /> : (
            <div className="space-y-1.5 text-sm">
              <AvgRow label="pH" value={stats.avgEnv.pH} good={stats.avgEnv.pH >= 5.5 && stats.avgEnv.pH <= 6.5} />
              <AvgRow label="EC" value={`${stats.avgEnv.EC} mS/cm`} good={stats.avgEnv.EC >= 0.8 && stats.avgEnv.EC <= 3.0} />
              <AvgRow label="O₂" value={`${stats.avgEnv.oxygene_dissous} mg/L`} good={stats.avgEnv.oxygene_dissous >= 6} />
              <AvgRow label="T° solution" value={`${stats.avgEnv.temperature_solution}°C`} good={stats.avgEnv.temperature_solution <= 22} />
              <AvgRow label="T° air" value={`${stats.avgEnv.temperature_air_jour}°C`} good />
              <AvgRow label="Humidité" value={`${stats.avgEnv.humidite_relative}%`} good={stats.avgEnv.humidite_relative >= 40 && stats.avgEnv.humidite_relative <= 70} />
              <AvgRow label="PPFD" value={`${stats.avgEnv.PPFD} µ`} good />
              <AvgRow label="Débit NFT" value={`${stats.avgEnv.debit_NFT} L/min`} good={stats.avgEnv.debit_NFT >= 0.5} />
            </div>
          )}
        </div>
      </div>

      {/* Activity timeline */}
      {stats.timeline.length > 0 && (
        <div className="card">
          <div className="section-title mb-4">Activité — 30 derniers jours</div>
          <div className="flex items-end gap-1.5 h-24">
            {stats.timeline.map((t) => (
              <div key={t.date} className="flex-1 flex flex-col items-center gap-1" title={`${t.date} : ${t.count} batch${t.count > 1 ? 'es' : ''}`}>
                <div
                  className="w-full bg-brand-500 rounded-t transition-all hover:bg-brand-600"
                  style={{ height: `${Math.max(4, (t.count / maxTimeline) * 80)}px` }}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>{stats.timeline[0]?.date}</span>
            <span>{stats.timeline[stats.timeline.length - 1]?.date}</span>
          </div>
        </div>
      )}

      {/* Cloud sync setup prompt */}
      {!cloudEnabled && (
        <div className="card mt-6 bg-blue-50 border-blue-200">
          <div className="flex items-start gap-3">
            <span className="text-2xl">☁️</span>
            <div>
              <div className="font-semibold text-blue-800 mb-1">Sauvegarde cloud désactivée</div>
              <div className="text-sm text-blue-700">
                Configurez Supabase pour synchroniser vos données entre appareils et éviter toute perte navigateur.
                Ajoutez <code className="bg-blue-100 px-1 rounded">NEXT_PUBLIC_SUPABASE_URL</code> et{' '}
                <code className="bg-blue-100 px-1 rounded">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> dans{' '}
                <code className="bg-blue-100 px-1 rounded">.env.local</code>.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: string | number;
  icon: string;
  color: string;
}) {
  return (
    <div className="card flex items-center gap-3">
      <span className="text-2xl">{icon}</span>
      <div>
        <div className={`text-2xl font-bold ${color}`}>{value}</div>
        <div className="text-xs text-gray-500">{label}</div>
      </div>
    </div>
  );
}

function AvgRow({ label, value, good }: { label: string; value: string | number; good: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-500">{label}</span>
      <span className={`font-semibold ${good ? 'text-brand-700' : 'text-red-600'}`}>
        {value} {good ? '✓' : '⚠'}
      </span>
    </div>
  );
}

function Empty() {
  return <div className="text-xs text-gray-400 text-center py-4">Aucune donnée</div>;
}

function Loader() {
  return (
    <div className="flex items-center justify-center h-64 gap-3 text-gray-400">
      <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      Calcul des analytiques…
    </div>
  );
}

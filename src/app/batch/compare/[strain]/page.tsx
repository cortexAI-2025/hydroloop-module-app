'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { getBatchesByStrain } from '@/lib/storage';
import type { BatchRecord, EnvironmentalData } from '@/types/batch';
import { PHASE_LABELS, PHASE_COLORS } from '@/types/batch';

const ENV_METRICS: Array<{
  key: keyof EnvironmentalData;
  label: string;
  unit: string;
  isWarn: (v: number) => boolean;
  decimals?: number;
}> = [
  { key: 'pH', label: 'pH', unit: '', isWarn: (v) => v < 5.5 || v > 6.5, decimals: 1 },
  { key: 'EC', label: 'EC', unit: 'mS/cm', isWarn: (v) => v < 0.8 || v > 3.0, decimals: 1 },
  { key: 'oxygene_dissous', label: 'O₂', unit: 'mg/L', isWarn: (v) => v < 6, decimals: 1 },
  { key: 'temperature_solution', label: 'T° solution', unit: '°C', isWarn: (v) => v > 22, decimals: 1 },
  { key: 'temperature_air_jour', label: 'T° air jour', unit: '°C', isWarn: (v) => v > 28, decimals: 1 },
  { key: 'humidite_relative', label: 'Humidité', unit: '%', isWarn: (v) => v > 70 || v < 30 },
  { key: 'PPFD', label: 'PPFD', unit: 'µ', isWarn: (v) => v < 400 },
  { key: 'debit_NFT', label: 'Débit NFT', unit: 'L/min', isWarn: (v) => v < 0.5, decimals: 1 },
];

export default function ComparePage() {
  const { strain: encodedStrain } = useParams<{ strain: string }>();
  const strain = decodeURIComponent(encodedStrain || '');
  const [batches, setBatches] = useState<BatchRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getBatchesByStrain(strain).then((b) => { setBatches(b); setLoading(false); });
  }, [strain]);

  if (loading) return <Loader />;

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-5">
        <Link href="/" className="hover:text-brand-700">Tableau de bord</Link>
        <span>/</span>
        <span className="text-gray-800 font-medium">Comparaison — {strain}</span>
      </div>

      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{strain}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {batches.length} batch{batches.length > 1 ? 'es' : ''} enregistré{batches.length > 1 ? 's' : ''}
          </p>
        </div>
        <Link href="/batch/new" className="btn-primary text-sm">+ Nouveau batch</Link>
      </div>

      {batches.length === 0 ? (
        <div className="card text-center py-12 text-gray-500">
          Aucun batch trouvé pour la souche <strong>{strain}</strong>.
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <StatCard label="Batches" value={batches.length} icon="📦" />
            <StatCard label="Avec rapport" value={batches.filter((b) => b.report).length} icon="📊" />
            <StatCard label="En floraison" value={batches.filter((b) => b.data.PHASE_NUMBER === 3).length} icon="🌸" />
            <StatCard
              label="Module principal"
              value={`${mode(batches.map((b) => b.data.MODULE_TYPE))} pl.`}
              icon="🏗️"
            />
          </div>

          {/* Batch summary cards */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            {batches.map((b) => (
              <BatchSummaryCard key={b.id} record={b} />
            ))}
          </div>

          {/* Env comparison table */}
          <div className="card overflow-x-auto">
            <div className="section-title mb-3">Comparaison des paramètres environnementaux</div>
            <table className="w-full text-sm border-collapse min-w-[500px]">
              <thead>
                <tr className="bg-brand-700 text-white">
                  <th className="px-3 py-2 text-left font-semibold rounded-tl-md">Paramètre</th>
                  {batches.map((b) => (
                    <th key={b.id} className="px-3 py-2 text-center font-semibold">
                      <div className="text-xs opacity-90 font-mono">{b.data.BATCH_ID}</div>
                      <div className="text-xs opacity-75">J{b.data.PHASE_DAY}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ENV_METRICS.map((m, mi) => (
                  <tr key={m.key} className={mi % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-3 py-2 font-medium text-gray-700">
                      {m.label}
                      {m.unit && <span className="text-gray-400 text-xs ml-1">({m.unit})</span>}
                    </td>
                    {batches.map((b) => {
                      const raw = b.data.DONNEES_ENVIRONNEMENTALES[m.key];
                      const v = typeof raw === 'number' ? raw : parseFloat(raw as string);
                      const warn = !isNaN(v) && m.isWarn(v);
                      return (
                        <td
                          key={b.id}
                          className={`px-3 py-2 text-center font-semibold ${
                            warn ? 'text-red-600 bg-red-50' : 'text-gray-800'
                          }`}
                        >
                          {typeof raw === 'string'
                            ? raw
                            : m.decimals !== undefined
                              ? Number(raw).toFixed(m.decimals)
                              : raw}
                          {warn && <span className="ml-1 text-xs">⚠</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {/* Photopériode row */}
                <tr className="bg-white">
                  <td className="px-3 py-2 font-medium text-gray-700">Photopériode</td>
                  {batches.map((b) => (
                    <td key={b.id} className="px-3 py-2 text-center text-gray-700 font-mono text-xs">
                      {b.data.DONNEES_ENVIRONNEMENTALES.photopériode}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          {/* Mini bar charts for key metrics */}
          <div className="grid sm:grid-cols-2 gap-5 mt-6">
            <MetricChart
              label="pH solution"
              batches={batches}
              getValue={(b) => b.data.DONNEES_ENVIRONNEMENTALES.pH}
              min={5.0}
              max={7.0}
              good={{ lo: 5.5, hi: 6.5 }}
              unit=""
              decimals={1}
            />
            <MetricChart
              label="O₂ dissous (mg/L)"
              batches={batches}
              getValue={(b) => b.data.DONNEES_ENVIRONNEMENTALES.oxygene_dissous}
              min={0}
              max={12}
              good={{ lo: 6, hi: 12 }}
              unit=" mg/L"
              decimals={1}
            />
            <MetricChart
              label="EC (mS/cm)"
              batches={batches}
              getValue={(b) => b.data.DONNEES_ENVIRONNEMENTALES.EC}
              min={0}
              max={4}
              good={{ lo: 0.8, hi: 3.0 }}
              unit=" mS"
              decimals={1}
            />
            <MetricChart
              label="T° solution (°C)"
              batches={batches}
              getValue={(b) => b.data.DONNEES_ENVIRONNEMENTALES.temperature_solution}
              min={15}
              max={28}
              good={{ lo: 15, hi: 22 }}
              unit="°C"
              decimals={1}
            />
          </div>
        </>
      )}
    </div>
  );
}

function BatchSummaryCard({ record }: { record: BatchRecord }) {
  const { data } = record;
  const phase = data.PHASE_NUMBER;
  return (
    <div className="card hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="text-xs font-mono text-gray-400">{data.BATCH_ID}</div>
          <div className="text-sm font-semibold text-gray-800 mt-0.5">{fmt(data.DATE_SEMIS)}</div>
        </div>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${PHASE_COLORS[phase]}`}>
          {PHASE_LABELS[phase]} J{data.PHASE_DAY}
        </span>
      </div>
      <div className="text-xs text-gray-500 mb-3">{data.MODULE_TYPE} plants</div>
      <div className="flex items-center gap-2">
        <Link href={`/batch/${record.id}`} className="btn-primary text-xs py-1 px-3 flex-1 justify-center">
          {record.report ? 'Voir rapport' : 'Analyser'}
        </Link>
        <span className={`text-xs px-2 py-1 rounded ${record.report ? 'bg-brand-100 text-brand-700' : 'bg-gray-100 text-gray-400'}`}>
          {record.report ? '✓ Rapport' : '— En attente'}
        </span>
      </div>
    </div>
  );
}

function MetricChart({
  label,
  batches,
  getValue,
  min,
  max,
  good,
  unit,
  decimals,
}: {
  label: string;
  batches: BatchRecord[];
  getValue: (b: BatchRecord) => number;
  min: number;
  max: number;
  good: { lo: number; hi: number };
  unit: string;
  decimals: number;
}) {
  const range = max - min;

  return (
    <div className="card">
      <div className="section-title mb-3">{label}</div>
      {/* Good range indicator */}
      <div className="relative h-2 bg-gray-200 rounded-full mb-4">
        <div
          className="absolute h-full bg-brand-200 rounded-full"
          style={{
            left: `${((good.lo - min) / range) * 100}%`,
            width: `${((good.hi - good.lo) / range) * 100}%`,
          }}
        />
        <div
          className="absolute -top-1 text-xs text-gray-400 -translate-x-1/2"
          style={{ left: `${((good.lo - min) / range) * 100}%` }}
        />
      </div>
      <div className="space-y-2">
        {batches.map((b) => {
          const v = getValue(b);
          const pct = Math.max(0, Math.min(100, ((v - min) / range) * 100));
          const bad = v < good.lo || v > good.hi;
          return (
            <div key={b.id} className="flex items-center gap-3">
              <div className="text-xs font-mono text-gray-400 w-28 shrink-0">{b.data.BATCH_ID}</div>
              <div className="flex-1 relative">
                <div className="h-5 bg-gray-100 rounded overflow-hidden">
                  <div
                    className={`h-full rounded transition-all ${bad ? 'bg-red-400' : 'bg-brand-500'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                {/* Good zone marker */}
                <div
                  className="absolute top-0 bottom-0 border-l-2 border-brand-300 border-dashed opacity-50"
                  style={{ left: `${((good.lo - min) / range) * 100}%` }}
                />
                <div
                  className="absolute top-0 bottom-0 border-l-2 border-brand-300 border-dashed opacity-50"
                  style={{ left: `${Math.min(((good.hi - min) / range) * 100, 99)}%` }}
                />
              </div>
              <div className={`text-xs font-bold w-16 text-right ${bad ? 'text-red-600' : 'text-gray-700'}`}>
                {v.toFixed(decimals)}{unit}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-xs text-gray-400 mt-2">
        <span>{min}</span>
        <span className="text-brand-600">Zone optimale : {good.lo}–{good.hi}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string | number; icon: string }) {
  return (
    <div className="card flex items-center gap-3">
      <span className="text-2xl">{icon}</span>
      <div>
        <div className="text-xl font-bold text-brand-700">{value}</div>
        <div className="text-xs text-gray-500">{label}</div>
      </div>
    </div>
  );
}

function Loader() {
  return (
    <div className="flex items-center justify-center h-64 gap-3 text-gray-400">
      <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      Chargement…
    </div>
  );
}

function fmt(iso: string) {
  try { return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return iso; }
}

function mode<T>(arr: T[]): T {
  const counts = new Map<T, number>();
  for (const v of arr) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? arr[0];
}

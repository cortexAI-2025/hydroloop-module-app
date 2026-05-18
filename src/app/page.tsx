'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getBatches, deleteBatch } from '@/lib/storage';
import type { BatchRecord } from '@/types/batch';
import { PHASE_LABELS, PHASE_COLORS, detectAlerts } from '@/types/batch';

export default function DashboardPage() {
  const [batches, setBatches] = useState<BatchRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getBatches().then((b) => { setBatches(b); setLoading(false); });
  }, []);

  async function handleDelete(id: string) {
    if (!confirm(`Supprimer le batch ${id} ?`)) return;
    await deleteBatch(id);
    setBatches(await getBatches());
  }

  const strains = [...new Set(batches.map((b) => b.data.SOUCHE))];

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <StatCard label="Batches total" value={batches.length} icon="🌿" />
        <StatCard label="Phase 3 – Floraison" value={batches.filter((b) => b.data.PHASE_NUMBER === 3).length} icon="🌸" />
        <StatCard label="Rapports générés" value={batches.filter((b) => b.report).length} icon="📊" />
        <StatCard label="Souches distinctes" value={strains.length} icon="🧬" />
      </div>

      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h1 className="text-xl font-bold text-gray-900">Batches en cours</h1>
        <Link href="/batch/new" className="btn-primary">+ Nouveau batch</Link>
      </div>

      {/* Strain comparison shortcuts */}
      {strains.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-5">
          <span className="text-xs text-gray-500 self-center">Comparer souche :</span>
          {strains.map((s) => (
            <Link
              key={s}
              href={`/batch/compare/${encodeURIComponent(s)}`}
              className="text-xs px-2.5 py-1 rounded-full border border-brand-300 text-brand-700 hover:bg-brand-50 transition-colors"
            >
              {s} ({batches.filter((b) => b.data.SOUCHE === s).length})
            </Link>
          ))}
        </div>
      )}

      {loading ? (
        <div className="card flex items-center justify-center py-16 gap-3 text-gray-400">
          <Spinner />
          Chargement des batches…
        </div>
      ) : batches.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {batches.map((b) => (
            <BatchCard key={b.id} record={b} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: number; icon: string }) {
  return (
    <div className="card flex items-center gap-3">
      <span className="text-2xl">{icon}</span>
      <div>
        <div className="text-2xl font-bold text-brand-700">{value}</div>
        <div className="text-xs text-gray-500">{label}</div>
      </div>
    </div>
  );
}

function BatchCard({
  record,
  onDelete,
}: {
  record: BatchRecord;
  onDelete: (id: string) => void;
}) {
  const { data } = record;
  const alerts = detectAlerts(data.DONNEES_ENVIRONNEMENTALES);
  const phase = data.PHASE_NUMBER;
  const env = data.DONNEES_ENVIRONNEMENTALES;

  return (
    <div className="card hover:shadow-md transition-shadow print:hidden">
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="font-bold text-gray-900">{data.SOUCHE}</div>
          <div className="text-xs text-gray-400 font-mono mt-0.5">{data.BATCH_ID}</div>
        </div>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${PHASE_COLORS[phase]}`}>
          {PHASE_LABELS[phase]} J{data.PHASE_DAY}
        </span>
      </div>

      <div className="text-xs text-gray-500 mb-3">
        {data.MODULE_TYPE} plants · Semis {fmt(data.DATE_SEMIS)}
      </div>

      <div className="grid grid-cols-3 gap-1.5 mb-3">
        <Chip label="pH" value={env.pH} warn={env.pH < 5.5 || env.pH > 6.5} />
        <Chip label="EC" value={`${env.EC}mS`} />
        <Chip label="O₂" value={`${env.oxygene_dissous}mg/L`} warn={env.oxygene_dissous < 6} />
      </div>

      {alerts.length > 0 && (
        <div className="text-xs text-red-600 font-medium mb-2">
          {alerts.length} alerte{alerts.length > 1 ? 's' : ''} détectée{alerts.length > 1 ? 's' : ''}
        </div>
      )}

      <div className="flex items-center gap-2 mt-2">
        <Link
          href={`/batch/${record.id}`}
          className="btn-primary text-xs py-1 px-3 flex-1 justify-center"
        >
          {record.report ? 'Voir rapport' : 'Analyser'}
        </Link>
        <Link
          href={`/batch/compare/${encodeURIComponent(data.SOUCHE)}`}
          className="text-brand-600 hover:text-brand-800 text-xs px-2 py-1 rounded hover:bg-brand-50 transition-colors"
          title={`Comparer tous les batches ${data.SOUCHE}`}
        >
          ⇄
        </Link>
        <button
          onClick={() => onDelete(record.id)}
          className="text-gray-400 hover:text-red-500 transition-colors p-1"
          title="Supprimer"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function Chip({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <div className={`rounded px-2 py-1 text-center ${warn ? 'bg-red-50 border border-red-200' : 'bg-gray-50'}`}>
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-xs font-bold ${warn ? 'text-red-600' : 'text-gray-800'}`}>{value}</div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="card text-center py-16">
      <div className="text-5xl mb-4">🌱</div>
      <h3 className="text-lg font-semibold text-gray-700 mb-1">Aucun batch enregistré</h3>
      <p className="text-sm text-gray-500 mb-5">
        Créez votre premier batch pour générer un rapport d'analyse complet.
      </p>
      <Link href="/batch/new" className="btn-primary">+ Nouveau batch</Link>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function fmt(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return iso; }
}

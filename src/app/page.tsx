'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getBatches, deleteBatch } from '@/lib/storage';
import type { BatchRecord } from '@/types/batch';
import { PHASE_LABELS, PHASE_COLORS, detectAlerts } from '@/types/batch';

export default function DashboardPage() {
  const [batches, setBatches] = useState<BatchRecord[]>([]);

  useEffect(() => {
    setBatches(getBatches());
  }, []);

  function handleDelete(id: string) {
    if (!confirm(`Supprimer le batch ${id} ?`)) return;
    deleteBatch(id);
    setBatches(getBatches());
  }

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <StatCard label="Batches total" value={batches.length} icon="🌿" />
        <StatCard
          label="Phase 3 (Floraison)"
          value={batches.filter((b) => b.data.PHASE_NUMBER === 3).length}
          icon="🌸"
        />
        <StatCard
          label="Rapports générés"
          value={batches.filter((b) => b.report).length}
          icon="📊"
        />
        <StatCard
          label="Modules actifs"
          value={[...new Set(batches.map((b) => b.data.MODULE_TYPE))].length}
          icon="🏗️"
        />
      </div>

      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-900">Batches en cours</h1>
        <Link href="/batch/new" className="btn-primary">
          + Nouveau batch
        </Link>
      </div>

      {batches.length === 0 ? (
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

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: string;
}) {
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

  return (
    <div className="card hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="font-bold text-gray-900">{data.SOUCHE}</div>
          <div className="text-xs text-gray-500 font-mono mt-0.5">{data.BATCH_ID}</div>
        </div>
        <span
          className={`text-xs font-semibold px-2 py-0.5 rounded-full ${PHASE_COLORS[phase]}`}
        >
          Ph.{phase} · J{data.PHASE_DAY}
        </span>
      </div>

      <div className="text-xs text-gray-500 mb-3">
        {PHASE_LABELS[phase]} · {data.MODULE_TYPE} plants · Semis {formatDate(data.DATE_SEMIS)}
      </div>

      {/* Mini env metrics */}
      <div className="grid grid-cols-3 gap-1.5 mb-3">
        <Metric label="pH" value={data.DONNEES_ENVIRONNEMENTALES.pH} warn={data.DONNEES_ENVIRONNEMENTALES.pH < 5.5 || data.DONNEES_ENVIRONNEMENTALES.pH > 6.5} />
        <Metric label="EC" value={`${data.DONNEES_ENVIRONNEMENTALES.EC} mS`} />
        <Metric label="O₂" value={`${data.DONNEES_ENVIRONNEMENTALES.oxygene_dissous} mg/L`} warn={data.DONNEES_ENVIRONNEMENTALES.oxygene_dissous < 6} />
      </div>

      {alerts.length > 0 && (
        <div className="text-xs text-red-600 font-medium mb-2">
          {alerts.length} alerte{alerts.length > 1 ? 's' : ''} détectée{alerts.length > 1 ? 's' : ''}
        </div>
      )}

      <div className="flex items-center gap-2 mt-2">
        <Link href={`/batch/${record.id}`} className="btn-primary text-xs py-1 px-3 flex-1 justify-center">
          {record.report ? 'Voir rapport' : 'Analyser'}
        </Link>
        <button
          onClick={() => onDelete(record.id)}
          className="text-gray-400 hover:text-red-500 transition-colors p-1"
          title="Supprimer"
        >
          <TrashIcon />
        </button>
      </div>
    </div>
  );
}

function Metric({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
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
      <Link href="/batch/new" className="btn-primary">
        + Nouveau batch
      </Link>
    </div>
  );
}

function TrashIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

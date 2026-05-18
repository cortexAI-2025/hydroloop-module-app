'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getBatch, updateReport } from '@/lib/storage';
import type { BatchRecord } from '@/types/batch';
import { PHASE_LABELS, PHASE_COLORS, detectAlerts } from '@/types/batch';
import AlertBadge from '@/components/AlertBadge';
import dynamic from 'next/dynamic';

const MarkdownRenderer = dynamic(() => import('@/components/MarkdownRenderer'), { ssr: false });

type Status = 'idle' | 'generating' | 'done' | 'error';

export default function BatchReportPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [record, setRecord] = useState<BatchRecord | null>(null);
  const [report, setReport] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    const r = getBatch(id);
    if (!r) { router.replace('/'); return; }
    setRecord(r);
    if (r.report) {
      setReport(r.report);
      setStatus('done');
    }
  }, [id, router]);

  const generate = useCallback(async () => {
    if (!record) return;
    setStatus('generating');
    setReport('');
    setError('');

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record.data),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erreur inconnue' }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let full = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        full += chunk;
        setReport(full);
      }

      updateReport(id, full);
      setStatus('done');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setStatus('error');
    }
  }, [record, id]);

  // Auto-start if no cached report
  useEffect(() => {
    if (record && !record.report && status === 'idle') {
      generate();
    }
  }, [record, status, generate]);

  if (!record) return <LoadingPage />;

  const { data } = record;
  const alerts = detectAlerts(data.DONNEES_ENVIRONNEMENTALES);
  const env = data.DONNEES_ENVIRONNEMENTALES;

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 py-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-6">
        <Link href="/" className="hover:text-brand-700">Tableau de bord</Link>
        <span>/</span>
        <span className="font-medium text-gray-800">{data.BATCH_ID}</span>
      </div>

      {/* Header card */}
      <div className="card mb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-bold text-gray-900">{data.SOUCHE}</h1>
              <span className={`text-sm font-semibold px-2.5 py-0.5 rounded-full ${PHASE_COLORS[data.PHASE_NUMBER]}`}>
                {PHASE_LABELS[data.PHASE_NUMBER]} — J{data.PHASE_DAY}
              </span>
            </div>
            <div className="text-sm text-gray-500 font-mono">{data.BATCH_ID}</div>
          </div>
          <div className="flex gap-2">
            {status === 'done' && (
              <button className="btn-secondary text-xs" onClick={generate}>
                ↻ Régénérer
              </button>
            )}
            <button className="btn-secondary text-xs" onClick={() => window.print()}>
              Imprimer
            </button>
          </div>
        </div>

        {/* Env summary grid */}
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-2">
          <EnvChip label="pH" value={env.pH} warn={env.pH < 5.5 || env.pH > 6.5} />
          <EnvChip label="EC" value={`${env.EC} mS`} />
          <EnvChip label="O₂" value={`${env.oxygene_dissous} mg/L`} warn={env.oxygene_dissous < 6} />
          <EnvChip label="T° sol." value={`${env.temperature_solution}°C`} warn={env.temperature_solution > 22} />
          <EnvChip label="PPFD" value={`${env.PPFD} µ`} />
        </div>

        <div className="mt-3 text-sm text-gray-600 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-0.5">
          <Info label="Module" value={`${data.MODULE_TYPE} plants`} />
          <Info label="Semis" value={formatDate(data.DATE_SEMIS)} />
          <Info label="Photopériode" value={env.photopériode} />
          <Info label="T° air" value={`${env.temperature_air_jour}°/${env.temperature_air_nuit}°C`} />
        </div>

        {alerts.length > 0 && (
          <div className="mt-4">
            <AlertBadge alerts={alerts} />
          </div>
        )}
      </div>

      {/* Report area */}
      <div className="card">
        {status === 'generating' && (
          <div className="flex items-center gap-3 mb-4 text-brand-700">
            <Spinner />
            <span className="text-sm font-medium">Génération du rapport en cours…</span>
          </div>
        )}

        {status === 'error' && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-4 mb-4">
            <div className="font-semibold text-red-700 mb-1">Erreur lors de la génération</div>
            <div className="text-sm text-red-600">{error}</div>
            <button className="btn-primary mt-3 text-xs" onClick={generate}>
              Réessayer
            </button>
          </div>
        )}

        {report ? (
          <>
            {status === 'done' && (
              <div className="text-xs text-gray-400 mb-4 text-right">
                Rapport généré le {formatDate(record.updatedAt)} à {formatTime(record.updatedAt)}
              </div>
            )}
            <MarkdownRenderer content={report} />
          </>
        ) : status === 'idle' ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">🔬</div>
            <p className="text-gray-500 text-sm mb-4">Aucun rapport généré pour ce batch.</p>
            <button className="btn-primary" onClick={generate}>
              Lancer l'analyse
            </button>
          </div>
        ) : null}
      </div>

      {/* Batch data summary */}
      {(data.HISTORIQUE_TAILLES || data.DERNIERS_RELEVES_RACINAIRES || data.notes) && (
        <div className="card mt-4">
          <div className="section-title">Données culturales</div>
          <div className="space-y-2 text-sm text-gray-700">
            {data.HISTORIQUE_TAILLES && (
              <div><span className="font-semibold text-gray-500">Historique tailles : </span>{data.HISTORIQUE_TAILLES}</div>
            )}
            {data.DERNIERS_RELEVES_RACINAIRES && (
              <div><span className="font-semibold text-gray-500">Relevés racinaires : </span>{data.DERNIERS_RELEVES_RACINAIRES}</div>
            )}
            {data.notes && (
              <div><span className="font-semibold text-gray-500">Notes : </span>{data.notes}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function EnvChip({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <div className={`rounded-lg px-3 py-2 text-center ${warn ? 'bg-red-50 border border-red-200' : 'bg-gray-50 border border-gray-100'}`}>
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-sm font-bold ${warn ? 'text-red-600' : 'text-gray-800'}`}>{value}</div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-gray-400">{label} : </span>
      <span className="font-medium text-gray-700">{value}</span>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin w-4 h-4 text-brand-600" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function LoadingPage() {
  return (
    <div className="flex items-center justify-center h-64">
      <Spinner />
    </div>
  );
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return iso; }
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

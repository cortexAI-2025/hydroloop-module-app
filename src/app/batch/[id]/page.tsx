'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getBatch, updateReport, getStrainHistory } from '@/lib/storage';
import type { BatchRecord } from '@/types/batch';
import { PHASE_LABELS, PHASE_COLORS, detectAlerts } from '@/types/batch';
import { predictHarvest, fmtHarvestDate } from '@/lib/harvest';
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
  const [isFallback, setIsFallback] = useState(false);

  useEffect(() => {
    getBatch(id).then((r) => {
      if (!r) { router.replace('/'); return; }
      setRecord(r);
      if (r.report) { setReport(r.report); setStatus('done'); }
    });
  }, [id, router]);

  const generate = useCallback(async () => {
    if (!record) return;
    setStatus('generating');
    setReport('');
    setError('');
    setIsFallback(false);

    const history = await getStrainHistory(record.data.SOUCHE, record.id);

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...record.data, strainHistory: history }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      // Detect if we got a fallback (plain text vs streaming Claude)
      const ct = res.headers.get('content-type') || '';
      const isStream = ct.includes('text/plain');

      if (isStream) {
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let full = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          full += decoder.decode(value, { stream: true });
          setReport(full);
        }
        // Detect fallback by checking the report content
        if (full.includes('Rapport de secours')) setIsFallback(true);
        await updateReport(id, full);
        setStatus('done');
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }, [record, id]);

  // Auto-start on first load
  useEffect(() => {
    if (record && !record.report && status === 'idle') generate();
  }, [record, status, generate]);

  if (!record) return <Loader />;

  const { data } = record;
  const alerts = detectAlerts(data.DONNEES_ENVIRONNEMENTALES);
  const env = data.DONNEES_ENVIRONNEMENTALES;
  const harvest = predictHarvest(data.PHASE_NUMBER, data.PHASE_DAY);

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 py-8 print:py-2 print:max-w-none">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-5 print:hidden">
        <Link href="/" className="hover:text-brand-700">Tableau de bord</Link>
        <span>/</span>
        <span className="text-gray-800 font-medium">{data.BATCH_ID}</span>
      </div>

      {/* Header */}
      <div className="card mb-5">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-3">
          <div>
            <div className="flex items-center gap-3 flex-wrap mb-1">
              <h1 className="text-2xl font-bold text-gray-900">{data.SOUCHE}</h1>
              <span className={`text-sm font-semibold px-2.5 py-0.5 rounded-full ${PHASE_COLORS[data.PHASE_NUMBER]}`}>
                {PHASE_LABELS[data.PHASE_NUMBER]} — J{data.PHASE_DAY}
              </span>
            </div>
            <div className="text-sm text-gray-400 font-mono">{data.BATCH_ID}</div>
          </div>
          <div className="flex gap-2 flex-wrap print:hidden">
            <Link
              href={`/batch/compare/${encodeURIComponent(data.SOUCHE)}`}
              className="btn-secondary text-xs"
            >
              ⇄ Comparer souche
            </Link>
            {status === 'done' && (
              <button className="btn-secondary text-xs" onClick={generate}>
                ↻ Régénérer
              </button>
            )}
            <button
              className="btn-secondary text-xs"
              onClick={() => window.print()}
            >
              🖨 Imprimer / PDF
            </button>
          </div>
        </div>

        {/* Env metrics grid */}
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-3">
          <Chip label="pH" value={env.pH} warn={env.pH < 5.5 || env.pH > 6.5} />
          <Chip label="EC" value={`${env.EC} mS`} />
          <Chip label="O₂" value={`${env.oxygene_dissous} mg/L`} warn={env.oxygene_dissous < 6} />
          <Chip label="T° sol." value={`${env.temperature_solution}°C`} warn={env.temperature_solution > 22} />
          <Chip label="PPFD" value={`${env.PPFD} µ`} />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-sm text-gray-600">
          <Info label="Module" value={`${data.MODULE_TYPE} plants`} />
          <Info label="Semis" value={fmt(data.DATE_SEMIS)} />
          <Info label="Photopériode" value={env.photopériode} />
          <Info label="T° air" value={`${env.temperature_air_jour}°C / ${env.temperature_air_nuit}°C`} />
        </div>

        {alerts.length > 0 && (
          <div className="mt-3">
            <AlertBadge alerts={alerts} />
          </div>
        )}
      </div>

      {/* Harvest prediction widget (Phase 3 only) */}
      {data.PHASE_NUMBER === 3 && (
        <HarvestWidget harvest={harvest} phaseDay={data.PHASE_DAY} />
      )}

      {/* Report card */}
      <div className="card">
        {/* Print header */}
        <div className="hidden print:block mb-6 pb-4 border-b border-gray-300">
          <div className="text-lg font-bold">HydroLoop™ — Rapport d'analyse</div>
          <div className="text-sm text-gray-500">{data.BATCH_ID} · {data.SOUCHE} · Imprimé le {new Date().toLocaleDateString('fr-FR')}</div>
        </div>

        {isFallback && status === 'done' && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-2 mb-4 text-xs text-amber-700 flex items-center gap-2 print:hidden">
            <span>⚠️</span>
            <span>Rapport de secours (analyse locale). <button className="underline font-semibold" onClick={generate}>Régénérer avec l'IA →</button></span>
          </div>
        )}

        {status === 'generating' && (
          <div className="flex items-center gap-3 mb-4 text-brand-700">
            <Spinner />
            <span className="text-sm font-medium animate-pulse">Génération du rapport…</span>
          </div>
        )}

        {status === 'error' && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-4 mb-4">
            <div className="font-semibold text-red-700 mb-1">Erreur</div>
            <div className="text-sm text-red-600 mb-3">{error}</div>
            <button className="btn-primary text-xs" onClick={generate}>Réessayer</button>
          </div>
        )}

        {report ? (
          <>
            {status === 'done' && (
              <div className="text-xs text-gray-400 mb-4 text-right print:hidden">
                Généré le {fmt(record.updatedAt)} à {fmtTime(record.updatedAt)}
              </div>
            )}
            <MarkdownRenderer content={report} />
          </>
        ) : status === 'idle' ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">🔬</div>
            <p className="text-sm text-gray-500 mb-4">Aucun rapport pour ce batch.</p>
            <button className="btn-primary" onClick={generate}>Lancer l'analyse</button>
          </div>
        ) : null}
      </div>

      {/* Cultural observations */}
      {(data.HISTORIQUE_TAILLES || data.DERNIERS_RELEVES_RACINAIRES || data.notes) && (
        <div className="card mt-4 text-sm text-gray-700 space-y-1.5">
          <div className="section-title">Données culturales</div>
          {data.HISTORIQUE_TAILLES && <p><span className="font-semibold text-gray-500">Tailles : </span>{data.HISTORIQUE_TAILLES}</p>}
          {data.DERNIERS_RELEVES_RACINAIRES && <p><span className="font-semibold text-gray-500">Racines : </span>{data.DERNIERS_RELEVES_RACINAIRES}</p>}
          {data.notes && <p><span className="font-semibold text-gray-500">Notes : </span>{data.notes}</p>}
        </div>
      )}
    </div>
  );
}

function HarvestWidget({ harvest, phaseDay }: {
  harvest: ReturnType<typeof predictHarvest>;
  phaseDay: number;
}) {
  const confColor = { high: 'text-brand-700', medium: 'text-amber-600', low: 'text-gray-500' };
  const barColor = harvest.progressPct >= 90 ? 'bg-purple-500' : harvest.progressPct >= 70 ? 'bg-amber-500' : 'bg-brand-500';

  return (
    <div className="card mb-5 border-purple-200 bg-purple-50/40 print:hidden">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div className="section-title text-purple-700 mb-0">🌸 Prédiction de récolte</div>
        <span className={`text-xs font-semibold ${confColor[harvest.confidence]}`}>
          Confiance : {harvest.confidence === 'high' ? 'haute' : harvest.confidence === 'medium' ? 'moyenne' : 'faible'}
        </span>
      </div>

      {/* Progress bar */}
      <div className="mb-3">
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>Progression floraison</span>
          <span>J{phaseDay} / 63 jours cible ({harvest.progressPct}%)</span>
        </div>
        <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${barColor}`}
            style={{ width: `${harvest.progressPct}%` }}
          />
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-xs text-gray-500 mb-0.5">Fenêtre estimée</div>
          <div className="font-semibold text-purple-800">{harvest.windowLabel}</div>
          {harvest.estimatedDate && (
            <div className="text-xs text-gray-500 mt-0.5">
              Vers le {fmtHarvestDate(harvest.estimatedDate)}
            </div>
          )}
        </div>
        <div>
          <div className="text-xs text-gray-500 mb-0.5">Trichomes</div>
          <div className="text-sm text-gray-700">{harvest.trichomeAdvice}</div>
        </div>
      </div>
    </div>
  );
}

function Chip({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <div className={`rounded-lg px-3 py-2 text-center ${warn ? 'bg-red-50 border border-red-200' : 'bg-gray-50 border border-gray-100'}`}>
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-sm font-bold ${warn ? 'text-red-600' : 'text-gray-800'}`}>{value}</div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div><span className="text-gray-400">{label} : </span><span className="font-medium">{value}</span></div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function Loader() {
  return (
    <div className="flex items-center justify-center h-64 gap-3 text-gray-400">
      <Spinner />
      Chargement…
    </div>
  );
}

function fmt(iso: string) {
  try { return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return iso; }
}

function fmtTime(iso: string) {
  try { return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}

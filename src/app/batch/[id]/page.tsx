'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { getBatch, updateBatch, updateReport, getStrainHistory } from '@/lib/storage';
import { DATA_CHANGED_EVENT } from '@/lib/events';
import type { BatchEventType, EnvironmentalData, HarvestData, Reading, ReportSource, TrackedBatch } from '@/types/batch';
import { EVENT_LABELS, LEVEL_EC_RANGE, PHASE_COLORS, PHASE_LABELS, detectAlerts } from '@/types/batch';
import {
  addEvent, addReading, advanceLevel, alertRate, daysSinceSowing, hoursSinceLastReading,
  isReadingDue, latestReading, levelProgress, readingStats, recordHarvest,
} from '@/lib/tracking';
import type { NumericEnvKey } from '@/lib/tracking';
import { predictHarvest, fmtHarvestDate } from '@/lib/harvest';
import type { TrackingContext } from '@/lib/system-prompt';
import AlertBadge from '@/components/AlertBadge';
import QRModal from '@/components/QRModal';
import TrendChart from '@/components/TrendChart';
import { AdvanceModal, EditModal, HarvestModal, LogModal, ReadingModal } from '@/components/BatchActions';

const MarkdownRenderer = dynamic(() => import('@/components/MarkdownRenderer'), { ssr: false });

type Status = 'idle' | 'generating' | 'done' | 'error';
type Dialog = null | 'reading' | 'log' | 'advance' | 'harvest' | 'edit';

const MAIN_METRICS: { key: NumericEnvKey; label: string; unit: string; good?: [number, number] }[] = [
  { key: 'pH', label: 'pH solution', unit: '', good: [5.5, 6.5] },
  { key: 'EC', label: 'EC', unit: 'mS/cm' },
  { key: 'oxygene_dissous', label: 'O₂ dissous', unit: 'mg/L', good: [6, 14] },
  { key: 'temperature_solution', label: 'T° solution', unit: '°C', good: [16, 22] },
];
const MORE_METRICS: { key: NumericEnvKey; label: string; unit: string; good?: [number, number]; decimals?: number }[] = [
  { key: 'debit_NFT', label: 'Débit NFT', unit: 'L/min', good: [0.5, 5] },
  { key: 'temperature_air_jour', label: 'T° air jour', unit: '°C', good: [22, 26] },
  { key: 'humidite_relative', label: 'Humidité relative', unit: '%', good: [40, 65], decimals: 0 },
  { key: 'PPFD', label: 'PPFD', unit: 'µmol/m²/s', decimals: 0 },
];

export default function BatchPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [record, setRecord] = useState<TrackedBatch | null>(null);
  const [report, setReport] = useState('');
  const [source, setSource] = useState<ReportSource | undefined>();
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [actionError, setActionError] = useState('');
  const [showMore, setShowMore] = useState(false);
  const autoStarted = useRef(false);

  const load = useCallback(async () => {
    const r = await getBatch(id);
    if (!r) { router.replace('/'); return; }
    setRecord(r);
    if (r.report && status !== 'generating') {
      setReport(r.report);
      setSource(r.reportSource);
      setStatus('done');
    }
  }, [id, router, status]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const on = () => { void load(); };
    window.addEventListener(DATA_CHANGED_EVENT, on);
    return () => window.removeEventListener(DATA_CHANGED_EVENT, on);
  }, [load]);

  async function save(next: TrackedBatch) {
    setActionError('');
    try {
      setRecord(await updateBatch(next));
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  }

  const generate = useCallback(async () => {
    if (!record) return;
    setStatus('generating');
    setReport('');
    setError('');

    const strainHistory = await getStrainHistory(record.data.SOUCHE, record.id);
    const tracking: TrackingContext = {
      levelTargetDays: record.levelTargetDays[record.data.PHASE_NUMBER],
      daysSinceSowing: daysSinceSowing(record),
      readingsCount: record.readings.length,
      alertRatePct: alertRate(record.readings),
      trend: readingStats(record.readings),
      recentEvents: record.events.slice(-8).map((e) => `${e.at.slice(0, 10)} · ${EVENT_LABELS[e.type]} : ${e.summary}`),
      strainHistory,
    };

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...record.data, tracking }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const src: ReportSource = res.headers.get('x-report-source') === 'fallback' ? 'fallback' : 'ai';
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let full = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
        setReport(full);
      }
      setSource(src);
      const updated = await updateReport(id, full, src);
      if (updated) setRecord(updated);
      setStatus('done');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }, [record, id]);

  useEffect(() => {
    if (record && !record.report && status === 'idle' && !autoStarted.current) {
      autoStarted.current = true;
      void generate();
    }
  }, [record, status, generate]);

  if (!record) return <Loader />;

  const { data } = record;
  const phase = data.PHASE_NUMBER;
  const active = record.status === 'active';
  const env = data.DONNEES_ENVIRONNEMENTALES;
  const alerts = detectAlerts(env);
  const progress = levelProgress(record);
  const harvest = predictHarvest(phase, progress.day, record.levelTargetDays[3]);
  const due = isReadingDue(record);
  const sinceH = hoursSinceLastReading(record);
  const ecRange = LEVEL_EC_RANGE[phase];
  const ecOff = env.EC < ecRange[0] || env.EC > ecRange[1];
  const lastChange = record.events.filter((e) => e.type === 'reading' || e.type === 'level_change').at(-1)?.at;
  const reportStale = !!(record.reportAt && lastChange && lastChange > record.reportAt);

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 sm:py-8 print:py-2 print:max-w-none">
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-4 print:hidden">
        <Link href="/" className="hover:text-brand-700">Tableau de bord</Link>
        <span>/</span>
        <span className="text-gray-800 font-medium">{data.BATCH_ID}</span>
      </div>

      {/* En-tête */}
      <div className="card mb-4">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h1 className="text-2xl font-bold text-gray-900">{data.SOUCHE}</h1>
              <span className={`text-sm font-semibold px-2.5 py-0.5 rounded-full ${PHASE_COLORS[phase]}`}>
                Niveau {phase} · {PHASE_LABELS[phase]} — J{progress.day}
              </span>
              {!active && <span className="text-sm font-semibold px-2.5 py-0.5 rounded-full bg-gray-800 text-white">Récolté</span>}
            </div>
            <div className="text-sm text-gray-500">
              <span className="font-mono">{data.BATCH_ID}</span>
              {data.MODULE_ID && <> · Module <span className="font-mono font-semibold text-gray-700">{data.MODULE_ID}</span></>}
              {' '}· {data.MODULE_TYPE} plants · semis {fmt(data.DATE_SEMIS)} (J+{daysSinceSowing(record)})
              {data.OPERATEUR && <> · resp. {data.OPERATEUR}</>}
            </div>
          </div>
          <div className="flex gap-2 flex-wrap print:hidden">
            <QRModal batchId={data.BATCH_ID} />
            <Link href={`/batch/${record.id}/passport`} className="btn-secondary text-xs">🪪 Passeport</Link>
            <Link href={`/batch/compare/${encodeURIComponent(data.SOUCHE)}`} className="btn-secondary text-xs">⇄ Comparer</Link>
            <button className="btn-secondary text-xs" onClick={() => setDialog('edit')}>✎ Modifier</button>
            <button className="btn-secondary text-xs" onClick={() => window.print()}>🖨 PDF</button>
          </div>
        </div>

        {/* Actions de suivi */}
        {active && (
          <div className="flex flex-wrap gap-2 mb-4 print:hidden">
            <button className="btn-primary" onClick={() => setDialog('reading')}>+ Nouveau relevé</button>
            <button className="btn-secondary" onClick={() => setDialog('log')}>📝 Journal</button>
            {phase < 3 ? (
              <button className={progress.ready ? 'btn-primary bg-amber-600 hover:bg-amber-700' : 'btn-secondary'} onClick={() => setDialog('advance')}>
                ↑ Monter au niveau {phase + 1}
              </button>
            ) : (
              <button className={progress.ready ? 'btn-primary bg-purple-700 hover:bg-purple-800' : 'btn-secondary'} onClick={() => setDialog('harvest')}>
                ✂ Enregistrer la récolte
              </button>
            )}
          </div>
        )}
        {actionError && <div className="mb-3 text-sm text-red-600">{actionError}</div>}

        {/* Progression du niveau */}
        {active && (
          <div className="mb-4">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span className={progress.ready ? 'font-semibold text-amber-700' : ''}>{progress.nextAction}</span>
              <span>J{progress.day} / {progress.target} j cible</span>
            </div>
            <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden" role="progressbar" aria-valuenow={progress.pct} aria-valuemin={0} aria-valuemax={100}>
              <div className={`h-full rounded-full ${progress.ready ? 'bg-amber-500' : 'bg-brand-500'}`} style={{ width: `${progress.pct}%` }} />
            </div>
          </div>
        )}

        {due && (
          <div className="mb-3 rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-800 flex items-center justify-between gap-2 print:hidden">
            <span>⏰ Dernier relevé il y a {fmtAgo(sinceH)} — un relevé quotidien est recommandé.</span>
            <button className="font-semibold underline" onClick={() => setDialog('reading')}>Saisir</button>
          </div>
        )}

        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-3">
          <Chip label="pH" value={env.pH} warn={env.pH < 5.5 || env.pH > 6.5} />
          <Chip label={`EC (cible ${ecRange[0]}–${ecRange[1]})`} value={`${env.EC} mS`} warn={ecOff} />
          <Chip label="O₂" value={`${env.oxygene_dissous} mg/L`} warn={env.oxygene_dissous < 6} />
          <Chip label="T° sol." value={`${env.temperature_solution}°C`} warn={env.temperature_solution > 22} />
          <Chip label="Débit" value={`${env.debit_NFT} L/min`} warn={env.debit_NFT < 0.5} />
          <Chip label="Photopér." value={env.photopériode} />
        </div>
        <div className="text-xs text-gray-400">
          Dernier relevé : {fmtDateTime(latestReading(record).at)} · {record.readings.length} relevé{record.readings.length > 1 ? 's' : ''}
        </div>
        {alerts.length > 0 && <div className="mt-3"><AlertBadge alerts={alerts} /></div>}
      </div>

      {/* Récolte */}
      {record.harvest && (
        <div className="card mb-4 border-gray-300">
          <div className="section-title">✂ Récolte</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <Info label="Date" value={fmt(record.harvest.date)} />
            <Info label="Masse fraîche" value={`${record.harvest.freshWeightKg} kg`} />
            <Info label="Plants" value={String(record.harvest.plantsHarvested)} />
            <Info label="Rendement" value={`${Math.round((record.harvest.freshWeightKg * 1000) / Math.max(1, record.harvest.plantsHarvested))} g/plante`} />
            {record.harvest.freezeTempC !== undefined && <Info label="Congélation" value={`${record.harvest.freezeTempC}°C`} />}
            {record.harvest.freezeDelayMin !== undefined && <Info label="Délai froid" value={`${record.harvest.freezeDelayMin} min`} />}
            {record.harvest.lotNumber && <Info label="Lot" value={record.harvest.lotNumber} />}
            {record.harvest.destination && <Info label="Destination" value={record.harvest.destination} />}
            <Info label="Opérateur" value={record.harvest.operator} />
          </div>
        </div>
      )}

      {phase === 3 && active && <HarvestWidget harvest={harvest} phaseDay={progress.day} target={record.levelTargetDays[3]} />}

      {/* Tendances */}
      <div className="card mb-4">
        <div className="flex items-center justify-between mb-3">
          <div className="section-title mb-0">Évolution des paramètres</div>
          {record.readings.length < 2 && <span className="text-xs text-gray-400">Les courbes apparaissent dès le 2ᵉ relevé</span>}
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          {MAIN_METRICS.map((m) => (
            <TrendChart key={m.key} readings={record.readings} metric={m.key} label={m.label} unit={m.unit}
              good={m.key === 'EC' ? ecRange : m.good} rangeOf={m.key === 'EC' ? ecRangeOf : undefined} />
          ))}
          {showMore && MORE_METRICS.map((m) => (
            <TrendChart key={m.key} readings={record.readings} metric={m.key} label={m.label} unit={m.unit} good={m.good} decimals={m.decimals} />
          ))}
        </div>
        <button className="mt-3 text-xs font-semibold text-brand-700 hover:underline print:hidden" onClick={() => setShowMore((s) => !s)}>
          {showMore ? 'Masquer les autres paramètres' : 'Afficher débit, air, humidité, PPFD'}
        </button>
      </div>

      {/* Rapport */}
      <div className="card mb-4">
        <div className="hidden print:block mb-6 pb-4 border-b border-gray-300">
          <div className="text-lg font-bold">HydroLoop™ — Rapport d&apos;analyse</div>
          <div className="text-sm text-gray-500">{data.BATCH_ID} · {data.SOUCHE} · Imprimé le {new Date().toLocaleDateString('fr-FR')}</div>
        </div>
        <div className="flex items-center justify-between gap-2 mb-3 print:hidden">
          <div className="section-title mb-0">Rapport d&apos;analyse</div>
          {status === 'done' && (
            <button className="btn-secondary text-xs" onClick={generate}>↻ Régénérer avec les derniers relevés</button>
          )}
        </div>

        {reportStale && status === 'done' && (
          <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-2 mb-4 text-xs text-blue-800 print:hidden">
            ℹ️ Ce rapport précède les derniers relevés ou le dernier changement de niveau.{' '}
            <button className="underline font-semibold" onClick={generate}>Mettre à jour →</button>
          </div>
        )}
        {source === 'fallback' && status === 'done' && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-2 mb-4 text-xs text-amber-700 flex items-center gap-2 print:hidden">
            <span>⚠️</span>
            <span>Rapport de secours (analyse locale). <button className="underline font-semibold" onClick={generate}>Régénérer avec l&apos;IA →</button></span>
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
            {status === 'done' && record.reportAt && (
              <div className="text-xs text-gray-400 mb-4 text-right print:hidden">
                Généré le {fmt(record.reportAt)} à {fmtTime(record.reportAt)}
              </div>
            )}
            <MarkdownRenderer content={report} />
          </>
        ) : status === 'idle' ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">🔬</div>
            <p className="text-sm text-gray-500 mb-4">Aucun rapport pour ce batch.</p>
            <button className="btn-primary" onClick={generate}>Lancer l&apos;analyse</button>
          </div>
        ) : null}
      </div>

      {/* Journal */}
      <div className="card mb-4">
        <div className="section-title">Journal de culture</div>
        <ol className="relative border-l-2 border-gray-100 ml-2 space-y-3">
          {[...record.events].reverse().map((e) => (
            <li key={e.id} className="ml-4">
              <span className={`absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full border-2 border-white ${dotColor(e.type)}`} />
              <div className="text-xs text-gray-400">
                {fmtDateTime(e.at)} · <span className="font-semibold text-gray-600">{EVENT_LABELS[e.type]}</span>
                {e.operator && <> · {e.operator}</>}
              </div>
              <div className="text-sm text-gray-800">{e.summary}</div>
            </li>
          ))}
        </ol>
      </div>

      {/* Tableau des relevés */}
      <details className="card mb-4">
        <summary className="section-title mb-0 cursor-pointer">Tableau des relevés ({record.readings.length})</summary>
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-xs min-w-[640px]">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="py-1.5 pr-2">Date</th><th>Niv.</th><th>pH</th><th>EC</th><th>O₂</th><th>T° sol.</th>
                <th>Débit</th><th>T° air</th><th>HR</th><th>PPFD</th><th>Opérateur</th><th>Note</th>
              </tr>
            </thead>
            <tbody>
              {[...record.readings].reverse().map((r) => {
                const bad = new Set(detectAlerts(r.env).map((a) => a.field));
                const c = (k: string) => (bad.has(k) ? 'text-red-600 font-semibold' : '');
                return (
                  <tr key={r.id} className="border-b border-gray-50">
                    <td className="py-1.5 pr-2 whitespace-nowrap">{fmtDateTime(r.at)}</td>
                    <td>{r.phase}</td>
                    <td className={c('pH')}>{r.env.pH}</td>
                    <td className={c('EC')}>{r.env.EC}</td>
                    <td className={c('oxygene_dissous')}>{r.env.oxygene_dissous}</td>
                    <td className={c('temperature_solution')}>{r.env.temperature_solution}</td>
                    <td className={c('debit_NFT')}>{r.env.debit_NFT}</td>
                    <td>{r.env.temperature_air_jour}/{r.env.temperature_air_nuit}</td>
                    <td>{r.env.humidite_relative}</td>
                    <td>{r.env.PPFD}</td>
                    <td>{r.operator ?? '—'}</td>
                    <td className="max-w-[200px] truncate" title={r.note}>{r.note ?? ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>

      {(data.HISTORIQUE_TAILLES || data.DERNIERS_RELEVES_RACINAIRES || data.notes) && (
        <div className="card text-sm text-gray-700 space-y-1.5">
          <div className="section-title">Observations initiales</div>
          {data.HISTORIQUE_TAILLES && <p><span className="font-semibold text-gray-500">Tailles : </span>{data.HISTORIQUE_TAILLES}</p>}
          {data.DERNIERS_RELEVES_RACINAIRES && <p><span className="font-semibold text-gray-500">Racines : </span>{data.DERNIERS_RELEVES_RACINAIRES}</p>}
          {data.notes && <p><span className="font-semibold text-gray-500">Notes : </span>{data.notes}</p>}
        </div>
      )}

      {/* Dialogues (montés à l'ouverture pour repartir des valeurs courantes) */}
      {dialog === 'reading' && (
        <ReadingModal batch={record} open onClose={() => setDialog(null)}
          onSubmit={(env: EnvironmentalData, opts) => save(addReading(record, env, opts))} />
      )}
      {dialog === 'log' && (
        <LogModal open onClose={() => setDialog(null)}
          onSubmit={(type: BatchEventType, summary, operator) => save(addEvent(record, type, summary, operator))} />
      )}
      {dialog === 'advance' && (
        <AdvanceModal batch={record} day={progress.day} open onClose={() => setDialog(null)}
          onConfirm={(operator) => save(advanceLevel(record, operator))} />
      )}
      {dialog === 'harvest' && (
        <HarvestModal batch={record} open onClose={() => setDialog(null)}
          onSubmit={(h: HarvestData) => save(recordHarvest(record, h))} />
      )}
      {dialog === 'edit' && (
        <EditModal batch={record} open onClose={() => setDialog(null)} onSubmit={save} />
      )}
    </div>
  );
}

function HarvestWidget({ harvest, phaseDay, target }: { harvest: ReturnType<typeof predictHarvest>; phaseDay: number; target: number }) {
  const confColor = { high: 'text-brand-700', medium: 'text-amber-600', low: 'text-gray-500' };
  const barColor = harvest.progressPct >= 90 ? 'bg-purple-500' : harvest.progressPct >= 70 ? 'bg-amber-500' : 'bg-brand-500';

  return (
    <div className="card mb-4 border-purple-200 bg-purple-50/40 print:hidden">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div className="section-title text-purple-700 mb-0">🌸 Prédiction de récolte</div>
        <span className={`text-xs font-semibold ${confColor[harvest.confidence]}`}>
          Confiance : {harvest.confidence === 'high' ? 'haute' : harvest.confidence === 'medium' ? 'moyenne' : 'faible'}
        </span>
      </div>
      <div className="mb-3">
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>Progression niveau 3</span>
          <span>J{phaseDay} / {target} jours cible ({harvest.progressPct}%)</span>
        </div>
        <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${harvest.progressPct}%` }} />
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-xs text-gray-500 mb-0.5">Fenêtre estimée</div>
          <div className="font-semibold text-purple-800">{harvest.windowLabel}</div>
          {harvest.estimatedDate && <div className="text-xs text-gray-500 mt-0.5">Vers le {fmtHarvestDate(harvest.estimatedDate)}</div>}
        </div>
        <div>
          <div className="text-xs text-gray-500 mb-0.5">Trichomes</div>
          <div className="text-sm text-gray-700">{harvest.trichomeAdvice}</div>
        </div>
      </div>
    </div>
  );
}

const ecRangeOf = (r: Reading) => LEVEL_EC_RANGE[r.phase];

function dotColor(t: BatchEventType) {
  switch (t) {
    case 'level_change': return 'bg-amber-500';
    case 'harvest': return 'bg-purple-600';
    case 'reading': return 'bg-brand-500';
    case 'report': return 'bg-blue-500';
    case 'treatment': return 'bg-red-400';
    default: return 'bg-gray-400';
  }
}

function Chip({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <div className={`rounded-lg px-2 py-2 text-center ${warn ? 'bg-red-50 border border-red-200' : 'bg-gray-50 border border-gray-100'}`}>
      <div className="text-[11px] text-gray-500 truncate">{label}</div>
      <div className={`text-sm font-bold ${warn ? 'text-red-600' : 'text-gray-800'}`}>{value}{warn ? ' ⚠' : ''}</div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div><div className="text-xs text-gray-400">{label}</div><div className="font-semibold text-gray-800">{value}</div></div>
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

function fmtAgo(h: number) {
  return h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} jours`;
}

function fmt(iso: string) {
  try { return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return iso; }
}

function fmtTime(iso: string) {
  try { return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}

function fmtDateTime(iso: string) {
  return `${fmt(iso)} ${fmtTime(iso)}`;
}

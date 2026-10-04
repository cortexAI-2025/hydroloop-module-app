'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getBatches, deleteBatch } from '@/lib/storage';
import { DATA_CHANGED_EVENT } from '@/lib/events';
import type { PhaseNumber, TrackedBatch } from '@/types/batch';
import { PHASE_LABELS, PHASE_COLORS, detectAlerts } from '@/types/batch';
import { hoursSinceLastReading, isReadingDue, levelProgress } from '@/lib/tracking';

type Filter = 'active' | 'harvested' | 'all';

export default function DashboardPage() {
  const [batches, setBatches] = useState<TrackedBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('active');
  const [query, setQuery] = useState('');

  useEffect(() => {
    const load = () => getBatches().then((b) => { setBatches(b); setLoading(false); });
    void load();
    window.addEventListener(DATA_CHANGED_EVENT, load);
    return () => window.removeEventListener(DATA_CHANGED_EVENT, load);
  }, []);

  async function handleDelete(id: string) {
    if (!confirm(`Supprimer le batch ${id} ? Cette action est synchronisée sur tous les appareils.`)) return;
    await deleteBatch(id);
  }

  const active = batches.filter((b) => b.status === 'active');
  const strains = [...new Set(batches.map((b) => b.data.SOUCHE))];
  const harvestedKg = batches.reduce((s, b) => s + (b.harvest?.freshWeightKg ?? 0), 0);

  const todo = useMemo(() => {
    const items: { batch: TrackedBatch; label: string; tone: 'blue' | 'amber' | 'purple' | 'red' }[] = [];
    for (const b of active) {
      const p = levelProgress(b);
      if (detectAlerts(b.data.DONNEES_ENVIRONNEMENTALES).some((a) => a.severity === 'danger'))
        items.push({ batch: b, label: 'Alerte critique sur le dernier relevé', tone: 'red' });
      if (p.ready) items.push({ batch: b, label: p.nextAction, tone: b.data.PHASE_NUMBER === 3 ? 'purple' : 'amber' });
      if (isReadingDue(b)) items.push({ batch: b, label: `Relevé en retard (${Math.round(hoursSinceLastReading(b))} h)`, tone: 'blue' });
    }
    return items;
  }, [active]);

  const modules = useMemo(() => {
    const map = new Map<string, Partial<Record<PhaseNumber, TrackedBatch[]>>>();
    for (const b of active) {
      if (!b.data.MODULE_ID) continue;
      const m = map.get(b.data.MODULE_ID) ?? {};
      (m[b.data.PHASE_NUMBER] ??= []).push(b);
      map.set(b.data.MODULE_ID, m);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [active]);

  const q = query.trim().toLowerCase();
  const shown = batches
    .filter((b) => filter === 'all' || b.status === filter)
    .filter((b) => !q || [b.id, b.data.SOUCHE, b.data.MODULE_ID ?? ''].some((s) => s.toLowerCase().includes(q)));

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <StatCard label="Batches en culture" value={active.length} icon="🌿" />
        <StatCard label="Actions à faire" value={todo.length} icon="📋" />
        <StatCard label="Récolté (kg frais)" value={Math.round(harvestedKg * 10) / 10} icon="✂" />
        <StatCard label="Souches" value={strains.length} icon="🧬" />
      </div>

      {todo.length > 0 && (
        <section className="card mb-6">
          <div className="section-title">À faire aujourd&apos;hui</div>
          <ul className="divide-y divide-gray-100">
            {todo.map((t, i) => (
              <li key={i}>
                <Link href={`/batch/${t.batch.id}`} className="flex items-center gap-3 py-2 hover:bg-gray-50 -mx-2 px-2 rounded">
                  <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${{ blue: 'bg-blue-500', amber: 'bg-amber-500', purple: 'bg-purple-600', red: 'bg-red-600' }[t.tone]}`} />
                  <span className="text-sm text-gray-800 flex-1">{t.label}</span>
                  <span className="text-xs text-gray-500 font-mono">{t.batch.data.MODULE_ID ? `${t.batch.data.MODULE_ID} · ` : ''}{t.batch.id}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {modules.length > 0 && (
        <section className="mb-6">
          <div className="section-title">Rotation par module A-Frame</div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {modules.map(([mod, levels]) => (
              <div key={mod} className="card p-4">
                <div className="font-mono font-bold text-gray-900 mb-2">{mod}</div>
                <div className="space-y-1.5">
                  {([3, 2, 1] as PhaseNumber[]).map((lvl) => {
                    const list = levels[lvl] ?? [];
                    return (
                      <div key={lvl} className="flex items-center gap-2">
                        <span className={`text-[11px] font-semibold w-16 shrink-0 px-1.5 py-0.5 rounded ${PHASE_COLORS[lvl]}`}>N{lvl}</span>
                        {list.length === 0 ? (
                          <span className="text-xs text-gray-400 italic">libre</span>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {list.map((b) => {
                              const p = levelProgress(b);
                              return (
                                <Link key={b.id} href={`/batch/${b.id}`}
                                  className={`text-xs px-2 py-0.5 rounded-full border ${p.ready ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-gray-200 text-gray-700'} hover:border-brand-500`}>
                                  {b.data.SOUCHE} · J{p.day}/{p.target}
                                </Link>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h1 className="text-xl font-bold text-gray-900">Batches</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <input className="input w-44 py-1.5" type="search" placeholder="Rechercher…" value={query}
            onChange={(e) => setQuery(e.target.value)} aria-label="Rechercher un batch" />
          <div className="inline-flex rounded-md border border-gray-300 overflow-hidden text-sm" role="group">
            {(['active', 'harvested', 'all'] as Filter[]).map((f) => (
              <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f}
                className={`px-3 py-1.5 ${filter === f ? 'bg-brand-700 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                {{ active: 'En culture', harvested: 'Récoltés', all: 'Tous' }[f]}
              </button>
            ))}
          </div>
          <Link href="/batch/new" className="btn-primary">+ Nouveau batch</Link>
        </div>
      </div>

      {strains.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-5">
          <span className="text-xs text-gray-500 self-center">Comparer souche :</span>
          {strains.map((s) => (
            <Link key={s} href={`/batch/compare/${encodeURIComponent(s)}`}
              className="text-xs px-2.5 py-1 rounded-full border border-brand-300 text-brand-700 hover:bg-brand-50 transition-colors">
              {s} ({batches.filter((b) => b.data.SOUCHE === s).length})
            </Link>
          ))}
        </div>
      )}

      {loading ? (
        <div className="card flex items-center justify-center py-16 gap-3 text-gray-400"><Spinner /> Chargement des batches…</div>
      ) : batches.length === 0 ? (
        <EmptyState />
      ) : shown.length === 0 ? (
        <div className="card text-center py-10 text-sm text-gray-500">Aucun batch ne correspond à ce filtre.</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((b) => <BatchCard key={b.id} record={b} onDelete={handleDelete} />)}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: number; icon: string }) {
  return (
    <div className="card flex items-center gap-3 p-4">
      <span className="text-2xl" aria-hidden>{icon}</span>
      <div>
        <div className="text-2xl font-bold text-brand-700">{value}</div>
        <div className="text-xs text-gray-500">{label}</div>
      </div>
    </div>
  );
}

function BatchCard({ record, onDelete }: { record: TrackedBatch; onDelete: (id: string) => void }) {
  const { data } = record;
  const alerts = detectAlerts(data.DONNEES_ENVIRONNEMENTALES);
  const phase = data.PHASE_NUMBER;
  const env = data.DONNEES_ENVIRONNEMENTALES;
  const p = levelProgress(record);
  const harvested = record.status === 'harvested';

  return (
    <div className="card hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-2 gap-2">
        <div className="min-w-0">
          <div className="font-bold text-gray-900 truncate">{data.SOUCHE}</div>
          <div className="text-xs text-gray-400 font-mono mt-0.5">
            {data.BATCH_ID}{data.MODULE_ID && <> · {data.MODULE_ID}</>}
          </div>
        </div>
        {harvested ? (
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-800 text-white shrink-0">Récolté</span>
        ) : (
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${PHASE_COLORS[phase]}`}>
            N{phase} {PHASE_LABELS[phase]} J{p.day}
          </span>
        )}
      </div>

      {harvested && record.harvest ? (
        <div className="text-sm text-gray-700 mb-3">
          {record.harvest.freshWeightKg} kg frais · {record.harvest.plantsHarvested} plants · {fmt(record.harvest.date)}
        </div>
      ) : (
        <>
          <div className="text-xs text-gray-500 mb-2">{data.MODULE_TYPE} plants · semis {fmt(data.DATE_SEMIS)}</div>
          <div className="mb-3">
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className={`h-full ${p.ready ? 'bg-amber-500' : 'bg-brand-500'}`} style={{ width: `${p.pct}%` }} />
            </div>
            <div className={`text-[11px] mt-1 ${p.ready ? 'text-amber-700 font-semibold' : 'text-gray-500'}`}>{p.nextAction}</div>
          </div>
          <div className="grid grid-cols-3 gap-1.5 mb-3">
            <Chip label="pH" value={env.pH} warn={env.pH < 5.5 || env.pH > 6.5} />
            <Chip label="EC" value={`${env.EC}mS`} warn={env.EC < 0.8 || env.EC > 3} />
            <Chip label="O₂" value={`${env.oxygene_dissous}mg/L`} warn={env.oxygene_dissous < 6} />
          </div>
          {(alerts.length > 0 || isReadingDue(record)) && (
            <div className="text-xs font-medium mb-2 space-x-2">
              {alerts.length > 0 && <span className="text-red-600">{alerts.length} alerte{alerts.length > 1 ? 's' : ''}</span>}
              {isReadingDue(record) && <span className="text-blue-700">relevé en retard</span>}
            </div>
          )}
        </>
      )}

      <div className="flex items-center gap-2 mt-2">
        <Link href={`/batch/${record.id}`} className="btn-primary text-xs py-1 px-3 flex-1 justify-center">Ouvrir le suivi</Link>
        <Link href={`/batch/compare/${encodeURIComponent(data.SOUCHE)}`}
          className="text-brand-600 hover:text-brand-800 text-xs px-2 py-1 rounded hover:bg-brand-50 transition-colors"
          title={`Comparer tous les batches ${data.SOUCHE}`}>⇄</Link>
        <button onClick={() => onDelete(record.id)} className="text-gray-400 hover:text-red-500 transition-colors p-1" title="Supprimer" aria-label={`Supprimer ${record.id}`}>
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
      <p className="text-sm text-gray-500 mb-5">Créez votre premier batch pour commencer le suivi de culture.</p>
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

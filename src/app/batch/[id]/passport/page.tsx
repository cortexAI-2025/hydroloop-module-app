'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { getBatch } from '@/lib/storage';
import type { TrackedBatch } from '@/types/batch';
import { EVENT_LABELS, PHASE_LABELS } from '@/types/batch';
import { alertRate, currentPhaseDay, readingStats } from '@/lib/tracking';

const QRCodeSVG = dynamic(() => import('qrcode.react').then((m) => m.QRCodeSVG), { ssr: false });

const STATS_ROWS: { key: keyof ReturnType<typeof readingStats>; label: string; unit: string }[] = [
  { key: 'pH', label: 'pH', unit: '' },
  { key: 'EC', label: 'EC', unit: 'mS/cm' },
  { key: 'oxygene_dissous', label: 'O₂ dissous', unit: 'mg/L' },
  { key: 'temperature_solution', label: 'T° solution', unit: '°C' },
  { key: 'temperature_air_jour', label: 'T° air jour', unit: '°C' },
  { key: 'humidite_relative', label: 'Humidité relative', unit: '%' },
];

/** Passeport de lot Taqnin ID Batch — fiche de traçabilité imprimable. */
export default function PassportPage() {
  const { id } = useParams<{ id: string }>();
  const [b, setB] = useState<TrackedBatch | null | undefined>(undefined);
  const [url, setUrl] = useState('');

  useEffect(() => {
    getBatch(id).then((r) => setB(r ?? null));
    setUrl(`${window.location.origin}/batch/${id}/passport`);
  }, [id]);

  if (b === undefined) return <div className="p-8 text-center text-gray-400">Chargement…</div>;
  if (b === null)
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <p className="text-gray-600 mb-4">Lot introuvable sur cet appareil. Synchronisez les données puis réessayez.</p>
        <Link href="/" className="btn-primary">Tableau de bord</Link>
      </div>
    );

  const stats = readingStats(b.readings);
  const levelChanges = b.events.filter((e) => e.type === 'level_change');
  const operators = [...new Set([b.data.OPERATEUR, ...b.events.map((e) => e.operator), ...b.readings.map((r) => r.operator)].filter(Boolean))];

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 print:p-0">
      <div className="flex items-center justify-between gap-2 mb-4 print:hidden">
        <Link href={`/batch/${b.id}`} className="text-sm text-gray-500 hover:text-brand-700">← Retour au batch</Link>
        <button className="btn-primary text-sm" onClick={() => window.print()}>🖨 Imprimer / PDF</button>
      </div>

      <article className="bg-white border border-gray-300 rounded-xl p-6 print:border-0 print:rounded-none">
        <header className="flex items-start justify-between gap-4 pb-4 border-b-2 border-brand-800">
          <div>
            <div className="text-xs font-mono tracking-widest text-brand-700">TAQNIN ID BATCH · PASSEPORT DE LOT</div>
            <h1 className="text-2xl font-bold text-gray-900 mt-1 font-mono">{b.harvest?.lotNumber ?? b.id}</h1>
            <div className="text-sm text-gray-600 mt-1">HydroLoop™ Farm — module A-Frame NFT</div>
          </div>
          <div className="shrink-0 text-center">
            {url && <QRCodeSVG value={url} size={96} level="M" />}
            <div className="text-[10px] text-gray-400 mt-1">Scanner pour vérifier</div>
          </div>
        </header>

        <Section title="Identification">
          <Grid>
            <Field k="Batch" v={b.id} mono />
            <Field k="Statut" v={b.status === 'harvested' ? 'Récolté' : `En culture — niveau ${b.data.PHASE_NUMBER} (${PHASE_LABELS[b.data.PHASE_NUMBER]}), J${currentPhaseDay(b)}`} />
            <Field k="Génétique / souche" v={b.data.SOUCHE} />
            <Field k="Module" v={`${b.data.MODULE_ID ?? '—'} · ${b.data.MODULE_TYPE} plants`} />
            <Field k="Date de semis" v={fmt(b.data.DATE_SEMIS)} />
            <Field k="Création du lot" v={fmtDT(b.createdAt)} />
            <Field k="Responsable" v={b.data.OPERATEUR ?? '—'} />
            <Field k="Opérateurs intervenus" v={operators.length ? operators.join(', ') : '—'} />
          </Grid>
        </Section>

        <Section title="Parcours dans le module">
          {levelChanges.length === 0 ? (
            <p className="text-sm text-gray-600">Aucun changement de niveau enregistré.</p>
          ) : (
            <ul className="text-sm text-gray-700 space-y-1">
              {levelChanges.map((e) => <li key={e.id}><span className="font-mono text-xs text-gray-500">{fmtDT(e.at)}</span> — {e.summary}</li>)}
            </ul>
          )}
        </Section>

        <Section title={`Conditions de culture — ${b.readings.length} relevé${b.readings.length > 1 ? 's' : ''}, ${alertRate(b.readings)} % avec alerte`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b"><th className="py-1">Paramètre</th><th>Min</th><th>Moyenne</th><th>Max</th><th>Dernier</th></tr>
            </thead>
            <tbody>
              {STATS_ROWS.map((r) => {
                const s = stats[r.key];
                if (!s) return null;
                return (
                  <tr key={r.key} className="border-b border-gray-100">
                    <td className="py-1">{r.label}{r.unit && <span className="text-gray-400 text-xs"> ({r.unit})</span>}</td>
                    <td>{s.min}</td><td>{s.avg}</td><td>{s.max}</td><td>{s.last}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>

        <Section title="Récolte & chaîne du froid">
          {b.harvest ? (
            <Grid>
              <Field k="Date de récolte" v={fmt(b.harvest.date)} />
              <Field k="Plants récoltés" v={String(b.harvest.plantsHarvested)} />
              <Field k="Masse fraîche" v={`${b.harvest.freshWeightKg} kg`} />
              <Field k="Rendement" v={`${Math.round((b.harvest.freshWeightKg * 1000) / Math.max(1, b.harvest.plantsHarvested))} g/plante`} />
              <Field k="Congélation" v={b.harvest.freezeTempC !== undefined ? `${b.harvest.freezeTempC} °C` : '—'} />
              <Field k="Délai récolte → froid" v={b.harvest.freezeDelayMin !== undefined ? `${b.harvest.freezeDelayMin} min` : '—'} />
              <Field k="Destination" v={b.harvest.destination ?? '—'} />
              <Field k="Opérateur récolte" v={b.harvest.operator} />
            </Grid>
          ) : (
            <p className="text-sm text-gray-600">Lot en cours de culture — récolte non enregistrée.</p>
          )}
        </Section>

        <Section title="Journal horodaté">
          <ul className="text-xs text-gray-700 space-y-1">
            {b.events.map((e) => (
              <li key={e.id} className="grid grid-cols-[110px_120px_1fr] gap-2">
                <span className="font-mono text-gray-500">{fmtDT(e.at)}</span>
                <span className="font-semibold">{EVENT_LABELS[e.type]}</span>
                <span>{e.summary}{e.operator && <span className="text-gray-400"> — {e.operator}</span>}</span>
              </li>
            ))}
          </ul>
        </Section>

        <footer className="mt-6 pt-3 border-t border-gray-200 text-[11px] text-gray-500 flex flex-wrap justify-between gap-2">
          <span>Référentiels : GACP · pré-GMP · ANRAC (loi 13-21) · ONSSA</span>
          <span>Édité le {fmtDT(new Date().toISOString())}</span>
        </footer>
      </article>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 break-inside-avoid">
      <h2 className="text-xs font-bold uppercase tracking-wider text-brand-800 mb-2">{title}</h2>
      {children}
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5">{children}</dl>;
}

function Field({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3 border-b border-dashed border-gray-200 py-1 text-sm">
      <dt className="text-gray-500">{k}</dt>
      <dd className={`text-right text-gray-900 ${mono ? 'font-mono' : 'font-medium'}`}>{v}</dd>
    </div>
  );
}

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDT(iso: string) {
  return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

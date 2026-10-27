'use client';
import { useState } from 'react';
import type { BatchRecord, WaterReading, EnvironmentalData } from '@/types/batch';
import { detectAlerts, EC_RANGE_BY_PHASE } from '@/types/batch';
import { patchBatchData } from '@/lib/storage';

const FIELDS: { key: keyof Omit<WaterReading, 'id' | 'at' | 'action' | 'notes'>; label: string; step: string }[] = [
  { key: 'pH', label: 'pH', step: '0.1' },
  { key: 'EC', label: 'EC (mS/cm)', step: '0.1' },
  { key: 'temperature_solution', label: 'T° solution (°C)', step: '0.1' },
  { key: 'oxygene_dissous', label: 'O₂ (mg/L)', step: '0.1' },
  { key: 'debit_NFT', label: 'Débit (L/min)', step: '0.1' },
  { key: 'niveau_reservoir_pct', label: 'Réservoir (%)', step: '1' },
];

function alertsFor(r: WaterReading, base: EnvironmentalData, phase: 1 | 2 | 3) {
  // Seuls les champs relevés sont évalués : on part de valeurs neutres pour les autres.
  const ec = EC_RANGE_BY_PHASE[phase];
  const env: EnvironmentalData = {
    ...base,
    pH: r.pH ?? 6,
    EC: r.EC ?? (ec.min + ec.max) / 2,
    temperature_solution: r.temperature_solution ?? 20,
    oxygene_dissous: r.oxygene_dissous ?? 8,
    debit_NFT: r.debit_NFT ?? 1,
  };
  return detectAlerts(env, phase);
}

export default function WaterJournal({ record, onChange }: { record: BatchRecord; onChange: (r: BatchRecord) => void }) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const [action, setAction] = useState('');
  const [notes, setNotes] = useState('');
  const { data } = record;
  const readings = data.readings ?? [];

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const reading: WaterReading = { id: `w-${Date.now().toString(36)}`, at: new Date().toISOString() };
    for (const f of FIELDS) {
      const raw = vals[f.key];
      if (raw !== undefined && raw !== '') {
        const n = Number(raw.replace(',', '.'));
        if (Number.isFinite(n)) (reading as unknown as Record<string, number>)[f.key] = n;
      }
    }
    if (action.trim()) reading.action = action.trim();
    if (notes.trim()) reading.notes = notes.trim();
    if (Object.keys(reading).length <= 2) return; // rien de saisi
    const updated = await patchBatchData(record.id, { readings: [...readings, reading] });
    if (updated) onChange(updated);
    setVals({}); setAction(''); setNotes('');
  }

  async function remove(id: string) {
    if (!confirm('Supprimer ce relevé ?')) return;
    const updated = await patchBatchData(record.id, { readings: readings.filter((r) => r.id !== id) });
    if (updated) onChange(updated);
  }

  return (
    <div className="card mb-5 print:hidden">
      <div className="section-title">💧 Journal d&apos;eau</div>
      <form onSubmit={add} className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-3">
        {FIELDS.map((f) => (
          <div key={f.key}>
            <label className="label">{f.label}</label>
            <input className="input" inputMode="decimal" step={f.step} value={vals[f.key] ?? ''}
              onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} />
          </div>
        ))}
        <div className="col-span-2 md:col-span-3"><label className="label">Action menée</label>
          <input className="input" value={action} onChange={(e) => setAction(e.target.value)} placeholder="correction pH, appoint, vidange…" /></div>
        <div className="col-span-2 md:col-span-2"><label className="label">Notes</label>
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        <div className="col-span-2 md:col-span-1 flex items-end"><button className="btn-primary w-full justify-center" type="submit">Ajouter</button></div>
      </form>

      {readings.length === 0 ? (
        <p className="text-sm text-gray-500">Aucun relevé. Stade N{data.PHASE_NUMBER} : EC cible {EC_RANGE_BY_PHASE[data.PHASE_NUMBER].min}–{EC_RANGE_BY_PHASE[data.PHASE_NUMBER].max} mS/cm.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-gray-500 border-b">
              <th className="py-1 pr-2">Date</th>
              {FIELDS.map((f) => <th key={f.key} className="pr-2">{f.label}</th>)}
              <th className="pr-2">Action</th><th />
            </tr></thead>
            <tbody>
              {[...readings].reverse().map((r) => {
                const al = alertsFor(r, data.DONNEES_ENVIRONNEMENTALES, data.PHASE_NUMBER);
                const bad = new Set(al.map((a) => a.field));
                return (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="py-1 pr-2 whitespace-nowrap">{new Date(r.at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                    {FIELDS.map((f) => (
                      <td key={f.key} className={`pr-2 ${bad.has(f.key) ? 'text-red-600 font-semibold' : ''}`} title={al.find((a) => a.field === f.key)?.message}>
                        {r[f.key] ?? '—'}
                      </td>
                    ))}
                    <td className="pr-2">{[r.action, r.notes].filter(Boolean).join(' — ') || '—'}</td>
                    <td><button className="text-red-600 hover:underline" onClick={() => remove(r.id)}>×</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

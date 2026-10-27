'use client';
import { useState } from 'react';
import type { BatchRecord, HarvestRecord } from '@/types/batch';
import { patchBatchData } from '@/lib/storage';

export default function HarvestForm({ record, onChange, defaultPlants }: {
  record: BatchRecord; onChange: (r: BatchRecord) => void; defaultPlants: number;
}) {
  const h = record.data.harvest;
  const [date, setDate] = useState(h?.date ?? new Date().toISOString().slice(0, 10));
  const [plants, setPlants] = useState(String(h?.plants ?? defaultPlants));
  const [fresh, setFresh] = useState(h?.freshWeightG !== undefined ? String(h.freshWeightG) : '');
  const [dry, setDry] = useState(h?.dryWeightG !== undefined ? String(h.dryWeightG) : '');
  const [notes, setNotes] = useState(h?.notes ?? '');

  const n = (v: string) => (v.trim() === '' ? undefined : Number(v.replace(',', '.')));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const p = Number(plants);
    if (!Number.isFinite(p) || p <= 0) return;
    const rec: HarvestRecord = { date, plants: p, freshWeightG: n(fresh), dryWeightG: n(dry), notes: notes.trim() || undefined };
    const updated = await patchBatchData(record.id, { harvest: rec });
    if (updated) onChange(updated);
  }

  const perPlant = h?.dryWeightG && h.plants ? h.dryWeightG / h.plants : null;

  return (
    <div className="card mb-5 print:hidden">
      <div className="section-title">✂️ Récolte</div>
      <form onSubmit={save} className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <div><label className="label">Date</label><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div><label className="label">Plants</label><input className="input" inputMode="numeric" value={plants} onChange={(e) => setPlants(e.target.value)} /></div>
        <div><label className="label">Poids frais (g)</label><input className="input" inputMode="decimal" value={fresh} onChange={(e) => setFresh(e.target.value)} /></div>
        <div><label className="label">Poids sec (g)</label><input className="input" inputMode="decimal" value={dry} onChange={(e) => setDry(e.target.value)} /></div>
        <div className="flex items-end"><button className="btn-primary w-full justify-center" type="submit">{h ? 'Mettre à jour' : 'Enregistrer'}</button></div>
        <div className="col-span-2 md:col-span-5"><label className="label">Notes</label><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      </form>
      {perPlant !== null && <p className="mt-2 text-xs text-gray-600">Rendement sec : {perPlant.toFixed(1)} g/plant.</p>}
    </div>
  );
}

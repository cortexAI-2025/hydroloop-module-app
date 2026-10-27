'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { ModuleRecord, ModuleKindId } from '@/types/module';
import { MODULE_KINDS, TUNNEL_PLANTS_PER_LEVEL, DEFAULT_LEVELS, moduleSpec } from '@/types/module';

import type { Variety } from '@/types/variety';
import type { BatchRecord } from '@/types/batch';
import { computeCycle } from '@/lib/cycle';
import { getVarieties, getModules, addModule, updateModule, removeModule } from '@/lib/catalog';
import { getBatches } from '@/lib/storage';

export default function ModulesPage() {
  const [modules, setModules] = useState<ModuleRecord[]>([]);
  const [varieties, setVarieties] = useState<Variety[]>([]);
  const [batches, setBatches] = useState<BatchRecord[]>([]);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ModuleKindId>('dome-36');
  const [varietyId, setVarietyId] = useState('');
  const [perLevel, setPerLevel] = useState<number>(TUNNEL_PLANTS_PER_LEVEL[0]);
  const [levels, setLevels] = useState<number>(DEFAULT_LEVELS);

  const load = useCallback(async () => {
    const [m, v, b] = await Promise.all([getModules(), getVarieties(), getBatches()]);
    setModules(m); setVarieties(v); setBatches(b);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await addModule({
      name: name.trim(), kind, varietyId: varietyId || undefined,
      ...(kind === 'tunnel' ? { plantsPerLevel: perLevel, levels } : {}),
    });
    setName(''); setVarietyId('');
    await load();
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Modules</h1>
        <p className="text-sm text-gray-600">Un module = une seule variété. Chaque niveau est récolté à tour de rôle, au rythme d&apos;une phase de la variété.</p>
      </div>

      <section className="card">
        <h2 className="section-title">Nouveau module</h2>
        <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div><label className="label">Nom *</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Dôme 1" /></div>
          <div><label className="label">Type</label>
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value as ModuleKindId)}>
              {Object.values(MODULE_KINDS).map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
            </select></div>
          <div><label className="label">Variété</label>
            <select className="input" value={varietyId} onChange={(e) => setVarietyId(e.target.value)}>
              <option value="">— aucune —</option>
              {varieties.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select></div>
          {kind === 'tunnel' && (
            <>
              <div><label className="label">Plants par niveau</label>
                <select className="input" value={perLevel} onChange={(e) => setPerLevel(Number(e.target.value))}>
                  {TUNNEL_PLANTS_PER_LEVEL.map((n) => <option key={n} value={n}>{n}</option>)}
                </select></div>
              <div><label className="label">Niveaux</label>
                <input className="input" inputMode="numeric" value={levels}
                  onChange={(e) => setLevels(Math.max(1, Math.floor(Number(e.target.value)) || 1))} /></div>
            </>
          )}
          <div className="flex items-end"><button className="btn-primary w-full justify-center" type="submit">Créer</button></div>
        </form>
      </section>

      {modules.length === 0 ? (
        <p className="text-sm text-gray-500">Aucun module. Créez-en un ci-dessus.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {modules.map((m) => {
            const k = moduleSpec(m);
            const v = varieties.find((x) => x.id === m.varietyId);
            const plan = v ? computeCycle(v) : null;
            const mine = batches.filter((b) => b.data.MODULE_ID === m.id);
            const perYear = plan ? k.plantsPerLevel * plan.harvestsPerYear : null;
            return (
              <div key={m.id} className="card space-y-2">
                <div className="flex items-start justify-between">
                  <div><div className="font-semibold">{m.name}</div><div className="text-xs text-gray-500">{k.label}</div></div>
                  <button className="text-xs text-red-600 hover:underline" onClick={async () => {
                    if (confirm(`Supprimer le module « ${m.name} » ? Les lots restent conservés.`)) { await removeModule(m.id); await load(); }
                  }}>Supprimer</button>
                </div>
                <div>
                  <label className="label">Variété cultivée</label>
                  <select className="input" value={m.varietyId ?? ''} onChange={async (e) => { await updateModule({ ...m, varietyId: e.target.value || undefined }); await load(); }}>
                    <option value="">— aucune —</option>
                    {varieties.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </div>
                {plan && v && perYear !== null ? (
                  <p className="text-xs text-gray-700">
                    Cycle {v.totalDays} j (nurserie {v.nurseryDays} j + 3 × {plan.phaseDays.toFixed(1)} j) · une récolte de {k.plantsPerLevel} plants tous les {plan.phaseDays.toFixed(1)} j
                    · ≈ {plan.harvestsPerYear.toFixed(1)} récoltes et {Math.round(perYear)} plants/an
                  </p>
                ) : (
                  <p className="text-xs text-gray-500">Choisissez une variété pour calculer la rotation.</p>
                )}
                <p className="text-xs text-gray-600">{mine.length} lot(s) lié(s).{' '}
                  <Link href="/batch/new" className="text-brand-700 hover:underline">Nouveau lot</Link></p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

'use client';
import { useEffect, useRef, useState } from 'react';
import { exportBackup, getBatches, importBackup } from '@/lib/storage';
import { pullAll, pushAll, syncNow, pendingCount } from '@/lib/sync';
import { isCloudEnabled } from '@/lib/supabase';
import { readingsToCsv } from '@/lib/tracking';

interface ServerStatus { ai: boolean; model: string; auth: boolean; authMisconfigured?: boolean }

const SQL = `CREATE TABLE IF NOT EXISTS batches (
  id         TEXT PRIMARY KEY,
  data       JSONB       NOT NULL,
  report     TEXT,
  tracking   JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
-- Base existante (v1) :
ALTER TABLE batches ADD COLUMN IF NOT EXISTS tracking JSONB;`;

export default function DataPage() {
  const [server, setServer] = useState<ServerStatus | null>(null);
  const [cloud, setCloud] = useState(false);
  const [counts, setCounts] = useState({ batches: 0, readings: 0, pending: 0 });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    const b = await getBatches();
    setCounts({ batches: b.length, readings: b.reduce((s, x) => s + x.readings.length, 0), pending: pendingCount() });
  }

  useEffect(() => {
    setCloud(isCloudEnabled());
    void refresh();
    fetch('/api/status').then((r) => r.json()).then(setServer).catch(() => setServer(null));
  }, []);

  async function run(fn: () => Promise<string>) {
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ ok: true, text: await fn() });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  function download(name: string, content: string, type: string) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const stamp = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-6 sm:py-8 space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Données & configuration</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {counts.batches} batch{counts.batches > 1 ? 'es' : ''} · {counts.readings} relevé{counts.readings > 1 ? 's' : ''} sur cet appareil
        </p>
      </div>

      {msg && (
        <div className={`rounded-lg px-4 py-2 text-sm border ${msg.ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-700'}`} role="status">
          {msg.text}
        </div>
      )}

      <section className="card">
        <div className="section-title">État de l&apos;application</div>
        <ul className="text-sm divide-y divide-gray-100">
          <StatusRow ok={!!server?.ai} label="Analyse IA"
            detail={server ? (server.ai ? `Active — modèle ${server.model}` : 'ANTHROPIC_API_KEY absente : rapports de secours (analyse locale) uniquement') : 'Serveur injoignable (mode hors ligne)'} />
          <StatusRow ok={cloud} label="Synchronisation cloud"
            detail={cloud ? 'Supabase configuré — synchro automatique' : 'Désactivée : données sur cet appareil uniquement. Exportez régulièrement une sauvegarde.'} />
          <StatusRow ok={!!server?.auth} label="Protection par mot de passe"
            detail={server?.authMisconfigured
              ? '⚠ NEXTAUTH_SECRET manquant : la connexion échouera en production'
              : server?.auth ? 'Active' : 'Désactivée : toute personne ayant l’URL accède à l’application'} />
        </ul>
      </section>

      {cloud && (
        <section className="card">
          <div className="section-title">Synchronisation</div>
          <p className="text-sm text-gray-600 mb-3">
            {counts.pending > 0 ? `${counts.pending} modification(s) en attente d’envoi.` : 'Aucune modification en attente.'} En cas de conflit, la version la plus récente de chaque batch est conservée.
          </p>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={busy} onClick={() => run(async () => {
              const s = await syncNow();
              if (s.state === 'error') throw new Error(s.message);
              return s.state === 'ok' ? `Synchronisé : ${s.pushed} envoyé(s), ${s.pulled} reçu(s).` : 'Synchronisation terminée.';
            })}>⟳ Synchroniser maintenant</button>
            <button className="btn-secondary" disabled={busy} onClick={() => run(async () => {
              const r = await pullAll();
              if (r.error) throw new Error(r.error);
              return `${r.pulled} batch(es) mis à jour depuis le cloud.`;
            })}>↓ Récupérer du cloud</button>
            <button className="btn-secondary" disabled={busy} onClick={() => run(async () => {
              const r = await pushAll();
              if (r.error) throw new Error(r.error);
              return `${r.pushed} batch(es) envoyés vers le cloud.`;
            })}>↑ Tout envoyer</button>
          </div>
          <details className="mt-4">
            <summary className="text-xs font-semibold text-gray-600 cursor-pointer">Schéma SQL Supabase</summary>
            <pre className="mt-2 text-xs bg-gray-900 text-gray-100 rounded-lg p-3 overflow-x-auto">{SQL}</pre>
          </details>
        </section>
      )}

      <section className="card">
        <div className="section-title">Sauvegarde & export</div>
        <div className="grid sm:grid-cols-3 gap-3">
          <ActionCard title="Sauvegarde complète" desc="Tous les batches, relevés, journaux et rapports (JSON). Réimportable."
            action="⬇ Exporter (.json)" disabled={busy}
            onClick={() => run(async () => {
              const b = await exportBackup();
              download(`hydroloop-sauvegarde-${stamp}.json`, JSON.stringify(b, null, 2), 'application/json');
              return `${b.batches.length} batch(es) exportés.`;
            })} />
          <ActionCard title="Relevés (tableur)" desc="Un relevé par ligne, toutes cultures confondues (CSV, Excel)."
            action="⬇ Exporter (.csv)" disabled={busy}
            onClick={() => run(async () => {
              const b = await getBatches();
              download(`hydroloop-releves-${stamp}.csv`, '﻿' + readingsToCsv(b), 'text/csv;charset=utf-8');
              return `${b.reduce((s, x) => s + x.readings.length, 0)} relevé(s) exportés.`;
            })} />
          <ActionCard title="Restaurer / fusionner" desc="Importe une sauvegarde JSON. Les versions plus récentes l’emportent."
            action="⬆ Importer (.json)" disabled={busy} onClick={() => fileRef.current?.click()} />
        </div>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            void run(async () => {
              const r = await importBackup(JSON.parse(await f.text()));
              return `${r.imported} batch(es) importés, ${r.skipped} ignoré(s) (version locale plus récente ou invalide).`;
            });
          }} />
      </section>
    </div>
  );
}

function StatusRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span className={`mt-0.5 shrink-0 text-xs font-bold px-1.5 py-0.5 rounded ${ok ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
        {ok ? '✓ OUI' : '— NON'}
      </span>
      <div><div className="font-semibold text-gray-800">{label}</div><div className="text-xs text-gray-500">{detail}</div></div>
    </li>
  );
}

function ActionCard({ title, desc, action, onClick, disabled }: { title: string; desc: string; action: string; onClick: () => void; disabled?: boolean }) {
  return (
    <div className="rounded-lg border border-gray-200 p-4 flex flex-col">
      <div className="font-semibold text-gray-800 text-sm">{title}</div>
      <p className="text-xs text-gray-500 mt-1 mb-3 flex-1">{desc}</p>
      <button className="btn-secondary text-xs justify-center" onClick={onClick} disabled={disabled}>{action}</button>
    </div>
  );
}

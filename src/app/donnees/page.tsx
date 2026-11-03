'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  adoptLegacyData, exportBackup, getBatches, importBackup, listSnapshots, listTrash, pendingCount, restoreBatch, restoreSnapshot,
} from '@/lib/storage';
import type { MergeSummary } from '@/lib/storage';
import { metaGet, requestPersistence, storageEstimate } from '@/lib/db';
import { SYNC_EVENT, cloudConfigured, getSyncState, syncNow } from '@/lib/sync/runtime';
import type { SyncState } from '@/lib/sync/runtime';
import { DATA_CHANGED_EVENT } from '@/lib/events';
import { readingsToCsv } from '@/lib/tracking';
import type { BatchRecord } from '@/types/batch';

interface ServerStatus { ai: boolean; model: string; auth: boolean; authMisconfigured?: boolean; cloud?: boolean }
interface Conflicts { at: string; items: { id: string; notes: string[] }[] }
type Snap = Awaited<ReturnType<typeof listSnapshots>>[number];

const fmtMB = (n?: number) => (n === undefined ? '—' : `${(n / 1024 / 1024).toFixed(1)} Mo`);
const fmtDT = (iso?: string) => (iso ? new Date(iso).toLocaleString('fr-FR') : '—');

function summarize(r: MergeSummary): string {
  const parts = [`${r.added} ajouté(s)`, `${r.merged} fusionné(s)`, `${r.unchanged} identique(s)`];
  if (r.invalid.length) parts.push(`${r.invalid.length} invalide(s) ignoré(s) (${r.invalid.slice(0, 3).map((x) => `${x.id}: ${x.reason}`).join(' ; ')})`);
  if (r.conflicts.length) parts.push(`${r.conflicts.length} conflit(s) résolu(s) sans perte — voir le journal du batch`);
  return parts.join(', ') + '.';
}

export default function DataPage() {
  const [server, setServer] = useState<ServerStatus | null>(null);
  const cloud = cloudConfigured();
  const [sync, setSync] = useState<SyncState>({ state: 'idle' });
  const [counts, setCounts] = useState({ batches: 0, readings: 0, pending: 0 });
  const [lastSyncAt, setLastSyncAt] = useState<string>();
  const [conflicts, setConflicts] = useState<Conflicts>();
  const [trash, setTrash] = useState<BatchRecord[]>([]);
  const [snaps, setSnaps] = useState<Snap[]>([]);
  const [store, setStore] = useState<{ usage?: number; quota?: number; persisted?: boolean }>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const b = await getBatches();
      setCounts({ batches: b.length, readings: b.reduce((s, x) => s + x.readings.length, 0), pending: await pendingCount() });
      setTrash(await listTrash());
      setSnaps(await listSnapshots());
      setLastSyncAt(await metaGet<string>('lastSyncAt'));
      setConflicts(await metaGet<Conflicts>('lastConflicts'));
      setStore(await storageEstimate());
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    void refresh();
    setSync(getSyncState());
    fetch('/api/status').then((r) => r.json()).then(setServer).catch(() => setServer(null));
    const onSync = (e: Event) => { setSync((e as CustomEvent<SyncState>).detail); void refresh(); };
    const onData = () => void refresh();
    window.addEventListener(SYNC_EVENT, onSync);
    window.addEventListener(DATA_CHANGED_EVENT, onData);
    return () => { window.removeEventListener(SYNC_EVENT, onSync); window.removeEventListener(DATA_CHANGED_EVENT, onData); };
  }, [refresh]);

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
  const syncDetail =
    sync.state === 'ok' ? `Dernière synchronisation : ${fmtDT(sync.at)} — ${sync.report.pushed} envoyé(s), ${sync.report.pulled} reçu(s), ${sync.report.merged} fusionné(s).`
    : sync.state === 'error' ? `Erreur : ${sync.message}`
    : sync.state === 'offline' ? 'Hors ligne — les modifications sont conservées localement et seront envoyées au retour du réseau.'
    : sync.state === 'disabled' ? sync.reason
    : sync.state === 'syncing' ? 'Synchronisation en cours…'
    : lastSyncAt ? `Dernière synchronisation : ${fmtDT(lastSyncAt)}` : 'Pas encore synchronisé.';

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
            detail={server ? (server.ai ? `Active — modèle ${server.model}` : 'Clé IA absente : rapports locaux (calculs et règles) uniquement') : 'Serveur injoignable (mode hors ligne) : rapports locaux'} />
          <StatusRow ok={cloud && sync.state !== 'disabled'} label="Synchronisation cloud"
            detail={cloud ? 'Supabase configuré' : 'Désactivée : données sur cet appareil uniquement. Exportez régulièrement une sauvegarde.'} />
          <StatusRow ok={!!server?.auth} label="Protection par compte"
            detail={server?.authMisconfigured
              ? '⚠ NEXTAUTH_SECRET manquant : la connexion échouera en production'
              : server?.auth ? 'Active — données isolées par utilisateur' : 'Désactivée : toute personne ayant l’URL accède à l’application'} />
          <StatusRow ok={!!store.persisted} label="Stockage protégé"
            detail={store.persisted ? `Le navigateur ne purgera pas les données (${fmtMB(store.usage)} utilisés sur ${fmtMB(store.quota)})`
              : `Le navigateur peut purger les données en cas de manque d’espace (${fmtMB(store.usage)} utilisés). Exportez des sauvegardes.`} />
        </ul>
        {!store.persisted && (
          <button className="btn-secondary text-xs mt-3" onClick={() => run(async () => ((await requestPersistence()) ? 'Stockage protégé.' : 'Le navigateur a refusé (installez l’application ou ajoutez-la aux favoris pour augmenter les chances).'))}>
            Protéger le stockage
          </button>
        )}
      </section>

      {cloud && (
        <section className="card">
          <div className="section-title">Synchronisation</div>
          <p className="text-sm text-gray-600 mb-1">{syncDetail}</p>
          <p className="text-sm text-gray-600 mb-3">
            {counts.pending > 0 ? `${counts.pending} batch(es) en attente d’envoi.` : 'Aucune modification en attente.'} Les relevés et événements des deux côtés sont réunis ; aucune version récente n’est écrasée silencieusement.
          </p>
          <button className="btn-primary" disabled={busy || sync.state === 'syncing'} onClick={() => run(async () => {
            const s = await syncNow();
            if (s.state === 'error') throw new Error(s.message);
            if (s.state === 'offline') throw new Error('Hors ligne : réessayez quand le réseau est revenu.');
            if (s.state === 'disabled') throw new Error(s.reason);
            return s.state === 'ok' ? `Synchronisé : ${s.report.pushed} envoyé(s), ${s.report.pulled} reçu(s), ${s.report.merged} fusionné(s).` : 'Synchronisation terminée.';
          })}>⟳ Synchroniser maintenant</button>
          {conflicts && conflicts.items.length > 0 && (
            <details className="mt-4" open>
              <summary className="text-xs font-semibold text-amber-800 cursor-pointer">
                {conflicts.items.length} conflit(s) fusionné(s) automatiquement le {fmtDT(conflicts.at)}
              </summary>
              <ul className="mt-2 text-xs text-gray-700 space-y-1">
                {conflicts.items.map((c) => (
                  <li key={c.id}><a className="font-mono underline" href={`/batch/${encodeURIComponent(c.id)}`}>{c.id}</a> — {c.notes.join(' ; ') || 'fusion sans perte'}</li>
                ))}
              </ul>
            </details>
          )}
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
          <ActionCard title="Restaurer / fusionner" desc="Importe une sauvegarde JSON. Elle est fusionnée : rien n’est écrasé, une copie de sécurité est prise avant."
            action="⬆ Importer (.json)" disabled={busy} onClick={() => fileRef.current?.click()} />
        </div>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" aria-label="Fichier de sauvegarde à importer"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            void run(async () => {
              let json: unknown;
              try { json = JSON.parse(await f.text()); } catch { throw new Error('Fichier illisible : ce n’est pas un JSON valide.'); }
              return 'Import terminé : ' + summarize(await importBackup(json));
            });
          }} />
      </section>

      <section className="card">
        <div className="section-title">Copies de sécurité automatiques</div>
        <p className="text-xs text-gray-500 mb-2">Une copie est prise chaque jour et avant tout import ou fusion (7 dernières conservées sur l’appareil). La restauration fusionne, sans rien supprimer.</p>
        {snaps.length === 0 ? <p className="text-sm text-gray-500">Aucune copie pour l’instant.</p> : (
          <ul className="text-sm divide-y divide-gray-100">
            {snaps.map((s) => (
              <li key={s.id} className="py-2 flex items-center justify-between gap-3">
                <span>{fmtDT(s.createdAt)} — {s.count} batch(es) <span className="text-xs text-gray-400">({s.reason})</span></span>
                <button className="btn-secondary text-xs" disabled={busy} onClick={() => run(async () => 'Copie fusionnée : ' + summarize(await restoreSnapshot(s.id!)))}>Restaurer</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {trash.length > 0 && (
        <section className="card">
          <div className="section-title">Corbeille ({trash.length})</div>
          <ul className="text-sm divide-y divide-gray-100">
            {trash.map((b) => (
              <li key={b.id} className="py-2 flex items-center justify-between gap-3">
                <span><span className="font-mono">{b.id}</span> — {b.data.SOUCHE} · supprimé le {fmtDT(b.deletedAt)}</span>
                <button className="btn-secondary text-xs" disabled={busy} onClick={() => run(async () => { await restoreBatch(b.id); return `${b.id} restauré.`; })}>Restaurer</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-gray-400">
        <button className="underline" onClick={() => run(async () => 'Rattachement : ' + summarize(await adoptLegacyData()))}>Rattacher les données locales anciennes à ce compte</button>
        {' '}(à n’utiliser que si le bandeau de rattachement n’a pas été proposé).
      </p>
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

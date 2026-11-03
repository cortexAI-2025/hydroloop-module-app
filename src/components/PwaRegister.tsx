'use client';
import { useCallback, useEffect, useState } from 'react';
import { getBatches } from '@/lib/storage';
import { DATA_CHANGED_EVENT } from '@/lib/events';

interface InstallEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

const CORE_PAGES = ['/', '/analytics', '/batch/new', '/donnees', '/reglages'];

/**
 * Enregistre le service worker, prépare le mode hors ligne (pages principales + batches consultables),
 * et affiche : bandeau « hors ligne », proposition d'installation, proposition de mise à jour.
 */
export default function PwaRegister() {
  const [online, setOnline] = useState(true);
  const [installEvt, setInstallEvt] = useState<InstallEvent | null>(null);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  const warm = useCallback(async () => {
    const reg = await navigator.serviceWorker?.getRegistration();
    const sw = reg?.active;
    if (!sw || !navigator.onLine) return;
    try {
      const ids = (await getBatches()).filter((b) => b.status === 'active').slice(0, 40).map((b) => `/batch/${encodeURIComponent(b.id)}`);
      sw.postMessage({ type: 'WARM', urls: [...CORE_PAGES, ...ids] });
    } catch { /* stockage indisponible */ }
  }, []);

  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => { setOnline(true); void warm(); };
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    const onPrompt = (e: Event) => { e.preventDefault(); setInstallEvt(e as InstallEvent); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener(DATA_CHANGED_EVENT, warm);

    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').then((reg) => {
        if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          nw?.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) setWaiting(nw);
          });
        });
        void navigator.serviceWorker.ready.then(warm);
      }).catch(() => { /* enregistrement facultatif */ });
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
    }
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener(DATA_CHANGED_EVENT, warm);
    };
  }, [warm]);

  return (
    <>
      {!online && (
        <div role="status" className="fixed bottom-0 inset-x-0 z-50 bg-amber-100 border-t border-amber-300 text-amber-900 text-sm px-4 py-2 text-center print:hidden">
          Mode hors ligne — vos saisies sont enregistrées sur l’appareil et seront synchronisées au retour du réseau. L’analyse IA est remplacée par le rapport local.
        </div>
      )}
      {installEvt && online && (
        <div className="fixed bottom-3 right-3 z-50 bg-white border border-brand-200 shadow-lg rounded-lg p-3 text-sm max-w-xs print:hidden">
          <div className="font-semibold text-gray-800">Installer HydroLoop</div>
          <p className="text-xs text-gray-500 my-1">Accès rapide depuis l’écran d’accueil, utilisable hors ligne.</p>
          <div className="flex gap-2">
            <button className="btn-primary text-xs" onClick={async () => { await installEvt.prompt(); setInstallEvt(null); }}>Installer</button>
            <button className="btn-secondary text-xs" onClick={() => setInstallEvt(null)}>Plus tard</button>
          </div>
        </div>
      )}
      {waiting && (
        <div role="status" className="fixed top-16 right-3 z-50 bg-white border border-blue-200 shadow-lg rounded-lg p-3 text-sm max-w-xs print:hidden">
          <div className="font-semibold text-gray-800">Nouvelle version disponible</div>
          <div className="flex gap-2 mt-2">
            <button className="btn-primary text-xs" onClick={() => waiting.postMessage({ type: 'SKIP_WAITING' })}>Mettre à jour</button>
            <button className="btn-secondary text-xs" onClick={() => setWaiting(null)}>Plus tard</button>
          </div>
        </div>
      )}
    </>
  );
}

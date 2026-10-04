'use client';
import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';

const QRCodeSVG = dynamic(
  () => import('qrcode.react').then((m) => m.QRCodeSVG),
  { ssr: false, loading: () => <div className="w-48 h-48 bg-gray-100 animate-pulse rounded" /> },
);

interface Props {
  batchId: string;
}

export default function QRModal({ batchId }: Props) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const qrRef = useRef<HTMLDivElement>(null);

  function printLabel() {
    const svg = qrRef.current?.innerHTML;
    const w = window.open('', '_blank', 'width=420,height=520');
    if (!svg || !w) return;
    const doc = w.document;
    doc.title = `Étiquette ${batchId}`;
    doc.body.style.cssText = 'font-family:system-ui,sans-serif;text-align:center;padding:24px';
    const box = doc.createElement('div');
    box.innerHTML = svg;
    const id = doc.createElement('div');
    id.textContent = batchId;
    id.style.cssText = 'font:600 18px ui-monospace,monospace;margin-top:12px';
    const brand = doc.createElement('div');
    brand.textContent = 'HydroLoop™ Farm — scanner pour le suivi';
    brand.style.cssText = 'font-size:12px;color:#555;margin-top:4px';
    doc.body.append(box, id, brand);
    w.focus();
    w.print();
  }

  useEffect(() => {
    if (open) setUrl(`${window.location.origin}/batch/${batchId}`);
  }, [open, batchId]);

  function copy() {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <>
      <button className="btn-secondary text-xs" onClick={() => setOpen(true)}>
        📱 QR Code
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-72 text-center">
            <div className="text-sm font-bold text-gray-700 mb-1">Batch {batchId}</div>
            <div className="text-xs text-gray-400 mb-4">À coller sur le module : le scan ouvre la fiche de suivi</div>

            <div ref={qrRef} className="flex justify-center mb-4 p-3 bg-white rounded-xl border border-gray-100 shadow-inner">
              {url ? <QRCodeSVG value={url} size={180} level="M" /> : <div className="w-[180px] h-[180px]" />}
            </div>

            <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2 mb-4">
              <code className="text-xs text-gray-600 flex-1 text-left truncate">{url}</code>
              <button
                onClick={copy}
                className="text-brand-600 hover:text-brand-800 text-xs font-semibold shrink-0 transition-colors"
              >
                {copied ? '✓' : 'Copier'}
              </button>
            </div>

            <button className="btn-secondary w-full justify-center text-sm mb-2" onClick={printLabel}>
              🖨 Imprimer l&apos;étiquette
            </button>
            <button
              className="btn-secondary w-full justify-center text-sm"
              onClick={() => setOpen(false)}
            >
              Fermer
            </button>
          </div>
        </div>
      )}
    </>
  );
}

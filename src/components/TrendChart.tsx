'use client';
import { useMemo, useState } from 'react';
import type { Reading } from '@/types/batch';
import type { NumericEnvKey } from '@/lib/tracking';

interface Props {
  readings: Reading[];
  metric: NumericEnvKey;
  label: string;
  unit?: string;
  /** Plage acceptable actuelle, affichée en bande de fond. */
  good?: [number, number];
  /** Plage propre à chaque relevé (ex. EC selon le niveau du relevé) ; par défaut `good`. */
  rangeOf?: (r: Reading) => [number, number];
  decimals?: number;
}

const W = 320;
const H = 132;
const PAD = { top: 10, right: 10, bottom: 22, left: 34 };

/** Courbe d'un paramètre au fil des relevés, avec bande de plage cible et info-bulle au survol. */
export default function TrendChart({ readings, metric, label, unit = '', good, rangeOf, decimals = 1 }: Props) {
  const [hover, setHover] = useState<number | null>(null);

  const pts = useMemo(
    () =>
      [...readings]
        .sort((a, b) => a.at.localeCompare(b.at))
        .map((r) => ({ t: new Date(r.at).getTime(), v: Number(r.env[metric]), at: r.at, range: rangeOf ? rangeOf(r) : good }))
        .filter((p) => Number.isFinite(p.v)),
    [readings, metric, rangeOf, good],
  );

  const last = pts[pts.length - 1];
  const isBad = (p: { v: number; range?: [number, number] }) => !!p.range && (p.v < p.range[0] || p.v > p.range[1]);

  if (pts.length === 0) return null;

  const vals = pts.map((p) => p.v);
  let lo = Math.min(...vals, ...(good ?? []));
  let hi = Math.max(...vals, ...(good ?? []));
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const span = hi - lo;
  lo -= span * 0.1;
  hi += span * 0.1;

  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t;
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const x = (t: number) => PAD.left + (t1 === t0 ? iw / 2 : ((t - t0) / (t1 - t0)) * iw);
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * ih;
  const ticks = [lo + (hi - lo) * 0.15, (lo + hi) / 2, hi - (hi - lo) * 0.15];
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    for (let i = 1; i < pts.length; i++) if (Math.abs(x(pts[i].t) - px) < Math.abs(x(pts[best].t) - px)) best = i;
    setHover(best);
  }

  const h = hover !== null ? pts[hover] : null;
  const fmtV = (v: number) => `${v.toFixed(decimals)}${unit ? ` ${unit}` : ''}`;

  return (
    <figure className="rounded-lg border border-gray-200 bg-white p-3">
      <figcaption className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-xs font-semibold text-gray-600">{label}</span>
        <span className="text-sm font-bold text-gray-900">
          {fmtV(last.v)}
          {isBad(last) && <span className="ml-1 text-xs font-semibold text-red-600">⚠ hors plage</span>}
        </span>
      </figcaption>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-auto touch-none select-none"
          role="img"
          aria-label={`${label} : ${pts.length} relevé${pts.length > 1 ? 's' : ''}, dernier ${fmtV(last.v)}`}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {good && (
            <rect
              x={PAD.left}
              width={iw}
              y={y(Math.min(good[1], hi))}
              height={Math.max(0, y(Math.max(good[0], lo)) - y(Math.min(good[1], hi)))}
              fill="#dcfce7"
              opacity={0.7}
            />
          )}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="#e5e7eb" strokeWidth={1} />
              <text x={PAD.left - 6} y={y(t) + 3.5} fontSize={10} textAnchor="end" fill="#6b7280">
                {t.toFixed(decimals)}
              </text>
            </g>
          ))}
          <text x={PAD.left} y={H - 6} fontSize={10} fill="#6b7280">{fmtDate(pts[0].at)}</text>
          {pts.length > 1 && (
            <text x={W - PAD.right} y={H - 6} fontSize={10} fill="#6b7280" textAnchor="end">{fmtDate(last.at)}</text>
          )}
          {pts.length > 1 && <path d={path} fill="none" stroke="#15803d" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
          {h && <line x1={x(h.t)} x2={x(h.t)} y1={PAD.top} y2={PAD.top + ih} stroke="#9ca3af" strokeWidth={1} strokeDasharray="3 3" />}
          {pts.map((p, i) => (
            <circle
              key={i}
              cx={x(p.t)}
              cy={y(p.v)}
              r={hover === i ? 5 : 4}
              fill={isBad(p) ? '#dc2626' : '#15803d'}
              stroke="#fff"
              strokeWidth={2}
            />
          ))}
        </svg>
        {h && (
          <div
            className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 -translate-y-full rounded-md bg-gray-900 px-2 py-1 text-xs text-white shadow whitespace-nowrap"
            style={{ left: `${(x(h.t) / W) * 100}%` }}
          >
            <div className="font-semibold">{fmtV(h.v)}{isBad(h) ? ' ⚠' : ''}</div>
            <div className="text-gray-300">{fmtDateTime(h.at)}</div>
          </div>
        )}
      </div>
    </figure>
  );
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

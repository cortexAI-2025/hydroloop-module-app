import type { EnvAlert } from '@/types/batch';

interface Props {
  alerts: EnvAlert[];
}

export default function AlertBadge({ alerts }: Props) {
  if (alerts.length === 0) return null;

  return (
    <div className="space-y-1.5">
      {alerts.map((a, i) => (
        <div
          key={i}
          className={`flex items-start gap-2 rounded-md px-3 py-2 text-xs font-medium
            ${a.severity === 'danger'
              ? 'bg-red-50 text-red-700 border border-red-200'
              : 'bg-amber-50 text-amber-700 border border-amber-200'
            }`}
        >
          <span className="mt-0.5 shrink-0">{a.severity === 'danger' ? '🚨' : '⚠️'}</span>
          <span>
            <strong>{a.label} = {a.value}</strong> — {a.message}
          </span>
        </div>
      ))}
    </div>
  );
}

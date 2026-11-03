'use client';
import type { EnvironmentalData, PhaseNumber } from '@/types/batch';
import { describeRange, getActiveThresholds } from '@/lib/thresholds';

interface Props {
  value: EnvironmentalData;
  onChange: (field: keyof EnvironmentalData, value: number | string) => void;
  phase: PhaseNumber;
}

type NumField = Exclude<keyof EnvironmentalData, 'photopériode'>;

const FIELDS: { key: NumField; label: string; hint: (p: PhaseNumber) => string; step?: number; min?: number; max?: number }[] = [
  { key: 'pH', label: 'pH solution', hint: () => describeRange('pH'), step: 0.1, min: 3, max: 9 },
  { key: 'EC', label: 'EC (mS/cm)', hint: (p) => `niveau ${p} : ${getActiveThresholds().ecByLevel[p][0]}–${getActiveThresholds().ecByLevel[p][1]}`, step: 0.1, min: 0 },
  { key: 'oxygene_dissous', label: 'O₂ dissous (mg/L)', hint: () => describeRange('oxygene_dissous'), step: 0.1, min: 0 },
  { key: 'temperature_solution', label: 'T° solution (°C)', hint: () => describeRange('temperature_solution'), step: 0.1 },
  { key: 'debit_NFT', label: 'Débit NFT (L/min)', hint: () => describeRange('debit_NFT'), step: 0.1, min: 0 },
  { key: 'temperature_air_jour', label: 'T° air jour (°C)', hint: () => describeRange('temperature_air_jour'), step: 0.1 },
  { key: 'temperature_air_nuit', label: 'T° air nuit (°C)', hint: () => describeRange('temperature_air_nuit'), step: 0.1 },
  { key: 'humidite_relative', label: 'Humidité (%)', hint: () => describeRange('humidite_relative'), step: 1, min: 0, max: 100 },
  { key: 'PPFD', label: 'PPFD (µmol/m²/s)', hint: () => (getActiveThresholds().metrics.PPFD.enabled ? describeRange('PPFD') : 'indicatif'), step: 10, min: 0 },
];

export default function EnvFields({ value, onChange, phase }: Props) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
      {FIELDS.map((f) => (
        <div key={f.key}>
          <label className="label" htmlFor={`env-${f.key}`}>
            {f.label} <span className="text-gray-400 font-normal">({f.hint(phase)})</span>
          </label>
          <input
            id={`env-${f.key}`}
            className="input"
            type="number"
            inputMode="decimal"
            required
            step={f.step}
            min={f.min}
            max={f.max}
            value={Number.isFinite(value[f.key]) ? value[f.key] : ''}
            onChange={(e) => onChange(f.key, e.target.value === '' ? NaN : Number(e.target.value))}
          />
        </div>
      ))}
      <div>
        <label className="label" htmlFor="env-photo">
          Photopériode <span className="text-gray-400 font-normal">(ex : 18/6)</span>
        </label>
        <input
          id="env-photo"
          className="input"
          type="text"
          pattern="\d{1,2}/\d{1,2}"
          value={value.photopériode}
          onChange={(e) => onChange('photopériode', e.target.value)}
        />
      </div>
    </div>
  );
}

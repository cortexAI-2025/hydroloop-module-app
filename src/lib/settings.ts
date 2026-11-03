import { settingGet, settingSet } from './db';
import { DEFAULT_THRESHOLDS, normalizeThresholds, setActiveThresholds } from './thresholds';
import type { Thresholds } from './thresholds';
import { notifyDataChanged } from './events';

export interface AppSettings {
  thresholds: Thresholds;
  /** Rappels de relevé en retard (notifications locales, application ouverte). */
  reminders: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = { thresholds: DEFAULT_THRESHOLDS, reminders: false };

const KEY = 'app';

/** Charge les réglages de l'utilisateur courant et active ses seuils. Ne lève jamais d'erreur. */
export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = (await settingGet<Partial<AppSettings>>(KEY)) ?? {};
    const { value } = normalizeThresholds(raw.thresholds);
    const s: AppSettings = { thresholds: value, reminders: !!raw.reminders };
    setActiveThresholds(s.thresholds);
    return s;
  } catch {
    setActiveThresholds(DEFAULT_THRESHOLDS);
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(next: AppSettings): Promise<{ saved: boolean; errors: string[] }> {
  const { value, errors } = normalizeThresholds(next.thresholds);
  if (errors.length) return { saved: false, errors };
  const s: AppSettings = { thresholds: value, reminders: next.reminders };
  await settingSet(KEY, s);
  setActiveThresholds(s.thresholds);
  notifyDataChanged();
  return { saved: true, errors: [] };
}

export async function resetThresholds(current: AppSettings): Promise<AppSettings> {
  const s: AppSettings = { ...current, thresholds: DEFAULT_THRESHOLDS };
  await settingSet(KEY, s);
  setActiveThresholds(s.thresholds);
  notifyDataChanged();
  return s;
}

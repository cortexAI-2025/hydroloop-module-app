import { getBatches } from './storage';
import { isReadingDue } from './tracking';
import { loadSettings } from './settings';

/** Rappels locaux : une notification récapitulative si des relevés sont en retard (application ouverte, aucun serveur impliqué). */
export async function checkReminders(now: Date = new Date()): Promise<number> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return 0;
  const settings = await loadSettings();
  if (!settings.reminders) return 0;
  const due = (await getBatches()).filter((b) => b.status === 'active' && isReadingDue(b, now, settings.thresholds));
  if (due.length === 0) return 0;
  const last = Number(localStorage.getItem('hydroloop:lastReminder') ?? 0);
  if (now.getTime() - last < 6 * 3600_000) return due.length; // au plus une notification toutes les 6 h
  try { localStorage.setItem('hydroloop:lastReminder', String(now.getTime())); } catch { /* ignore */ }
  new Notification('HydroLoop — relevés en retard', {
    body: `${due.length} batch(es) sans relevé récent : ${due.slice(0, 3).map((b) => b.id).join(', ')}${due.length > 3 ? '…' : ''}`,
    tag: 'hydroloop-reminder',
  });
  return due.length;
}

export async function enableReminders(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  return (await Notification.requestPermission()) === 'granted';
}

/** Diffusé après toute modification des données locales (création, relevé, synchro…) : les écrans se rafraîchissent. */
export const DATA_CHANGED_EVENT = 'hydroloop:data-changed';
/** Diffusé uniquement après une écriture locale de l'utilisateur : déclenche une synchronisation différée. */
export const LOCAL_WRITE_EVENT = 'hydroloop:local-write';

export function notifyDataChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
}

export function notifyLocalWrite() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(LOCAL_WRITE_EVENT));
  window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
}

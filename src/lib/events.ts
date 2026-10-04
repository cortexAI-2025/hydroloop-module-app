/** Diffusé après toute modification locale des données (création, relevé, synchro…). */
export const DATA_CHANGED_EVENT = 'hydroloop:data-changed';

export function notifyDataChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
}

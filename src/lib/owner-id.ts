/** Identifiant technique d'un utilisateur (nom de base IndexedDB, claim `sub` du jeton cloud) : minuscules, [a-z0-9_-]. */
export const sanitizeOwner = (name: string): string =>
  name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'local';

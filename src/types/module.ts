/** Hauteurs des niveaux au-dessus du sol (cm), module dôme : N1 haut → N3 bas. */
export const LEVEL_HEIGHT_CM = { 1: 160, 2: 100, 3: 40 } as const;

export type ModuleKindId = 'dome-36' | 'aframe-48' | 'aframe-24' | 'aframe-12';

export interface ModuleKind {
  id: ModuleKindId;
  label: string;
  plants: number;
  levels: number;
  plantsPerLevel: number;
  /** Hauteur adulte maximale par niveau (cm), null = non contrainte par ce modèle. */
  maxPlantHeightCm: { 1: number | null; 2: number | null; 3: number | null };
  note?: string;
}

export const MODULE_KINDS: Record<ModuleKindId, ModuleKind> = {
  'dome-36': {
    id: 'dome-36',
    label: 'Dôme — 36 plants (3 niveaux × 12)',
    plants: 36,
    levels: 3,
    plantsPerLevel: 12,
    // N1 petit, N2 moyen, N3 jusqu'à 120 cm (hypothèses N1/N2 : voir fiche prototype)
    maxPlantHeightCm: { 1: 30, 2: 60, 3: 120 },
    note: 'Un canal NFT annulaire par niveau, pente 2 %, un réservoir par niveau au sol.',
  },
  'aframe-48': { id: 'aframe-48', label: 'A-Frame — 48 plants', plants: 48, levels: 3, plantsPerLevel: 16, maxPlantHeightCm: { 1: null, 2: null, 3: null } },
  'aframe-24': { id: 'aframe-24', label: 'A-Frame — 24 plants', plants: 24, levels: 3, plantsPerLevel: 8, maxPlantHeightCm: { 1: null, 2: null, 3: null } },
  'aframe-12': { id: 'aframe-12', label: 'A-Frame — 12 plants', plants: 12, levels: 3, plantsPerLevel: 4, maxPlantHeightCm: { 1: null, 2: null, 3: null } },
};

/** Module physique : une seule variété à la fois. */
export interface ModuleRecord {
  id: string;
  name: string;
  kind: ModuleKindId;
  /** Variété cultivée actuellement (règle : une variété par module). */
  varietyId?: string;
  location?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

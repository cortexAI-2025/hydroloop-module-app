# Cycle, variétés et modules

- Chaque variété porte sa **nurserie** (n, 12 j par défaut) et sa **durée totale** seed-to-yield (T).
- Les phases N1 croissance, N2 stretch, N3 floraison durent chacune **(T − n) / 3** jours.
- La nurserie tourne en parallèle de la cohorte précédente ; intégration au module au jour n + 1 (J+13 pour n = 12).
- En régime établi : une récolte tous les (T − n) / 3 jours, soit 365 / ((T − n) / 3) récoltes par an.
- Un module = une seule variété. Dôme 36 : 3 niveaux × 12 plants ; la cohorte descend N1 → N2 → N3.
- EC cible par stade : N1 1,2–1,6 · N2 1,8–2,2 · N3 2,4–2,8 mS/cm.
- Catalogue : aucune variété commerciale n'est préchargée. Importer un CSV depuis /varieties
  (colonnes `name;breeder;nursery_days;total_days;height_min_cm;height_max_cm;thc_pct;cbd_pct;status;source;notes`).
- Les variétés, modules et journaux d'eau sont stockés localement (IndexedDB v2) ; la synchro Supabase ne couvre que les lots (`batches`), journal d'eau et récolte inclus.

Tests : `npm test` (Node ≥ 22.6, logique pure uniquement).

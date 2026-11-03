# Sauvegarde et restauration

## Sauvegarder
- **Exporter (.json)** (*Données*) : sauvegarde complète réimportable (batches, relevés, journaux, rapports). Faites-en une régulièrement et avant tout changement d'appareil.
- **Exporter (.csv)** : un relevé par ligne, pour tableur.
- **Copies automatiques** : une par jour et avant chaque import/fusion/restauration, 7 conservées **sur l'appareil**. Elles ne remplacent pas un export hors appareil.
- **Cloud** : si Supabase est configuré, sauvegardez aussi la base (outils Supabase / `pg_dump`).

## Restaurer
1. *Données → Importer (.json)* : le fichier est **fusionné** (jamais d'écrasement). Le résumé indique ajoutés / fusionnés / identiques / invalides.
2. *Copies de sécurité automatiques → Restaurer* : fusion de la copie choisie.
3. *Corbeille → Restaurer* pour un batch supprimé par erreur.
4. Un batch supprimé après une copie reste dans la corbeille lors d'une restauration de cette copie (la suppression est une décision enregistrée) : le récupérer via la corbeille.

## Nouvel appareil
Connectez-vous avec le même compte : la synchro rapatrie tout. Sans cloud : importez le JSON exporté.

## Appareil perdu / stockage purgé
Les données cloud sont récupérables par synchro. Sans cloud, seule la dernière exportation JSON permet la restauration — d'où la nécessité d'exporter.

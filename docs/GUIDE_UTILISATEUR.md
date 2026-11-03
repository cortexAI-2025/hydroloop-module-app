# Guide utilisateur

## Installer sur Android
Ouvrez l'application dans Chrome, connectez-vous, puis « Installer HydroLoop » (bandeau) ou menu ⋮ → *Ajouter à l'écran d'accueil*. Elle s'ouvre ensuite en plein écran et fonctionne sans réseau.

## Hors ligne
Tout fonctionne : créer un batch, saisir des relevés, monter de niveau, récolter. Un bandeau « Mode hors ligne » apparaît ; la pastille de la barre de navigation indique le nombre de modifications en attente. Au retour du réseau, elles partent automatiquement. L'analyse IA est alors remplacée par le **rapport local**.
Astuce : ouvrez une fois l'application en ligne (les pages sont préparées pour le hors ligne) et acceptez la « protection du stockage » proposée dans *Données*.

## Au quotidien
1. **Nouveau batch** : souche, module, nombre de plants, date de semis, niveau de départ.
2. **Relevé** (bouton *Saisir*) : pH, EC, O₂, températures, débit, humidité… Les valeurs hors plage sont signalées immédiatement.
3. **Monter au niveau suivant** quand la durée cible est atteinte ; **Récolte** pour clôturer (masse, congélation, n° de lot).
4. **Rapport** : IA si disponible, sinon rapport local. Les mentions *mesuré / calculé / règle / estimation* indiquent la nature de chaque information. Les prévisions sont des fourchettes, jamais des garanties.
5. **QR / passeport** : traçabilité du lot, imprimable.

## Réglages
Menu *Réglages* : seuils d'alerte, EC par niveau, durées, rappels de relevé en retard. Voir [SEUILS.md](SEUILS.md).

## Données
Menu *Données* : état de la synchro, conflits fusionnés, export JSON/CSV, import, copies de sécurité automatiques, corbeille. Voir [SAUVEGARDE_RESTAURATION.md](SAUVEGARDE_RESTAURATION.md).

## Plusieurs appareils / plusieurs personnes
Chaque personne a son compte : ses données sont séparées. Deux appareils du même compte se synchronisent ; si les deux ont modifié le même batch, tout est conservé et fusionné (voir l'événement « Fusion » du journal).

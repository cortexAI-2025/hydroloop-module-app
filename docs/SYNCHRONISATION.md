# Synchronisation et conflits

## Données et état de synchro

Chaque batch local porte :

- `rev` : compteur incrémenté à chaque modification locale ;
- `sync.dirty` : modifications non envoyées (c'est la **file d'attente**, persistée dans IndexedDB : elle survit à un redémarrage, une coupure ou une fermeture de l'application) ;
- `sync.baseRev` : dernière révision cloud connue ;
- suppression **logique** uniquement (`deletedAt`), jamais physique.

Côté cloud : `rev` (augmente à chaque écriture), `server_updated_at` (posé par la base, pas par l'appareil).

## Déroulement (`runSync`)

1. **Récupération** : lecture des lignes modifiées depuis le dernier curseur (avec 60 s de chevauchement). Batch inconnu → ajouté. Batch local sans modification en attente → remplacé par la version cloud plus récente. Batch local **avec** modifications en attente → **fusion**.
2. **Envoi** : pour chaque batch en attente, *comparaison-échange* (`UPDATE … WHERE rev = <révision connue>`). Si 0 ligne modifiée, quelqu'un a écrit entre-temps : on récupère, on fusionne, on réessaie (4 tentatives maximum). Batch jamais envoyé : insertion ; si l'id existe déjà (doublon), fusion au lieu d'écraser.
3. Les échecs sont rapportés par batch ; les autres continuent. En cas de coupure réseau, tout reste en file d'attente et reprend à la prochaine synchro (retour du réseau, retour sur l'onglet, après chaque écriture, toutes les 5 min).

## Règles de fusion (`mergeRecords`)

Déterministes et symétriques (`merge(a,b) = merge(b,a)`), donc deux appareils convergent vers le même résultat.

| Élément | Règle |
|---|---|
| Relevés, événements | Union par identifiant — **rien n'est perdu**. |
| Champs de saisie (souche, module, notes…) | La version la plus récente est retenue ; la valeur écartée est consignée dans un événement « Fusion ». |
| Niveau (phase) | Le plus avancé l'emporte. |
| Récolte | Irréversible : jamais annulée par une version sans récolte. |
| Rapport | Le plus récent. |
| Suppression | N'écrase jamais une activité enregistrée après elle (le batch est alors restauré, avec trace). |
| Valeurs courantes | Dernier relevé connu. |

Les conflits résolus sont listés dans *Données → Synchronisation*, et inscrits dans le journal du batch.

## Garanties testées

`src/lib/merge.test.ts`, `src/lib/sync/engine.test.ts` (deux appareils, coupure réseau, doublons, écriture concurrente pendant l'envoi, isolation entre comptes), `supabase/rls.test.ts`, `e2e/offline-sync.spec.ts` (navigateur réel : création hors ligne → retour réseau → second appareil).

## Limites connues

- Deux modifications simultanées d'un **même champ** : une seule valeur est retenue (la plus récente) ; l'autre figure dans le journal, pas dans le champ.
- Les horloges des appareils servent à départager les versions ; une horloge très décalée peut inverser ce choix (aucune donnée n'est perdue pour autant : relevés/événements restent réunis).
- Pas de synchronisation en arrière-plan quand l'application est fermée (limite des PWA).

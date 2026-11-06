# API Branché — disponibilité temps réel des points de charge (v2)

## Endpoint

| Méthode | Chemin | Réponse |
|---|---|---|
| GET | `/v1/availability?ids=FR...,FR...` | `{ updatedAt, source, feedOk, items: { [id]: { status: "libre"\|"occupe"\|"hors_service"\|"inconnu", at } } }` |

- `ids` : 1 à 200 `id_pdc_itinerance` séparés par des virgules (caractères `A-Z a-z 0-9 *`). Seul paramètre accepté.
  Normalisation : bords retirés, majuscules, `*` supprimés (`fr*abc*e0006*1` → `FRABCE00061`), puis motif du schéma
  `^[A-Z]{2}[A-Z0-9]{4,33}$`. Les clés de `items` sont les identifiants **normalisés**, dédoublonnés.
- Erreurs : `400 invalid_ids` (absent, vide, segment vide, caractère interdit, paramètre répété), `400 too_many_ids`
  (> 200), `400 invalid_query` (autre paramètre), `503 availability_disabled` (`IRVE_DYN_URL=off`). Les messages
  d'erreur ne recopient jamais la valeur reçue.
- `at` : horodatage publié par l'opérateur (ISO 8601 UTC), `null` si le point de charge est absent du flux.
- `updatedAt` : dernier téléchargement réussi de la source ; `null` si aucun.
- `feedOk` : `false` si aucune copie, ou si la dernière copie réussie a plus de 15 min (la source est en panne).
  La copie précédente reste servie ; ses statuts deviennent `inconnu` à mesure qu'ils dépassent 30 min.
- `cache-control: public, max-age=30`. Limite globale de débit (60 req/min/IP).
- Journaux : la route est en `logLevel: warn` ; aucun identifiant de point de charge n'est journalisé.
- `GET /v1/meta` → `features.availability` (`false` si `IRVE_DYN_URL=off`).

## Correspondance des statuts

| `etat_pdc` | `occupation_pdc` | `status` |
|---|---|---|
| `hors_service` | (toute valeur) | `hors_service` |
| (toute valeur) | `occupe` ou `reserve` | `occupe` |
| `en_service` | `libre` | `libre` |
| autres cas (`inconnu`, valeur hors schéma) | | `inconnu` |

Horodatage de plus de 30 min, ou daté de plus de 5 min dans le futur → `inconnu` (avec `at` renseigné). On n'annonce
jamais « libre » sans certitude.

## Source

- Jeu de données : « [BETA] Bases Nationales des Points de Recharge pour Véhicules Électriques en France (IRVE) »,
  publié par le Point d'accès national transport.data.gouv.fr (ministère des Transports) sur data.gouv.fr.
- Ressource « [BETA] Base nationale consolidée IRVE – données dynamiques » :
  `https://www.data.gouv.fr/api/1/datasets/r/89185b1f-f958-4c5b-9282-399a66ecee97` (URL stable, défaut de
  `IRVE_DYN_URL`) ; téléchargement direct `https://transport.data.gouv.fr/resources/84098/download`.
- Format : CSV (≈ 8,9 Mo en novembre 2026), schéma `etalab/schema-irve-dynamique` 2.3.1 : `id_pdc_itinerance`,
  `etat_pdc`, `occupation_pdc`, `horodatage`, `etat_prise_type_2`, `etat_prise_type_combo_ccs`,
  `etat_prise_type_chademo`, `etat_prise_type_ef`. Le parseur lit les colonnes par leur nom (colonnes
  supplémentaires tolérées), en flux (csv-parse), avec un plafond de 150 Mo et 2 M de lignes.
- Licence : Licence Ouverte / Open Licence 2.0 (mention de la source obligatoire : champ `source`).
- Fréquence : consolidation « en temps réel » (cache de quelques secondes plus le délai de rafraîchissement de chaque
  producteur ; la documentation recommande aux producteurs ≤ 1 min). Branché télécharge toutes les 2 min
  (`IRVE_DYN_REFRESH_S`, 120–600 s).
- Polling : il démarre à la première requête (ou au démarrage si `NODE_ENV=production`) et s'arrête après 30 min
  sans requête. Une seule requête amont à la fois ; au plus une tentative toutes les 30 s si la source est en
  échec ; la première requête attend au plus 8 s le premier téléchargement.

## Limites (à afficher honnêtement dans l'app)

- **Couverture partielle** : seuls les opérateurs qui publient un fichier IRVE dynamique sur data.gouv.fr sont
  couverts. Je n'ai trouvé aucun chiffre officiel de couverture. À partir de la taille du fichier (≈ 8,9 Mo, soit
  environ 100 octets par ligne), on peut estimer quelques dizaines de milliers de lignes au plus. Le parc public
  compte environ 160 000 points de charge (Gireve, avril 2025) et davantage aujourd'hui. Il faut donc s'attendre à
  ce qu'une **minorité** des points de charge, peut-être moins de la moitié, ait un statut. Le chiffre réel est
  journalisé à chaque chargement (`pdc`, `rejected`) et doit être mesuré en production.
- Consolidation **bêta, non validée, non dédoublonnée** : en cas de doublon, la ligne la plus récente est retenue ;
  les lignes à l'identifiant ou à l'horodatage invalide (sans fuseau, par exemple) sont ignorées.
- Absent du flux ≠ hors service : l'app doit afficher « disponibilité inconnue », pas « occupé ».
- Les signalements communautaires `borne_hs` (POST `/v1/reports`) ne sont pas fusionnés ici. Ils sont positionnels
  (lon/lat arrondis), alors que cet endpoint travaille par identifiant sans coordonnées. Ils restent visibles via
  `/v1/incidents`. Une fusion est possible côté app en croisant la position de la station.

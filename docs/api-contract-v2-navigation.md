# Contrat V2 — navigation (itinéraires comparés, recherche d'adresse)

Complète `api-contract-v1.1.md` (incidents, signalements, zones de danger inchangés). Tout reste **POST** : ni coordonnées ni saisie dans les URL ou les journaux.

## POST /v1/route

Corps :
```json
{ "from": { "lat": 48.7536, "lon": 2.2975 }, "to": { "lat": 48.7839, "lon": 2.3457 },
  "via": [ { "lat": 48.77, "lon": 2.33 } ],
  "options": { "avoidTolls": false, "avoidMotorways": false } }
```
`via` (facultatif, ≤ 3, ex. borne de recharge ajoutée) et `options` (facultatif) sont nouveaux. Validation V1.1 + étapes dans le même territoire, somme des tronçons ≤ 1500 km à vol d'oiseau. Champ inconnu → `400 invalid_body`.

Réponse : **champs V1.1 conservés à la racine** (copie de `routes[0]`, le plus rapide) + :
```jsonc
{
  "provider": "tomtom", "traffic": true, "durationS": 1720, "trafficDelayS": 240, "distanceM": 17371,
  "geometry": [[2.347, 48.858], …], "steps": [ … ], "alternativesConsidered": 3, "attribution": "© TomTom",
  "hasTolls": true,
  "options": { "avoidTolls": false, "avoidMotorways": false },
  "routes": [                      // le plus rapide d'abord, puis ≤ 2 alternatives (triées par durée)
    { "id": "r0", "durationS": 1720, "trafficDelayS": 240, "distanceM": 17371,
      "hasTolls": true, "hasMotorways": true,
      "geometry": [[lon, lat], …],
      "steps": [ {
        "instruction": "Au rond-point, prenez la 2e sortie sur Avenue de Suffren",
        "maneuver": "roundabout", "exit": 2, "angle": 80,
        "street": "Avenue de Suffren", "towards": "…", "exitNumber": "4",
        "distanceM": 2941, "offsetM": 2060, "pointIndex": 3, "lon": 2.3215, "lat": 48.8502,
        "lanes": [ { "directions": ["straight"], "active": false }, { "directions": ["slight-right"], "active": true } ]
      } ],
      "trafficSections": [ { "startIndex": 2, "endIndex": 4, "delayS": 158, "magnitude": 3 } ],
      "speedLimits":     [ { "startIndex": 0, "endIndex": 4, "kmh": 50 } ],        // si fournies
      "lanes":           [ { "startIndex": 7, "endIndex": 8, "lanes": [ … ] } ]  // si fournies
    } ]
}
```
- `maneuver` ∈ `depart, straight, turn-left, turn-right, slight-left, slight-right, sharp-left, sharp-right, uturn, roundabout, exit-left, exit-right, keep-left, keep-right, merge, ferry, waypoint, arrive`. `exit` = numéro de sortie (rond-point) ; `exitNumber` = numéro du panneau (autoroute) ; `angle` = −180..180, positif à droite.
- Indices (`startIndex`, `endIndex`, `pointIndex`) : positions dans `geometry` du même trajet. `magnitude` (TomTom `magnitudeOfDelay`) : 0 inconnu, 1 faible, 2 modéré, 3 fort, 4 fermé/indéfini.
- `instruction` : texte du fournisseur (balises TomTom retirées), sinon consigne française générée.
- `cache-control: no-store` ; aucun cache (conditions TomTom).

### Fournisseurs
| | TomTom `calculateRoute` (clé) | Valhalla `/route` (repli) |
|---|---|---|
| Requête | `traffic=true, routeType=fastest, maxAlternatives=2` (0 avec `via`), `instructionsType=tagged, language=fr-FR, computeTravelTimeFor=all`, `sectionType=traffic,toll,motorway,speedLimit,lanes` (répété), `avoid=tollRoads` / `avoid=motorways` | `alternates=2` (absent avec `via`, non pris en charge), `costing_options.auto.use_tolls` 0 (éviter) / 0.5, `use_highways` 0 / 1, `turn_lanes=true`, étapes `type:"break"` |
| Manœuvres | `guidance.instructions[].maneuver` (ROUNDABOUT_*, MOTORWAY_EXIT_*, TAKE_EXIT selon `drivingSide`, KEEP_*, BEAR_*…), `roundaboutExitNumber`, `street`/`roadNumbers`, `signpostText`, `exitNumber`, `turnAngleInDecimalDegrees` | `maneuvers[].type` (enum 0–43), 26 + 27 fusionnés (`roundabout_exit_count`, rue et cap de sortie), `sign.exit_number_elements` / `exit_toward_elements`, `bearing_before/after` |
| Trafic | sections `TRAFFIC` (`delayInSeconds`, `magnitudeOfDelay`) | aucun (`traffic:false`) |
| Péages / autoroutes | sections `TOLL`/`TOLL_ROAD`, `MOTORWAY` | `summary.has_toll`, `has_highway` |
| Limitations | sections `SPEED_LIMIT.maxSpeedLimitInKmh` | `/trace_attributes` (`edge_walk`, `edge.speed_limit`), meilleur effort 5 s, ignoré si la forme diffère |
| Voies | sections `LANES` (`directions`, `follow`) rattachées à la manœuvre suivante (≤ 1,5 km) | `maneuvers[].lanes` (masque `kTurnLane*` : 2 tout droit, 4 serré gauche, 8 gauche, 16 léger gauche, 32 léger droite, 64 droite, 128 serré droite, 256 demi-tour) |

Sources : docs.tomtom.com (Calculate Route, Guidance instructions), valhalla.github.io (Route API). Fixtures : `apps/api/test/fixtures/{tomtom-route-v2,valhalla-route-v2,valhalla-trace-attributes}.json`.

## POST /v1/search
Corps `{ "q": "10 rue de rivoli", "near": { "lat": 48.85, "lon": 2.35 } }` (`near` facultatif, biais de proximité ; hors zone → ignoré).
Réponse `200` :
```json
{ "provider": "tomtom", "attribution": "© TomTom",
  "results": [ { "label": "10 Rue de Rivoli", "sublabel": "75004 Paris", "lat": 48.85564, "lon": 2.35896, "kind": "address" } ] }
```
Objet (et non tableau nu) pour porter l'attribution à afficher. `kind` ∈ `address, street, poi, city`. 8 résultats au plus, dédoublonnés, limités au territoire couvert.
- TomTom Fuzzy Search si `TOMTOM_API_KEY` : `countrySet=FR,GP,MQ,GF,RE,YT` (métropole + DROM), `language=fr-FR`, `typeahead=true`, `limit=8`, `lat/lon` arrondis à 3 décimales.
- Sinon Photon (`PHOTON_URL`, défaut `https://photon.komoot.io/api/`, `off` = désactivé) : `lang=fr`, `bbox` du territoire de `near` (défaut métropole), filtre `countrycode`. Attribution « © contributeurs OpenStreetMap, Photon (komoot) ».
- Sans API configurée (site statique), l'app interroge Photon directement (même normalisation, `src/lib/photon.ts`) ; elle le fait aussi si l'API répond 503.
- Erreurs : `400 invalid_body | query_too_short (< 2) | query_too_long (> 120) | invalid_coordinates`, `405` en GET, `429 rate_limited` (30/min par IP, empreinte salée), `502 search_provider_error`, `503 search_unavailable`.
- **Jamais de cache**, `no-store`. Journaux : ni la requête, ni la position (seulement fournisseur + raison d'échec).

## App
- Récents : 8 destinations sur l'appareil (`branche.nav.recents.v1`), effaçables ; aucune synchronisation.
- Voix : préférence `branche.nav.voice.v1` ; annonces ≈ 1500/500/120 m (≥ 75 km/h), 800/300/70 m (40–75), 400/150/40 m (ville), enchaînement « puis » si la manœuvre suivante est à < 150 m.
- Trajet plus rapide : nouvelle requête toutes les 2 min pendant le guidage ; bascule annoncée si gain ≥ 3 min par rapport au trajet actuel recalculé (même trafic) ou, à défaut, au temps restant estimé.
- Partage de l'arrivée : destination + heure, jamais la position.

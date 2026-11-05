# Contrat V1.1 — paiement direct, itinéraire, alertes

## 1. Connecteurs de paiement (app)
Interface `PaymentConnector { id; label; available(station): boolean; start(ctx): Promise<void> }`.
| id | Principe | Contrat requis |
|---|---|---|
| `scan` | QR code de la borne (ou saisie manuelle) → domaine vérifié → page de paiement officielle ouverte dans l'app (navigateur intégré, Apple Pay / Google Pay possibles) | Aucun |
| `operator-link` | URL de paiement ad hoc connue pour l'opérateur (registre) | Aucun |
| `branche-card` | Carte virtuelle Branché (BaaS) présentée sur le lecteur CB de la borne | Partenaire d'émission (pas d'itinérance) |
| `branche-pay` | Session API existante (`docs/api-contract.md`) | Itinérance (futur) — démo |

### Registre des opérateurs `data/operators.json` (généré par le pipeline)
```json
{ "v": 1, "operators": [ { "key": "metropolis", "names": ["Metropolis","SPIE CityNetworks"], "domains": ["metropolis-recharge.fr"], "payUrl": null, "stations": 812 } ] }
```
`domains` : domaines officiels déduits de l'IRVE (domaine de `contact_operateur`/`contact_amenageur`, URLs de `tarification`), hors messageries publiques (gmail, outlook…). Chaque station porte `ok` = clé opérateur.
`payUrl` : gabarit d'URL ad hoc vérifié (`{evse}` = id PDC), sinon `null`.

### Vérification d'un QR (fonction pure `verifyQr(raw, station?, registry)`)
Résultat `{ kind: 'url'|'evse'|'invalid', url?, evse?, verdict: 'official'|'known-operator'|'unknown'|'dangerous', domain?, operatorKey?, reasons: string[] }`.
- `dangerous` : schéma ≠ https, `data:`/`javascript:`, identifiants dans l'URL, punycode (`xn--`), IP littérale, raccourcisseur (bit.ly, tinyurl, t.co…), domaine imitant un domaine connu (distance d'édition ≤ 2).
- `official` : domaine (ou sous-domaine) appartient à l'opérateur de la station sélectionnée.
- `known-operator` : domaine d'un autre opérateur du registre.
- `unknown` : sinon. `dangerous` → blocage ; `unknown` → avertissement explicite + confirmation.
- Identifiant EVSE (`FR*ABC*E123…`, `FRABCE123…`) → recherche de la station et des connecteurs.

## 2. API (apps/api)
| Méthode | Chemin | Réponse |
|---|---|---|
| POST | `/v1/route` — corps `{ "from": { "lat", "lon" }, "to": { "lat", "lon" } }` | `{ provider: "tomtom"\|"valhalla", traffic: boolean, durationS, trafficDelayS, distanceM, geometry: [[lon,lat]…], steps: [{ instruction, distanceM, lon, lat }], alternativesConsidered, attribution }` — trajet le plus rapide (min durée avec trafic) parmi les alternatives |
| GET | `/v1/route` | `405` + message (les coordonnées ne passent jamais dans l'URL) |
| GET | `/v1/incidents?bbox=w,s,e,n` | `{ updatedAt, source, feedOk, incidents: [{ id, type: "accident"\|"travaux"\|"fermeture"\|"bouchon"\|"obstacle"\|"meteo"\|"autre", title, description, lon, lat, start, end, severity: 1-3, source: "bison-fute"\|"communaute" }] }` |
| POST | `/v1/reports` | in `{ type, lon, lat }` (types : accident, travaux, obstacle, bouchon, borne_hs) → `201 { id, expiresAt }` ; TTL 1 h (borne_hs 24 h) ; limite 10/h/IP |

- Itinéraire : `TOMTOM_API_KEY` côté serveur uniquement (jamais renvoyée) ; sans clé → Valhalla (`VALHALLA_URL`, défaut public FOSSGIS, `traffic:false`). Le serveur public FOSSGIS est non commercial et non prévu pour la production : en production, clé TomTom ou Valhalla auto-hébergé.
- `attribution` (à afficher) : « © TomTom » ou « © contributeurs OpenStreetMap, Valhalla ».
- **Aucun cache** des itinéraires (conditions TomTom : pas de cache partagé) ; `cache-control: no-store`.
- Validation : départ et arrivée dans le même territoire (métropole + Corse, Antilles, Guyane, Réunion, Mayotte ; rectangles larges), distance à vol d'oiseau ≤ 1500 km. Erreurs `400` `invalid_body` \| `invalid_coordinates` \| `out_of_area` \| `too_far` \| `same_point` ; `502 route_provider_error` si le fournisseur échoue.
- Incidents : DATEX II Bison Futé (RRN non concédé, Licence Ouverte 2.0) mis en cache 2 min, `INCIDENTS_URL` configurable ; copie périmée servie si le flux tombe, sinon `feedOk:false` (signalements seuls). Événements terminés (`end` passé) exclus. `bbox` ≤ 20° de côté, sinon `400 invalid_bbox` \| `bbox_too_large`.
- Signalements : pas de type « police » (décision juridique en attente) ; `400 invalid_report_type` ; `429 rate_limited`. Stockés en mémoire : type, position arrondie à 4 décimales, dates. Aucune IP ni identifiant.
- Journaux : ni corps de requête, ni IP, ni coordonnées ; `bbox` arrondie à 2 décimales.

## 3. Zones de danger `data/danger-zones.json` (pipeline)
Source : radars OpenStreetMap (`highway=speed_camera`, ODbL) + radars data.gouv (Licence Ouverte). Publié UNIQUEMENT sous forme de zones (jamais la position du radar) : `{ v:1, zones: [{ id, lon, lat, radiusM }] }` avec centre décalé aléatoirement dans la zone et rayon 2000 m (autoroute 4000, agglomération 500). L'app alerte à l'entrée d'une zone sur l'itinéraire.

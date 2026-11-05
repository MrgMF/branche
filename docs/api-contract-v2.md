# Contrat V2 — parcours de recharge sans compte (retours communautaires, index EVSE)

Complète `docs/api-contract-v1.1.md` (inchangé). Tout ce qui suit fonctionne **sans compte**, et l'app reste utilisable **sans l'API** (aucun appel bloquant : fiabilité et prix constatés sont simplement masqués).

## 1. API (apps/api)
| Méthode | Chemin | Corps / réponse |
|---|---|---|
| POST | `/v1/checkins` | in `{ stationId: string, ok: boolean, pricePaid?: number, kWh?: number, preauth?: number }` → `201 { id, duplicate:false }` ; doublon → `200 { id, duplicate:true }` (non compté) |
| GET | `/v1/stations/:id/community` | `200 { stationId, windowDays:30, checkins, okCount, successRate: 0..1\|null, lastOkAt, lastFailAt, recentPrices:[{ pricePaid, kWh\|null, pricePerKwh\|null, date }], preauth: { median, count, lastDate }\|null }` |

- `stationId` : identifiant de station du pipeline (`id`), 3 à 120 caractères imprimables, sinon `400 invalid_station`. Champs inconnus refusés (`400 invalid_body`).
- `pricePaid` (€ TTC payés, 0 à 500), `kWh` (0 à 300), `preauth` (montant bloqué constaté, €, 0 à 500) : facultatifs, arrondis au centime.
- Dates publiées **au jour près** (`AAAA-MM-JJ`) ; `successRate` calculé sur 30 jours ; prix et pré-autorisations gardés 90 jours, 5 derniers prix publiés ; `pricePerKwh` seulement si `kWh ≥ 1`.
- Mêmes règles que `/v1/reports` : stockage **en mémoire** seulement, **aucune IP ni identifiant d'appareil stocké**, limite **10/h/IP** (`429 rate_limited`, clé = IP salée), journaux sans corps.
- Anti-doublon : empreinte salée `sha256(sel aléatoire par processus, IP, stationId)` conservée **6 h maximum** à part des retours, puis oubliée.
- `GET …/community` : `cache-control: public, max-age=60` ; `POST` : `no-store`.

| Méthode | Chemin | Corps / réponse |
|---|---|---|
| GET | `/v1/meta` | `{ v:2, features: { vehicleIdentify: boolean, checkins: true } }` — l'app masque « Prendre en photo » si `vehicleIdentify:false` |
| POST | `/v1/vehicle/identify` | in `{ image: base64 (≤ 1,5 Mo décodé), mediaType: "image/jpeg"\|"image/png"\|"image/webp" }` → `200 { vehicleId: <id de VEHICLES>\|null, confidence: "haute"\|"moyenne"\|"faible" }` |

- Identification : API Anthropic Messages (`ANTHROPIC_API_KEY` côté serveur uniquement, `ANTHROPIC_MODEL` facultatif), outil imposé dont `vehicleId` est une énumération fermée (identifiants `VEHICLES` + `inconnu` → `null`). Image **jamais stockée ni journalisée** ; réduite à ≤ 1024 px côté app. Erreurs : `503 vehicle_identify_unavailable` (pas de clé), `400 invalid_image`, `413 image_too_large`, `502 identify_failed`, `429 rate_limited` (10/h/IP).
- Disponibilité temps réel : consommée depuis `GET /v1/availability?ids=` (équipe disponibilité) par `apps/mobile/src/lib/availability.ts` (cache 60 s, rien affiché si absente).

## 2. Données statiques (pipeline)
- Points de charge : `pdc: [[id_pdc_itinerance, puissance_kW, prises[]], …]` (24 points détaillés par station au maximum ; `prises` ∈ `ccs`, `t2`, `chademo`, `ef`). Les anciennes tuiles `[id, kW]` restent lues (prises de la station en repli).
- `cab: true` : au moins un point a un câble Type 2 attaché.
- `prix` : texte `tarification` conservé jusqu'à 300 caractères ; analysé dans l'app (`apps/mobile/src/lib/tariff.ts`).
- Index EVSE `data/evse/<seau>.json` = `{ v:1, m: { ID_NORMALISÉ: "tuile" | "tuile|id_station" } }`. ID normalisé = majuscules sans `*` ni espaces ; seau = FNV-1a 32 bits modulo 256, en hexadécimal sur 2 caractères (même calcul dans `pipeline/src/normalize.mjs` et `apps/mobile/src/lib/evse.ts`, vecteurs de test partagés). Sert à ouvrir une borne depuis un QR code ou un lien profond sans connaître la position.

- Portails opérateurs : `pipeline/data/operator-portals.json` (`{ v:1, operators: { [clé]: { name, webPortal, webStart:{status,url}, adhocWeb, cardReader, appOnly, roamingBadgesAccepted, sources } } }`) est recopié par `pipeline/src/cli.mjs` dans `data/operator-portals.json` ; absent → l'app se fonde sur la base IRVE seule.

## 3. Liens profonds (app)
- `branche://recharger?evse=FR*ABC*E123` (natif) et `/<base>/app/recharger?evse=FR*ABC*E123` (web) ouvrent directement le parcours de recharge sur ce point. `?station=<id>` ouvre la station.

## 4. Données locales (appareil uniquement, AsyncStorage)
| Clé | Contenu |
|---|---|
| `branche.direct.v1` | recharge en cours (station, point, méthode, estimation, heures de début/fin) — reprise après fermeture |
| `branche.history.v1` | historique des recharges (reçus), export CSV, suppression par l'utilisateur |
| `branche.vehicle.v1` | véhicule choisi et % de batterie (`src/lib/vehicle.ts`) |
| `branche.onboarded.v1` | premier lancement vu |
| `branche.prepared.v1` | recharge préparée à l'avance (point, méthode, estimation), 48 h |
| `branche.wallet.v1` | « compte X connecté le … » et noms de badges (jamais d'identifiant ni de numéro) |

Rien de tout cela n'est envoyé, sauf le retour anonyme ci-dessus (seulement si l'utilisateur répond « Ça a marché ? ») et la photo du véhicule si l'utilisateur choisit « Prendre en photo » (identifiée puis oubliée).

## 5. Ordre des méthodes (app, `src/lib/methods.ts`)
Sans compte d'abord : paiement ponctuel déclaré (QR vérifié / lien connu) → CB au lecteur → badge accepté → compte opérateur **seulement si l'opérateur l'impose** (« Ajouter mon compte X une fois » sur son site officiel dans le navigateur intégré, puis réutilisé) → QR éventuel non déclaré. Si rien n'est payable depuis Branché : message honnête + borne payable la plus proche.

# @branche/api

API V1 de Branché (Fastify 5, TypeScript strict). Contrats : [`docs/api-contract.md`](../../docs/api-contract.md), [`docs/api-contract-v1.1.md`](../../docs/api-contract-v1.1.md) (itinéraire, incidents, signalements). Décisions : [`docs/adr/0001-api-v1.md`](../../docs/adr/0001-api-v1.md), [`docs/adr/0003-navigation-api.md`](../../docs/adr/0003-navigation-api.md).

## Lancer

```bash
npm install                      # à la racine du dépôt
npm run dev -w apps/api          # http://localhost:8787 (tsx watch)
npm test -w apps/api             # vitest, sans réseau
npm run build -w apps/api && npm start -w apps/api
docker build -t branche-api apps/api && docker run -p 8787:8787 branche-api
```

Parcours démo : `POST /v1/sessions` → ouvrir `checkoutUrl` → « Autoriser 50,00 € » → `GET /v1/sessions/:id` (charge simulée) → `POST /v1/sessions/:id/stop`.

## Variables

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` / `HOST` | `8787` / `0.0.0.0` | Écoute |
| `PUBLIC_URL` | `RENDER_EXTERNAL_URL` ou `http://localhost:PORT` | Base des `checkoutUrl` |
| `PAYMENT_PROVIDER` | `mock` | `mock` ou `stripe` |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | — | Requis si `stripe` (clé `sk_live_` refusée en V1) |
| `PRICE_CENTS_PER_KWH`, `FEE_CENTS`, `PREAUTH_CENTS` | `45`, `49`, `5000` | Tarification (centimes) |
| `SIM_POWER_KW`, `SIM_SPEED` | `50`, `20` | Simulateur de borne |
| `ALLOWED_RETURN_PREFIXES` | `branche://,exp://,exps://,http://localhost,http://127.0.0.1,https://*.github.io` | Préfixes autorisés pour `returnUrl` (`*` = un label DNS) |
| `RATE_LIMIT_MAX` | `60` | Requêtes/min/IP |
| `TRUST_PROXY` | `false` | `1` derrière Render (IP réelle pour le rate-limit) |
| `LOG_LEVEL` | `info` | Logs pino (sans corps, IP ni coordonnées ; `bbox` arrondie à 2 décimales) |
| `TOMTOM_API_KEY` | — | Itinéraire avec trafic (TomTom Routing). Serveur uniquement, jamais renvoyée |
| `NODE_ENV` | — | `production` : le Valhalla public FOSSGIS n'est jamais utilisé (sans clé ni `VALHALLA_URL` → `/v1/route` 503) |
| `VALHALLA_URL` | `https://valhalla1.openstreetmap.de/route` hors production, aucun en production | Repli sans clé TomTom. Le défaut public FOSSGIS est **non commercial et non prévu pour la production** |
| `REPORTS_DISABLED` | — | Zones où les signalements sont suspendus : `w,s,e,n\|2026-12-31T23:59:59+01:00;…` → 403 et signalements masqués |
| `INCIDENTS_URL` | flux data.gouv « Événements RRN non concédé » (temps réel) | DATEX II Bison Futé, cache 2 min |

## Navigation (contrat V1.1)

```bash
curl -X POST localhost:8787/v1/route -H 'content-type: application/json' \
  -d '{"from":{"lat":48.858,"lon":2.347},"to":{"lat":48.805,"lon":2.130}}'
curl 'localhost:8787/v1/incidents?bbox=2.2,48.8,2.5,48.95'
curl -X POST localhost:8787/v1/reports -H 'content-type: application/json' -d '{"type":"bouchon","lon":2.35,"lat":48.86}'
```

- Itinéraire en **POST** (les coordonnées ne doivent pas figurer dans les URL ni les journaux) ; `GET /v1/route` → 405. Pas de cache (conditions TomTom). Champ `attribution` à afficher sous la carte.
- **Production** (`NODE_ENV=production`, défini dans `render.yaml`) : `TOMTOM_API_KEY` requise pour le trafic, ou un Valhalla auto-hébergé (`VALHALLA_URL`) ; sinon `POST /v1/route` répond `503 routing_unavailable`. Le serveur public FOSSGIS sert uniquement au développement.
- Signalements : `accident`, `travaux`, `obstacle`, `bouchon` (1 h), `borne_hs` (24 h), `qr_suspect` (7 j) ; suspension par zone via `REPORTS_DISABLED` ; 10/h/IP ; mémoire seule, position arrondie à 4 décimales, aucune IP stockée (limitation par empreinte salée, en mémoire). Pas de type « police ».

### Obtenir une clé TomTom gratuite

1. Créer un compte sur <https://developer.tomtom.com> (offre gratuite : quota journalier de requêtes, sans carte bancaire à la date de rédaction ; vérifier les conditions en vigueur).
2. Tableau de bord → **Keys** → copier la clé par défaut (ou en créer une limitée à *Routing API*).
3. La saisir dans Render (`TOMTOM_API_KEY`, non synchronisée) ou en local : `TOMTOM_API_KEY=… npm run dev -w apps/api`.
4. Vérifier : la réponse de `POST /v1/route` porte `"provider":"tomtom","traffic":true`.

## Passer en Stripe (mode test)

1. Tableau de bord Stripe en **mode test** → clé `sk_test_…`.
2. Webhook → `https://<api>/v1/stripe/webhook`, événements `checkout.session.completed`, `checkout.session.expired` → secret `whsec_…`.
   En local : `stripe listen --forward-to localhost:8787/v1/stripe/webhook`.
3. `PAYMENT_PROVIDER=stripe STRIPE_SECRET_KEY=sk_test_… STRIPE_WEBHOOK_SECRET=whsec_…`.
4. Carte de test `4242 4242 4242 4242`. Pré-autorisation de `PREAUTH_CENTS`, capture `totalCents` à l'arrêt (annulation si 0).
   Sans webhook, `GET /v1/sessions/:id` interroge la Checkout Session (au plus toutes les 3 s).
   Les `returnUrl` non web (`branche://`, `exp://`) passent par le relais `GET /checkout-return/:id`.

En mode Stripe, `/mock-checkout/*` n'existe pas (404).

## Brancher un vrai adaptateur eMSP

Implémenter `ChargerAdapter` (`src/chargers/types.ts`) : `start` (commande START_SESSION OCPI / API marque blanche, avec `maxEnergyWh` comme limite), `stop`, `read` (dernière session CDR/`kwh` connue). L'injecter via `buildApp(config, { charger })` et ajouter sa valeur à `CHARGER_ADAPTER` dans `src/config.ts`. Prévoir alors un store persistant (`SessionStore`) et la réception des sessions pushées par le CPO.

# @branche/api

API V1 de Branché (Fastify 5, TypeScript strict). Contrat : [`docs/api-contract.md`](../../docs/api-contract.md). Décisions : [`docs/adr/0001-api-v1.md`](../../docs/adr/0001-api-v1.md).

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
| `LOG_LEVEL` | `info` | Logs pino |

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

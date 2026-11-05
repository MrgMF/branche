# Contrat API V1 — Branché

Base : `API_URL` (ex. `https://branche-api.onrender.com`). JSON, CORS ouvert. Montants en centimes d'euro.

## Modes
- `PAYMENT_PROVIDER=mock` (défaut) : paiement simulé, page de pré-autorisation servie par l'API. Aucun débit réel. Bandeau « Mode démo » obligatoire côté app.
- `PAYMENT_PROVIDER=stripe` : Stripe Checkout, `capture_method=manual` (pré-autorisation), capture du montant réel à l'arrêt. Requiert `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
- `CHARGER_ADAPTER=simulator` (seul en V1) : borne simulée. Interface prête pour un adaptateur eMSP marque blanche / OCPI.

## Endpoints
| Méthode | Chemin | Corps / réponse |
|---|---|---|
| GET | `/health` | `{ ok: true, mode: "demo"\|"live", payment: "mock"\|"stripe", charger: "simulator" }` |
| GET | `/v1/config` | `{ priceCentsPerKwh, feeCents, preauthCents, currency: "eur", demo: boolean }` |
| POST | `/v1/sessions` | in `{ stationId, stationName, pdcId?, returnUrl }` → `201 Session` + `checkoutUrl` |
| GET | `/v1/sessions/:id` | `Session` |
| POST | `/v1/sessions/:id/stop` | `Session` (capture du montant final) |
| POST | `/v1/sessions/:id/cancel` | `Session` (avant démarrage : annule la pré-autorisation) |
| GET | `/mock-checkout/:id` | page HTML de démo (bouton « Autoriser 50 € ») → redirige vers `returnUrl?session=:id` |
| POST | `/mock-checkout/:id/authorize` | autorise puis démarre la charge, redirige 303 |
| POST | `/v1/stripe/webhook` | `checkout.session.completed` → autorisée → démarrage |

## Session
```json
{
  "id": "ses_…", "status": "awaiting_payment|starting|charging|completed|cancelled|failed",
  "stationId": "…", "stationName": "…", "pdcId": "…|null",
  "checkoutUrl": "…", "demo": true,
  "priceCentsPerKwh": 45, "feeCents": 49, "preauthCents": 5000,
  "energyWh": 0, "powerKw": 0, "costCents": 0, "totalCents": 0,
  "createdAt": "ISO", "startedAt": "ISO|null", "endedAt": "ISO|null",
  "error": null
}
```
`costCents = round(energyWh/1000 × priceCentsPerKwh)`, `totalCents = min(costCents + feeCents, preauthCents)` ; arrêt automatique quand `costCents + feeCents ≥ preauthCents`.

## Simulateur
Puissance qui monte en 20 s jusqu'à `SIM_POWER_KW` (défaut 50), énergie intégrée × `SIM_SPEED` (défaut 20 → une minute réelle ≈ 20 min de charge).

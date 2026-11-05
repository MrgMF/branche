# Branché — instructions pour Claude

App tout-en-un de recharge VE (iOS, Android, web). Objectif V1 : ouvrir l'app, voir la borne la plus proche, payer depuis l'app sans l'appli de l'opérateur.

## Réalité V1 (à ne jamais masquer)
- Données bornes **réelles** : base nationale IRVE (data.gouv.fr, Licence Ouverte 2.0), transformée en tuiles JSON par `pipeline/` et servie par GitHub Pages.
- Paiement in-app : **mode démo** (paiement simulé + borne simulée) tant qu'aucun contrat eMSP (marque blanche ou OCPI/Gireve) n'est signé. L'app l'affiche clairement et propose toujours le paiement direct à la borne quand l'IRVE l'indique (CB, QR, site web).

## Structure
- `pipeline/` : IRVE CSV → `data/tiles/*.json` (grille 0,25°) + `data/meta.json`.
- `apps/api/` : Fastify + Stripe (Checkout, pré-autorisation) + adaptateur de borne (`simulator`). Contrat : `docs/api-contract.md`.
- `apps/mobile/` : Expo (expo-router), carte MapLibre GL JS dans une WebView (iframe sur le web), tuiles OpenFreeMap. Export web publié sur GitHub Pages.
- `apps/web/` : landing page + pages légales.
- `.claude/agents/` : la « société » (superviseur, juridique, design, dev-backend, dev-app, critique).

## Règles
- Français, concis. TypeScript strict. Aucune clé payante requise.
- V2 : spécification `docs/v2-spec.md`. Trois critiques (`critique-paiement`, `critique-navigation`, `critique-ux`) : terminé seulement si chacun ≥ 18/20 et moyenne ≥ 18,5.
- Design : `docs/design/tokens.json`, pas d'emoji, contraste AA, cibles ≥ 44 px.
- Commandes : `npm install`, `npm test`, `npm run build` (racine).

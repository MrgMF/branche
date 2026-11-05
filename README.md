# Branché

Toutes les bornes de recharge publiques, une seule app (iOS, Android, web).
V1 : borne la plus proche à partir de **données réelles** (base nationale IRVE, ~53 000 stations), fiche borne, itinéraire Waze/Google Maps/Plans, paiement dans l'app (**mode démo** tant qu'aucun contrat eMSP n'est signé), suivi de charge et reçu.

## Démarrer
```bash
npm install
npm test                 # pipeline + API
npm run data             # télécharge l'IRVE et génère les tuiles (pipeline/dist/data)
npm run dev -w apps/api  # API sur :8787 (paiement simulé)
cd apps/mobile && npx expo start   # scanner le QR code avec Expo Go (Android / iPhone)
```

## Déployer
1. **Site + app web + données** : pousser sur `main` d'un dépôt GitHub, puis *Settings → Pages → Source : GitHub Actions*. Le workflow `deploy.yml` reconstruit les données chaque nuit. Résultat : `https://<utilisateur>.github.io/branche/` (landing), `/app/` (app), `/data/` (tuiles).
2. **API de paiement** : Render (gratuit) via `render.yaml`, ou tout hébergeur Docker (`apps/api/Dockerfile`). Puis variable de dépôt GitHub `API_URL` = URL de l'API.
3. **Android** : `cd apps/mobile && npx eas-cli@latest build -p android --profile preview` → APK installable ; `--profile production` → AAB pour Google Play. Remplacer `REPLACE_ME` dans `eas.json` par votre identifiant GitHub.
4. **iOS** : tester tout de suite avec Expo Go ; build App Store quand le compte Apple Developer est actif.

## Structure
`pipeline/` données IRVE · `apps/api/` paiement + borne simulée · `apps/mobile/` app Expo · `apps/web/` landing + pages légales · `docs/` contrat d'API, ADR, juridique, design · `.claude/agents/` la société d'agents.

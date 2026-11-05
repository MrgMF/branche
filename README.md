# Branché

Toutes les bornes de recharge publiques, une seule app (iOS, Android, web).
V1.1 : borne la plus proche à partir de **données réelles** (base nationale IRVE, ~53 000 stations), fiche borne, itinéraire Waze/Google Maps/Plans, **paiement direct depuis l'app** sans contrat d'itinérance (scan sécurisé du QR de la borne → page de paiement de l'opérateur vérifiée par la base IRVE, anti-faux QR), itinéraire le plus rapide avec trafic, perturbations Bison Futé, zones de danger, guidage vocal.

## Démarrer
```bash
npm install
npm test                 # pipeline + API
npm run data             # télécharge l'IRVE et génère les tuiles (pipeline/dist/data)
npm run dev -w apps/api  # API sur :8787 (paiement simulé)
cd apps/mobile && npx expo start   # scanner le QR code avec Expo Go (Android / iPhone)
```

## Déployer
1. **Site + app web + données** : pousser sur `main`, puis *Settings → Pages → Source : GitHub Actions*. Dans *Settings → Secrets and variables → Actions → Variables*, créer **`EDITEUR_NOM`** et **`CONTACT_EMAIL`** (obligatoires : mentions légales, le build échoue sans) et **`API_URL`** (URL de l'API, étape 2). Résultat : `https://<identifiant>.github.io/branche/` (landing), `/app/`, `/data/` — données IRVE régénérées chaque nuit.
2. **API de paiement** : Render → *New → Blueprint* sur ce dépôt (`render.yaml`). Saisir **`ALLOWED_RETURN_PREFIXES`** = `branche://,https://<identifiant>.github.io/branche/app/` (sinon le paiement web renvoie « adresse de retour non autorisée »). Le nom `branche-api` peut être pris : notez l'URL réelle. **`TOMTOM_API_KEY` est obligatoire** pour l'itinéraire le plus rapide avec trafic (clé gratuite sur developer.tomtom.com) ; sans elle, l'app propose Waze / Google Maps.
3. **Android** : dans `apps/mobile/eas.json`, remplacer les trois `REPLACE_ME` (identifiant GitHub, URL Render), puis `cd apps/mobile && npx eas-cli@latest build -p android --profile preview` → APK à installer ; `--profile production` → AAB pour Google Play (test fermé 12 testeurs × 14 jours pour un compte personnel récent).
4. **iPhone** : tester tout de suite avec Expo Go (`npx expo start`, scanner le QR code) ; build App Store quand le compte Apple Developer est actif (passer par TestFlight : une app « démo » risque un refus, règle 2.2).

## Structure
`pipeline/` données IRVE · `apps/api/` paiement + borne simulée · `apps/mobile/` app Expo · `apps/web/` landing + pages légales · `docs/` contrat d'API, ADR, juridique, design · `.claude/agents/` la société d'agents.

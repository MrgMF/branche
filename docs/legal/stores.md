# Textes stores — Branché V1

> **Brouillon à faire valider.** Vérifié le 5 novembre 2026. Les formulaires des stores changent souvent : relisez-les au moment de soumettre l'app.

**URL de la politique de confidentialité** (champ App Store Connect + Play Console, et lien dans l'app, exigé par la règle 5.1.1(i) d'Apple) :
`https://[UTILISATEUR].github.io/branche/legal/confidentialite.html`

---

## 1. Permission de localisation

### iOS — `NSLocationWhenInUseUsageDescription`
Uniquement « Pendant l'utilisation ». Ne demandez ni `Always` ni la localisation en arrière-plan.
```
Branché utilise votre position pour trouver la borne de recharge la plus proche. Le calcul se fait sur votre iPhone : votre position n'est jamais envoyée à nos serveurs.
```
Dans Expo (`app.json`), le plugin `expo-location` reçoit ce texte via `locationWhenInUsePermission`. N'activez pas `isIosBackgroundLocationEnabled`.

### Android
Permissions : `ACCESS_COARSE_LOCATION` et `ACCESS_FINE_LOCATION` seulement. **Pas de** `ACCESS_BACKGROUND_LOCATION` : la Play Console n'exige le formulaire de déclaration de localisation que pour l'accès en arrière-plan ([politique](https://support.google.com/googleplay/android-developer/answer/9799150)). Android n'affiche pas de texte personnalisé dans la boîte système, donc montrez cet écran explicatif juste avant de la demander :
```
Trouver la borne la plus proche
Branché utilise votre position uniquement sur votre téléphone pour calculer la borne la plus proche. Elle n'est jamais envoyée à nos serveurs. Vous pouvez refuser et déplacer la carte à la main.
[Autoriser]  [Plus tard]
```

---

## 2. Google Play — formulaire « Sécurité des données »

Définitions : « collecter » signifie transmettre une donnée hors de l'appareil ; une donnée traitée uniquement sur l'appareil n'est pas déclarée ; la localisation approximative correspond à une zone d'au moins 3 km² ([aide Play](https://support.google.com/googleplay/android-developer/answer/10787469)).

| Question | Réponse |
|---|---|
| L'app collecte ou partage-t-elle des données utilisateur des types requis ? | **Oui** (réponse prudente, voir la ligne localisation) |
| Toutes les données sont-elles chiffrées en transit ? | **Oui** (HTTPS) |
| Les utilisateurs peuvent-ils demander la suppression de leurs données ? | **Oui**, par e-mail à [EMAIL DE CONTACT] (pas de compte) |
| **Position > Position approximative** | **Collectée** (les tuiles de 0,25° demandées révèlent une zone d'environ 500 km²). Non partagée. Traitement éphémère : **Non** (journaux de l'hébergeur). Facultative (l'utilisateur peut refuser). Finalité : **Fonctionnalité de l'app**. |
| Position > Position précise | **Non collectée** (traitée uniquement sur l'appareil) |
| Infos financières / Infos de paiement | **Non collectées** en mode démo. Si Stripe est activé : la carte est saisie sur Stripe Checkout et l'app n'y a jamais accès, donc pas à déclarer ; mais l'**historique d'achats** devient « collecté » (Fonctionnalité de l'app). |
| Infos personnelles, identifiants appareil, contacts, photos, activité dans l'app, infos et performances de l'app | **Non collectés** |
| Partage avec des tiers | **Aucun** (GitHub, Render et OpenFreeMap sont des prestataires, ce qui n'est pas un « partage ») |
| Annonces | **Non** |

Option moins prudente : déclarer « aucune donnée collectée », en considérant que le numéro de tuile n'est pas une localisation de l'utilisateur. À faire valider ; en cas de doute, gardez la version prudente ci-dessus.

---

## 3. App Store — Confidentialité de l'app (« nutrition labels »)

Apple : une donnée traitée uniquement sur l'appareil n'est pas « collectée » ; la localisation approximative correspond à une précision inférieure à 3 décimales de latitude/longitude ; des données de paiement saisies hors de l'app, sans accès du développeur, ne sont pas collectées ([Apple](https://developer.apple.com/app-store/app-privacy-details/)).

| Rubrique | Réponse |
|---|---|
| Collectez-vous des données ? | **Oui** (réponse prudente) |
| **Localisation > Localisation approximative** | Usage : **Fonctionnalité de l'app**. Liée à l'identité : **Non**. Pistage : **Non**. |
| Localisation précise | Non collectée |
| Achats / Infos financières | Non collectés en mode démo. Avec Stripe réel : **Achats > Historique d'achats**, Fonctionnalité de l'app, non liée, pas de pistage. |
| Identifiants, contacts, diagnostics, données d'usage | Non collectés |
| Libellé résultant | « Données non liées à vous : Localisation » |

Autres points App Store :
- **Règle 2.2** : « Demos, betas, and trial versions […] don't belong on the App Store » ([guidelines](https://developer.apple.com/app-store/review/guidelines/)). Il y a un **risque de rejet** si le paiement démo est perçu comme une app inachevée. Présentez la carte réelle des bornes comme la fonction principale et la démo de paiement comme un aperçu clairement signalé, ou retirez-la du build App Store. Passez d'abord par TestFlight.
- **Règle 3.1.3(e)** : la recharge est un service consommé hors de l'app, donc **pas d'achat intégré Apple**. Stripe ou une carte bancaire sont autorisés.
- **DSA (UE)** : déclarer le statut « trader » ou « non-trader » dans App Store Connect. Si vous êtes trader, l'adresse, le téléphone et l'e-mail sont publiés. Même déclaration dans la Play Console.

---

## 4. Google Play — compte personnel récent

Pour un compte **personnel** créé après le 13 novembre 2023 ([aide Play](https://support.google.com/googleplay/android-developer/answer/14151465)) :
1. Lancez un **test fermé** avec **au moins 12 testeurs** inscrits **sans interruption pendant au moins 14 jours consécutifs** (si un testeur se désinscrit, son compteur repart à zéro).
2. Dans le tableau de bord, cliquez sur **« Demander l'accès à la production »** et répondez aux questions (sur le test, sur l'app, sur la préparation à la production).
3. La revue Google prend **en général 7 jours ou moins**. Si la demande est refusée (trop peu de testeurs ou testeurs peu actifs), prolongez le test.

Prévoyez au moins 3 semaines avant la mise en production. Recrutez 15 à 20 testeurs pour garder une marge, et demandez-leur d'ouvrir réellement l'app (Google regarde l'engagement). Un compte **organisation** (après création de la société, avec un numéro D-U-N-S) n'est pas soumis à cette règle.

---

## 5. Textes courts de fiche store

Description courte Play (80 caractères max) :
```
Toutes les bornes de recharge publiques de France, la plus proche en un geste.
```
Mention à mettre dans la description longue :
```
Données bornes : base nationale IRVE (data.gouv.fr, Licence Ouverte 2.0). Carte : OpenFreeMap, © contributeurs OpenStreetMap. Paiement dans l'app en mode démo : aucun débit, aucune borne réelle activée. Pour recharger, payez directement à la borne (CB, QR code ou site de l'opérateur), comme l'app vous l'indique.
```

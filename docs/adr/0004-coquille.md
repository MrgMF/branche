# ADR 0004 — Coquille d'app, réglages et langues

- Statut : accepté · 05/11/2026 · Auteur : équipe app & design

**Choix en une ligne** : bouton menu sur la carte ouvrant un panneau latéral (façon Waze), pas de barre d'onglets — la carte reste plein écran et le panneau du bas (bornes, itinéraire, guidage) garde toute sa hauteur, une barre d'onglets permanente l'écraserait et serait masquée pendant le guidage.

| Décision | Pourquoi | Conséquence / plus tard |
|---|---|---|
| `MenuButton` à gauche de la recherche, panneau `AppMenu` : Carte, Ma recharge (badge « En cours » / « Préparée »), Historique et dépenses, Mon véhicule, Mes comptes et badges, Réglages, À propos et mentions | Retour utilisateur « que la carte, je ne peux aller nulle part » ; un seul point d'entrée visible en permanence (point vert sur le bouton si recharge en cours) | Les 4 raccourcis du panneau du bas sont supprimés ; reste « Scanner » (action à la borne) |
| « Ma recharge » : suivi en cours → `/recharge` ; sinon `/ma-recharge` (préparée ou état vide avec « Trouver une borne » / « Scanner ») | Un geste quand une charge tourne, jamais d'écran vide sans action | — |
| `ScreenHeader` commun : bouton retour 48 px, titre `header`, Échap (web, écran au premier plan seulement), retour matériel Android si étape interne, geste iOS natif activé partout | Retour arrière cohérent sur tous les écrans | Plus de modales (`presentation: modal`) : même animation partout |
| Réglages persistés (`branche.settings.v1`) : langue (Automatique = appareil), voix (clé existante de `voice.ts`), péages/autoroutes par défaut (lus par `useTrip.plan`), unités km/mi (distances, voix, vitesse), revoir la présentation (par-dessus l'app), réinitialisation avec confirmation in-app | Demandes utilisateur | Thème sombre **omis** : les feuilles de style utilisent des couleurs statiques, le faire proprement demande de passer tous les écrans sur des tokens dynamiques |
| i18n maison `src/i18n` (≈ 600 clés, fonctions pour pluriels et variables), `fr` source, `en es de it pt nl` typés `Dict` ; `expo-localization` (natif) / `navigator.languages` (web), langue non prise en charge → anglais | Aucune grosse dépendance ; clé manquante = erreur TS ; test vitest (même forme, pas de valeur vide, pas de copie du français, pas de chaîne FR en dur dans `src/app` et `src/components`) | Textes juridiques en français seulement, note « la version française fait foi » traduite |
| Guidage : en français, consigne du fournisseur ; autres langues, consigne générée depuis la manœuvre (rue, sortie, direction) ; voix `expo-speech` dans la langue/région courante | Les fournisseurs renvoient du français ; pas de nouvelle dépendance serveur | Rues et directions restent en langue locale (normal) |

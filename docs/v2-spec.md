# Branché V2 — spécification (paiement de A à Z + navigation niveau Waze)

## Ce qui gêne les conducteurs (recherche du 05/11/2026)
1. Une appli et un compte (avec carte bancaire) par réseau, même pour une seule recharge ; déconnexions, mots de passe oubliés sur réseau faible ([Automobile Propre](https://www.automobile-propre.com/articles/bornes-de-recharge-il-est-temps-de-faire-plus-simple/)).
2. Procédures différentes partout (brancher avant / après, QR, badge, CB), lecteurs mal signalés, pré-autorisations inexpliquées, identifiants de borne/prise illisibles.
3. Prix inconnus avant de charger ; minutes, frais de session et pénalités d'occupation cachés.
4. Bornes en panne (4 conducteurs sur 10 en ont rencontré) et état invisible avant de se garer ([Which?](https://www.which.co.uk/news/article/major-flaws-in-charging-infrastructure-causing-headaches-for-electric-car-owners-aPxzp7j9dntf)) ; 8 sur 10 veulent payer par carte bancaire et une seule appli.
5. Paiement direct (ad hoc) peu intuitif là où il existe ; les applis sont utilisées par 77 % mais préférées par 17 % ([étude USCALE 2026](https://theevreport.com/ev-charging-payments-frustrate-drivers-study-finds)).

## Promesse V2
« Une seule appli, aucun compte : Branché me reconnaît à la borne, me dit combien je vais payer, me guide pas à pas, me fait payer l'opérateur en toute sécurité, suit ma charge et garde mon reçu. »

## Parcours paiement A → Z (sans contrat d'itinérance, sans compte)
1. **Détection** : à moins de 60 m d'une station (ou à l'arrivée du guidage), carte « Vous êtes à X » avec bouton unique « Recharger ici ». Scan QR possible à tout moment : l'identifiant de borne contenu dans le QR désigne la station et le point.
2. **Point de charge** : liste des points de la station (puissance, prise) avec les 4 derniers caractères de l'identifiant mis en évidence, comme sur l'étiquette ; filtrés par compatibilité du véhicule.
3. **Prix avant de payer** : tarif publié (IRVE, analysé : €/kWh, €/min, frais de session, pénalité d'occupation), prix constatés par la communauté (date), estimation pour MON véhicule (kWh nécessaires de X % à 80 %, durée réaliste selon la puissance du point ET du véhicule, coût total), pré-autorisation expliquée (« jusqu'à N € bloqués puis libérés »).
4. **Méthode recommandée**, classée automatiquement : (a) carte bancaire / sans contact sur le lecteur de la borne si disponible ; (b) page de paiement de l'opérateur via QR vérifié ; (c) lien opérateur connu ; (d) Carte Branché (bientôt, partenaire bancaire requis, présenté honnêtement). Chaque méthode a son mode d'emploi en 3 étapes adapté à la borne (brancher d'abord ou payer d'abord, quel lecteur, quel bouton).
5. **Paiement** : page de l'opérateur dans SFSafariViewController / Custom Tabs (anti-quishing de la V1.1), ou guidage CB au lecteur. Aucun compte Branché, aucun mot de passe.
6. **Démarrage détecté** : au retour dans l'app, confirmation en un geste (« La charge a démarré ») ; si non, aide au dépannage (autre point, autre méthode, appeler l'opérateur, signaler la panne).
7. **Suivi** : estimation en direct (kWh, coût, % batterie, heure de fin à 80 %), alerte avant pénalité d'occupation, notification locale de fin, état conservé même si l'app est fermée.
8. **Fin** : « Combien avez-vous payé ? » (montant facultatif, photo du ticket / reçu), « Ça a marché ? » (fiabilité communautaire), reçu dans l'historique.
9. **Historique & dépenses** : liste, total du mois, prix moyen au kWh, export CSV (note de frais), tout stocké sur l'appareil.

## Navigation niveau Waze
Recherche d'adresse (TomTom Search, repli Photon), trajet le plus rapide avec trafic + 2 alternatives affichées (écart de temps, péages), options éviter péages / autoroutes, tracé coloré selon le trafic, icônes de manœuvre (tourner, rond-point avec numéro de sortie, sortie d'autoroute, garder la voie), voies si fournies, nom de la rue suivante, vitesse actuelle + limitation si fournie (alerte dépassement), recalcul hors trajet ET recherche d'un trajet plus rapide toutes les 2 min pendant le guidage (bascule annoncée), perturbations et zones de danger annoncées, signalements en un geste, écran toujours allumé, voix coupable, partage de l'heure d'arrivée, arrivée → parcours de recharge. Spécificité VE : batterie estimée à l'arrivée, bornes rapides proposées sur le trajet si l'autonomie ne suffit pas.

## Contraintes inchangées
Pas d'API privée d'opérateur, pas de saisie de carte par Branché, pas de type « police », zones de danger seulement, clé TomTom côté serveur, aucun cache TomTom, données personnelles sur l'appareil.

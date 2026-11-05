# Note juridique V1.1 — Branché

> **Brouillon à faire valider par un avocat.** Agent juridique, 5 novembre 2026. Ce n'est pas un avis juridique validé.

## (a) Zones de danger autour des radars : licite si ce sont de vraies zones
- **Interdit** : avertir de la *localisation* des appareils de contrôle (art. R413-15 du code de la route, issu du décret n° 2012-3 du 3 janv. 2012). C'est une contravention de 5e classe : 1 500 € d'amende, retrait de 6 points, saisie de l'appareil ([CE 6 mars 2013, n° 355815](https://www.conseil-etat.fr/fr/arianeweb/CE/decision/2013-03-06/355815), [Legipermis](https://www.legipermis.com/infractions/detecteur-de-radar.html)). Le risque pèse sur **l'utilisateur**. Le texte vise le dispositif, pas l'éditeur, mais une app requalifiée en avertisseur est retirée de fait.
- **Protocole AFFTAC du 29 juillet 2011** : des « sections dangereuses » d'**au moins 4 km sur autoroute, 2 km hors agglomération et 300 m en agglomération**, sans aucune distinction entre radar fixe, radar mobile et contrôle ([Repaire des motards](https://www.lerepairedesmotards.com/actualites/2011/actu_110729-avertisseurs-radars-gueant-afftac-protocole-accord.php), [réponse ministérielle](https://www.assemblee-nationale.fr/dyn/13/questions/QANR5L13QE114284.pdf)). Le chiffre de **500 m en ville est celui de Coyote** ([Journal de l'Automobile](https://journalauto.com/services/licoyote-respecte-les-regles/)). Ces longueurs ne figurent dans aucun texte réglementaire et ne lient que les signataires. Nos **500 m de rayon** (soit jusqu'à 1 km traversé) respectent le minimum de 300 m.
- **Conditions pour Branché** :
  1. Ne jamais écrire « radar ».
  2. Une seule icône, sans le type de radar.
  3. Un **décalage du centre déterministe**, tiré une fois pour chaque radar. S'il était retiré à chaque build, la moyenne de plusieurs versions publiques redonnerait la position du radar.
     - Borner le décalage à **0,5 × rayon**. Sinon, le radar peut se trouver au bord de la zone : l'alerte d'entrée tomberait alors sur le radar, et la portion traversée passerait sous les minima du protocole.
     - Avec cette borne, la portion traversée mesure au moins 0,87 km, 3,5 km et 6,9 km.
  4. Une alerte à l'entrée de la zone et pendant toute sa traversée, jamais de compte à rebours ni de distance au radar.
  5. `danger-zones.json` dérive d'OSM : c'est une **base dérivée sous ODbL**, à publier sous ODbL avec la mention « © contributeurs OpenStreetMap » ([OSMF](https://osmfoundation.org/wiki/Community_Guidelines/Produced_Work_-_Guideline)).
- Le jeu « radars » de data.gouv (Licence Ouverte) a été publié par un particulier et n'est plus à jour depuis le 11/07/2024 ([data.gouv](https://www.data.gouv.fr/datasets/radars-automatiques/informations)). L'afficher comme une source non officielle.

## (b) Signalement des contrôles de police → **ne pas l'intégrer en V1.1**
- **Art. L130-11 (loi LOM) et décret n° 2021-468 du 19 avril 2021.** Pour les contrôles d'alcoolémie ou de stupéfiants et certains contrôles de sûreté, le préfet (ou le ministre) peut interdire à tout exploitant d'un service d'aide à la conduite par géolocalisation de **rediffuser les messages de ses utilisateurs**.
  - Durée : **2 h** au plus pour alcool et stupéfiants, **12 h** pour les autres contrôles.
  - Périmètre : rayon de **2 km en agglomération et 10 km hors agglomération**.
  - Les contrôles de vitesse sont exclus du dispositif.
  - L'interdiction est transmise par un système sécurisé, puis détruite à son terme.
  - Sanction (art. L130-12) : **2 ans d'emprisonnement et 30 000 €** ([Conseil constitutionnel, 2021-948 QPC](https://webview-ccfr.sites.prod.conseilconstitutionnel.aquaray.com/sites/default/files/2021-11/2021948qpc_cp.pdf), [Weblex](https://www.weblex.fr/weblex-actualite/controles-routiers-nouvelle-obligation-pour-les-services-de-navigation-gps), [Automobile Club](https://www.automobile-club.org/actualites/l-auto-et-la-loi/gps-interdiction-de-signaler-un-controle-routier?pdf=1)).
- **Messages de sécurité** (obstacle, accident, travaux, chaussée glissante, météo) : ils restent diffusables **partout**, depuis la censure partielle du Conseil constitutionnel.
- **État du dispositif** : il n'était pas opérationnel en juillet 2023 ([AN, QE 5433](https://www.assemblee-nationale.fr/dyn/16/questions/QANR5L16QE5433.pdf)). Le Conseil d'État a sursis à statuer ([n° 453763](https://www.conseil-etat.fr/fr/arianeweb/CE/decision/2024-03-06/453763)), puis la **CJUE a validé le principe le 16 juin 2026** (aff. C-190/24, [Curia](https://curia.europa.eu/site/jcms/p1_1000084528/fr/arret-recent-c-188/24-webgroup-czech-republic-et-nkl-associates-et-c-190/24-coyote-system), [La Libre](https://www.lalibre.be/dernieres-depeches/2026/06/16/revers-pour-coyote-qui-veut-empecher-la-france-dinterdire-le-signalement-des-controles-2MGKVKATUNCUXN4UV6VFPORFNI/)).
- **Recommandation** : pas de type « contrôle ».
  - Risque pénal pour l'exploitant.
  - Raccordement à un système d'État qui n'est pas encore livré.
  - Un signalement de contrôle de vitesse ferait de l'app un avertisseur (R413-15).
  - Aucun lien avec la recharge.
- **À prévoir dès maintenant** : un **interrupteur serveur par périmètre et par durée** pour couper la rediffusion des signalements « bouchon » et « borne HS ».
- **Modération** : un texte libre pourrait servir à signaler un contrôle, d'où des types fermés, sans texte libre.

## (c) Connecteur QR « Scanner et payer » et « Lien opérateur »
- **DSP2** : Branché n'entre jamais en possession des fonds et n'initie aucun paiement. Ouvrir une URL n'est pas un service de paiement. Au pire, c'est l'exclusion des prestataires techniques (art. 3 j) de la directive 2015/2366, [texte](https://www.legislation.gov.uk/cy/eudr/2015/2366/article/3/data.htm)). **Pas d'agrément** tant qu'aucun flux ne transite par Branché ni aucune commission sur les paiements. Une commission versée par un CPO serait à requalifier avec un avocat.
- **Navigateur intégré** : utiliser **SFSafariViewController** (iOS) et **Custom Tabs** (Android), jamais une WebView injectable. Apple confirme que l'app ne voit ni les interactions ni les données saisies ([Apple](https://developer.apple.com/documentation/safariservices/sfsafariviewcontroller)). C'est la condition pour pouvoir écrire « Branché ne voit pas votre carte ».
- **Responsabilité** : le verdict « officiel » est une affirmation de Branché. Une erreur peut engager sa responsabilité civile, voire relever d'une pratique trompeuse. Le domaine est déduit de l'IRVE, qui est déclarative.
  - Libellé : « domaine de l'opérateur selon la base IRVE », et non « garanti ».
  - Toujours afficher le domaine en clair.
  - Proposer « Signaler un faux QR ».
- **Devoir d'information sur le quishing** : il est réel et documenté. Un faux QR menant à un domaine en `.site` au lieu de `.com` a été démantelé à Lyon en août 2026 ([Roole](https://media.roole.fr/quotidien/au-volant/bornes-de-recharge-attention-aux-faux-qr-codes-un-suspect-arrete-a-lyon), [ESET](https://www.welivesecurity.com/fr/fraude/vehicules-electriques-attention-aux-faux-qr-codes-sur-les-bornes-de-recharge/)). Mentions à afficher :
  - QR imprimé ou autocollant ;
  - domaine affiché ;
  - ne jamais saisir d'identifiants bancaires ;
  - en cas de doute, prévenir sa banque, l'opérateur, puis signaler la fraude sur [Perceval](https://www.masecurite.interieur.gouv.fr/media/344/download/Flyer%20Perceval.pdf?inline=1).
- **AFIR** : l'affichage des prix incombe à l'opérateur sur sa page ad hoc. Branché n'est pas prestataire de mobilité pour ces connecteurs.

## (d) « Carte Branché » (carte virtuelle via un partenaire BaaS)
- **Statut** : distribuer la carte d'un établissement de monnaie électronique (EME) suppose d'être **distributeur de monnaie électronique** (art. L525-8 CMF) ou **agent de PSP** (L523-1).
  - Branché doit être déclaré à l'ACPR et inscrit au REGAFI.
  - Le mandant reste responsable de Branché.
  - Branché doit appliquer les procédures LCB-FT du mandant.
  - Exercer sans inscription expose à **3 ans et 375 000 €** (L572-5) ([Swim Legal](https://www.swim.legal/blog/agent-prestataire-services-paiement)).
  - Il faut une **société immatriculée** : impossible en tant que personne physique non professionnelle.
- **Partenaires possibles** :
  - **Swan** : EME agréé par l'ACPR, couvre l'EEE. Les comptes de particuliers ne sont ouverts en production que pour les projets approuvés, avec un KYC **PVID** en France. Apple Pay et Google Pay en *in-app provisioning* demandent une certification et l'accord de Swan ([FAQ](https://swan.io/faq), [onboarding](https://docs.swan.io/topics/onboarding/individual), [cartes](https://docs.swan.io/topics/cards/digital/)).
  - **Treezor** : EME agréé par l'ACPR, cartes virtuelles pour particuliers, compatibles Apple Pay et Google Pay ([Treezor](https://www.treezor.com/insights/knowledge-center/virtual-card-solution-issuance-payment/)).
  - **Stripe Issuing** : **exclu**. Il est disponible en France, mais seulement pour un usage commercial. L'usage grand public et les cartes alimentées par des fonds personnels sont interdits ([Stripe](https://support.stripe.com/questions/supported-business-use-cases-for-stripe-issuing)). Dans l'UE, l'ajout aux wallets demande en plus l'accord de l'équipe partenariats et l'*entitlement* Apple ([Stripe](https://docs.stripe.com/issuing/cards/digital-wallets.md?platform=ios)).
- **Refacturation et frais de service** :
  - L'utilisateur titulaire paie le CPO avec sa monnaie électronique : rien à refacturer. Des frais de programme sont possibles s'ils figurent dans le contrat-cadre et sont annoncés avant l'engagement.
  - Une carte alimentée par Branché, avec refacturation, fait de Branché un **revendeur de recharge**. Il faut alors des CGV, l'affichage des prix AFIR et une marge intégrée au prix.
  - Un « supplément CB » est interdit (art. L112-12 CMF, [texte](https://french-business-law.com/rench-legislation-art/article-l112-12-of-the-french-monetary-and-financial-code)).
  - **Montage à faire trancher par un avocat.**

## (e) Itinéraire : TomTom et Valhalla
- **TomTom** :
  - L'offre gratuite autorise l'usage commercial selon des sources secondaires qui citent la page tarifs. La page officielle affiche aujourd'hui **20 000 requêtes Routing gratuites par mois**, sans carte bancaire ([TomTom](https://docs.tomtom.com/pricing), [APIbenchmarks](https://apibenchmarks.com/maps/tomtom)).
  - Afficher le résultat sur un fond non-TomTom est admis ([Geocodio](https://www.geocod.io/compare-geocoding-services/geocodio-vs-tomtom)).
  - Contraintes :
    - **pas de stockage** ;
    - cache limité aux en-têtes de réponse ;
    - **aucun cache pour servir plusieurs utilisateurs** ;
    - mention **« © TomTom »** à afficher sans la retirer ;
    - pas de base concurrente ;
    - aucun usage pour placer des radars ([apio](https://apio.sh/apis/tomtom-routing)).
  - Les CGU primaires ne s'affichent qu'en JavaScript et n'ont pas pu être lues : **relire [docs.tomtom.com/legal](https://docs.tomtom.com/legal/terms-and-conditions) avant la mise en production.**
  - TomTom agit en **sous-traitant RGPD** (Data Processing Schedule) : IP et requêtes géolocalisées, sous-traitants AWS, Azure et Scalyr dans l'UE, information des personnes à la charge de Branché ([TomTom](https://www.tomtom.com/legal/third-party-product-terms/data-processing-schedule)).
  - **Aucune condition bloquante identifiée.** Ne pas mettre `/v1/route` en cache partagé.
- **Valhalla public (FOSSGIS)** : réservé à des usages raisonnables et **non commerciaux**, environ 1 requête par seconde et par utilisateur, **inadapté à un service en production** selon les mainteneurs ([OSRM wiki](https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server), [discussion #3373](https://github.com/valhalla/valhalla/discussions/3373)). **Bloquant pour le repli en production.** Solutions : auto-héberger Valhalla ou passer par Stadia. Envoyer un en-tête `User-Agent` ou `X-Client-Id` identifiable.
- **Écart de confidentialité à corriger** : `GET /v1/route?from=lat,lon…` place les coordonnées dans l'URL. Fastify (niveau `info`) et Render conservent ces URL **7 jours**.
  - Passer en `POST` ou masquer l'URL dans les logs.
  - Mettre à jour la permission de localisation dans `app.config.ts` et `about.tsx`, dont la mention « jamais envoyée » devient fausse.

## (f) Bison Futé (DATEX II)
- Jeu « Événements routiers sur le RRN non concédé » : **Licence Ouverte 2.0**, produit par les DIR et publié par le PAN transport.data.gouv.fr ([data.gouv](https://www.data.gouv.fr/datasets/62558686864eeafd3af07eac)).
- Mention à afficher : « Bison Futé / DIR — transport.data.gouv.fr, Licence Ouverte 2.0, mis à jour le {date} », sans suggérer d'aval officiel.
- **Règlement délégué 886/2013** : un prestataire qui diffuse des informations de sécurité routière envoie chaque année une **déclaration de conformité à l'AFIMB avant le 1er octobre** ([Bison Futé](https://www.bison-fute.gouv.fr/imprimer,article10590.html)). Il doit aussi, s'il collecte lui-même des données (nos signalements), les partager via le PAN (art. 7, [texte](https://www.legislation.gov.uk/eur/2013/886/data.html)). **Applicabilité à vérifier.**

## Signalements communautaires (rappel)
- Ce sont des contenus hébergés au sens du DSA : mécanisme de notification (art. 16) et motivation des retraits (art. 17), même pour une micro-entreprise ([art. 16](https://www.springlex.eu/fr/packages/dsa/dsa-regulation/article-16/)).
- Types fermés, TTL, aucun identifiant ni IP conservés avec le signalement.
- L'IP sert à la limitation de débit uniquement en mémoire, sous forme hachée, pendant 1 h.

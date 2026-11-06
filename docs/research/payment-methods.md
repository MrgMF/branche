# Moyens de paiement par opérateur (vérifié le 2026-11-06)

Données : champ `payMethods` de chaque entrée de `pipeline/data/operator-portals.json`, avec ses URL dans `payMethods.sources`. Branché n'encaisse rien. L'utilisateur paie de deux façons :

- sur la page de paiement ponctuel de l'opérateur, ouverte dans SFSafariViewController (iPhone) ou dans Chrome Custom Tabs (Android) ;
- au lecteur CB de la borne.

**Règle** : `true` ou `false` seulement si une source le dit. Sinon `null` (« — » dans le tableau). `nfcWallets: "probable"` signifie que l'opérateur confirme un lecteur CB **sans contact**, sans citer Apple Pay ni Google Pay. `nfcWallets: true` exige une source de l'opérateur.

## Couverture (registre `site/data/operators.json`, 53 591 stations)

| Mesure | Stations | Part |
|---|---|---|
| Page ad hoc : carte bancaire confirmée | 29 575 | 55,2 % |
| **Page ad hoc : Apple Pay confirmé** | **307** (Road/E-Flux) | **0,6 %** |
| **Page ad hoc : Google Pay confirmé** | **307** (Road/E-Flux) | **0,6 %** |
| **Page ad hoc : PayPal confirmé** | **0** | **0 %** |
| Lecteur : sans contact confirmé | 12 996 | 24,3 % |
| Lecteur : Apple Pay / Google Pay (NFC) confirmés par l'opérateur | 2 042 (SPIE, Allego, IONITY, Tesla, Fastned) | 3,8 % |
| Lecteur : portefeuilles NFC « probable » | 10 954 | 20,4 % |
| Apple Pay confirmé, page ou lecteur | 2 349 | 4,4 % |

Aucun opérateur ne cite de moyen « autre » (Bancontact, Lydia, PayPal…). Partout, la page ad hoc est décrite comme « carte bancaire » sans liste de réseaux. Les seuls réseaux cités le sont pour la page IONITY (Visa, Mastercard, Amex) et pour E-Flux (Visa, Mastercard).

## Tableau (opérateurs triés par stations)

| Opérateur | Stations | CB page | Apple Pay page | Google Pay page | PayPal page | Lecteur sans contact | Portefeuilles NFC |
|---|---|---|---|---|---|---|---|
| IZIVIA | 7208 | oui | — | — | — | — | — |
| Bouygues E&S (alizé, Révéo…) | 5863 | oui | — | — | — | oui | probable |
| Freshmile | 3384 | oui | — | — | — | — | — |
| 50five | 2250 | — | — | — | — | — | — |
| Easy Charge (eborn) | 2048 | oui | — | — | — | oui | probable |
| Citeos (MObiVE) | 1693 | oui | — | — | — | — | — |
| Modulo | 1615 | — | — | — | — | — | — |
| Power Dot | 1189 | — | — | — | — | — | — |
| Lidl France | 1073 | non | non | non | non | non | non |
| EVzen | 1014 | oui | — | — | — | — | — |
| TotalEnergies | 962 | oui | — | — | — | — | — |
| Qovoltis | 888 | — | — | — | — | oui | probable |
| Virta | 871 | oui | — | — | — | — | — |
| ALDI | 805 | — | — | — | — | — | — |
| SPIE CityNetworks (Métropolis…) | 785 | oui | — | — | — | oui | **oui** |
| Driveco (partenaires) | 778 | oui | — | — | — | — | — |
| e-Totem | 686 | — | — | — | — | — | — |
| Electric 55 Charging | 673 | oui | — | — | — | — | — |
| ENGIE Vianeo | 632 | oui | — | — | — | oui | probable |
| Allego | 603 | — | — | — | — | oui | **oui** |
| Stations-e | 567 | oui | — | — | — | oui | probable |
| Electra | 534 | — | — | — | — | oui | probable |
| Révéo (SYADEN) | 526 | oui | — | — | — | — | — |
| Driveco | 484 | oui | — | — | — | — | — |
| E.Leclerc, Morbihan, Aube, Somme (Freshmile) | 1117 | oui | — | — | — | — | — |
| TotalEnergies Charging Services | 363 | oui | — | — | — | — | — |
| Road (E-Flux) | 307 | oui | **oui** | **oui** | — | oui | probable |
| IONITY | 300 | oui | — | — | — | oui | **oui** |
| Tesla Superchargeurs | 288 | — | — | — | — | oui | **oui** |
| Zunder | 115 | — | — | — | — | oui | probable |
| Fastned | 66 | — | — | — | — | oui | **oui** |

MObiVE (entrée sans stations propres) reprend les valeurs de Citeos. Les 25 autres entrées sont toutes à `null` : Ze-Watt, Load Stations, Electro-Mob, Sorégies (×2), ChargeGuru, Qwello, Mobilize, YES55, Zephyre, WAAT, ZEborne, Indigo, Seolis, IECharge, Greenspot, Atlante, Shell, Electromaps, Carrefour Energies et les eMSP. Leurs sources ne nomment aucun moyen, ou seulement « carte bancaire » au terminal, sans parler de sans contact.

## Réserves

- **IONITY** : la FAQ ad hoc liste Apple Pay et Google Pay. Une autre page précise qu'ils passent par les **terminaux NFC** de certaines stations. On ne les compte donc pas sur payment.ionity.eu. American Express est accepté sur la page web dans tous les pays, mais au terminal seulement en Allemagne et au Royaume-Uni.
- **Virta (chge.eu)** : Apple Pay et Google Pay existent sur la page web, mais **chaque opérateur doit les activer** auprès de son prestataire de paiement. On laisse donc `null`.
- **Electra** : Apple Pay et Google Pay sont proposés **dans l'appli Electra** seulement, pas sur une page web.
- **Tesla** : certaines stations acceptent « les principales cartes bancaires ou un service de paiement mobile ». Tesla précise qu'il ne demande jamais de payer par QR code : il n'y a pas de page ad hoc.
- **Lidl** : selon les CGU du 30/10/2024, le paiement se fait « uniquement par carte bancaire via Lidl Pay » (appli). Il n'y a ni page ad hoc ni lecteur. Données à revérifier, car l'AFIR impose le paiement ad hoc sur les nouvelles bornes.
- **Road (E-Flux)** : sur les bornes DC, le terminal accepte Visa, Mastercard, Maestro et Girocard. Les bornes AC n'ont pas de terminal. Au-delà de 50 € en sans contact, la session s'arrête automatiquement.
- **Réseaux Freshmile** (Leclerc, Morbihan, Aube, Somme) : on reprend le parcours invité Freshmile (autorisation CB), sans vérification réseau par réseau.
- Les pages de paiement sont des SPA. Le proxy de recherche bloque l'accès direct, donc on n'a pas pu inspecter les moyens affichés. Un test réel à la borne permettra de vérifier Apple Pay et Google Pay sur PayNow, alizé, Freshmile et Vianeo.

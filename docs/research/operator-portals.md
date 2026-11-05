# Portails web des opérateurs de recharge (vérifié le 2026-11-05)

Source de données : `pipeline/data/operator-portals.json` (v1). On n'a rien inventé : une valeur sans source officielle (ou forum, signalé) reste `null`/`unknown`. Chaque entrée liste ses URL sources ; `notes` donne les réserves.

## Couverture (registre `site/data/operators.json`, 260 opérateurs, 53 591 stations)

| Mesure | Stations | Part |
|---|---|---|
| Opérateurs étudiés (54 clés du registre) | 46 562 | 86,9 % |
| **webStart = yes ou adhocWeb confirmé** | **26 865** | **50,1 %** |
| + réseaux hébergés chez Freshmile probables (Leclerc, Morbihan, Aube, Somme, non vérifiés un par un) | 27 982 | 52,2 % |

Les opérateurs confirmés sont IZIVIA (PayNow), Bouygues E&S (alizé/Révéo), Freshmile, Easy Charge/eborn, EVzen, TotalEnergies (×2), Virta (chge.eu), SPIE/Métropolis, Driveco (×2), E55C, ENGIE Vianeo, Stations-e, Révéo SYADEN, Qwello et IONITY. Carrefour Energies (recharge.carrefour.fr) est confirmé lui aussi, mais il n'a pas de clé propre dans le registre : ses stations sont comptées chez Allego et Driveco.

## Points clés pour l'intégration (navigateur intégré)

- Les opérateurs ne publient **aucun gabarit d'URL avec `{evse}`**. Le web s'ouvre de trois façons :
  - par **QR code** sur la borne ;
  - par un **code autocollant**, par exemple Freshmile `xfm.fr/{code}` ou IZIVIA `MAT00123` → `00123` ;
  - par une **saisie manuelle de l'ID**, comme chez Virta (chge.eu) ou IONITY (payment.ionity.eu).

  Branché peut ouvrir la page d'accueil du flux web et laisser l'utilisateur choisir la borne.
- Pour la plupart des pages ad hoc, on ne connaît pas le domaine (« page de paiement sécurisée » non nommée). Il faut ouvrir uniquement les URL officielles listées ici, car les arnaques au QR code sont signalées par IZIVIA, Carrefour et Beev.
- Portails de compte web confirmés : IZIVIA, alizé/Révéo, Freshmile, EVzen, Métropolis, eborn (ID Charge), MObiVE, evc-net (Sorégies, AlterBase, Greenspot), Zunder, Bip&Go, Ulys, Plugsurfing et Electromaps.
  - Le portail **Plugsurfing** renvoie explicitement vers l'appli pour démarrer une charge.
  - Le portail **Modulo** a été fermé.

## Opérateurs app-only / badge-only (confirmés)

Lidl (Lidl Plus, 1 073 stations), Sorégies Mobilités + Sorégies (754), YES55 (applis tierces + badges, 395) et Seolis/AlterBase (331). e-Totem se démarre au badge ou à la CB (bornes rapides), sans flux web.

Plusieurs gros réseaux restent **inconnus** :
- **sans source exploitable** : 50five (2 250), Citeos hors MObiVE (1 693), Modulo (1 615), Power Dot (1 189, site bloqué aux robots), ALDI (805), Ze-Watt (669), Load Stations (631) ;
- **seulement CB/appli/badge documentés, flux web non vérifié** : Electra et Tesla. Les non-Tesla passent par l'appli Tesla sur les V2/V3 et par une CB sur les V4 ou les sites équipés.

## Tableau

| Opérateur | Clé | Stations | Portail web | webStart | adhocWeb | Lecteur CB | App-only |
|---|---|---|---|---|---|---|---|
| IZIVIA | `izivia` | 7208 | oui | yes | oui | — | non |
| Bouygues E&S (alizé, Révéo, Ouest Charge…) | `bouygues-energies-services` | 5863 | oui | yes | oui | — | non |
| Freshmile | `freshmile` | 3384 | oui | yes | oui | — | non |
| 50five | `50five` | 2250 | — | unknown | — | — | — |
| Easy Charge (eborn, AVIA Volt) | `easycharge` | 2048 | oui | yes | oui | oui | non |
| Citeos (dont MObiVE) | `citeos-mobilite-electrique-paris` | 1693 | oui | unknown | — | — | — |
| Modulo | `modulo` | 1615 | — | unknown | — | — | — |
| Power Dot | `power-dot` | 1189 | — | unknown | — | — | — |
| Lidl France | `lidl` | 1073 | — | no | — | — | oui |
| EVzen (larecharge, WiiiZ…) | `evzen` | 1014 | oui | yes | oui | oui | non |
| TotalEnergies (Belib’, stations TotalEnergies) | `totalenergies-marketing` | 962 | — | yes | oui | oui | non |
| Qovoltis | `qovoltis` | 888 | — | unknown | — | oui | non |
| Virta | `virta` | 871 | — | yes | oui | — | non |
| ALDI | `aldi` | 805 | — | unknown | — | — | — |
| SPIE CityNetworks (Métropolis, Oscéa 64, e-Vadea…) | `spie-citynetworks` | 785 | oui | yes | oui | oui | non |
| Driveco (réseau partenaires) | `driveco-partner-network` | 778 | — | yes | oui | oui | non |
| e-Totem | `e-totem` | 686 | — | no | — | oui | non |
| Electric 55 Charging | `electric-55-charging` | 673 | — | yes | oui | — | non |
| Ze-Watt | `ze-watt` | 669 | — | unknown | — | — | — |
| ENGIE Vianeo | `engie-vianeo` | 632 | — | yes | oui | oui | non |
| Load Stations | `load-stations` | 631 | — | unknown | — | — | — |
| Allego (dont Carrefour Energies by Allego) | `allego` | 603 | — | unknown | — | oui | non |
| Electro-Mob | `electro-mob` | 571 | — | unknown | — | — | — |
| Stations-e | `stations-e` | 567 | — | yes | oui | oui | non |
| Electra | `electra` | 534 | — | unknown | — | oui | non |
| Révéo (SYADEN) | `reveo-syaden` | 526 | oui | yes | oui | — | non |
| Sorégies Mobilités | `soregies-mobilites` | 508 | oui | no | — | — | oui |
| ChargeGuru / ChargePoint | `chargepoint-austria` | 489 | — | unknown | — | — | — |
| Driveco | `driveco` | 484 | — | yes | oui | oui | non |
| E.Leclerc (Freshmile) | `e-leclerc` | 424 | — | unknown | — | — | — |
| Qwello France | `qwello` | 407 | — | yes | oui | — | non |
| Mobilize Power Solutions | `mobilize-power-solutions` | 403 | — | unknown | — | — | — |
| YES55 | `yes55` | 395 | — | no | — | — | oui |
| Zephyre | `zephyre` | 368 | — | unknown | — | — | — |
| TotalEnergies Charging Services | `totalenergies-charging-services` | 363 | — | yes | oui | — | non |
| WAAT | `waat` | 341 | — | unknown | — | — | — |
| ZEborne | `zeborne` | 336 | — | unknown | — | — | — |
| Groupe Indigo | `groupe-indigo` | 332 | — | unknown | — | — | — |
| Seolis (AlterBase) | `seolis` | 331 | oui | no | — | — | oui |
| IECharge | `nw-iecharge` | 314 | — | unknown | — | oui | non |
| Road (E-Flux) | `road` | 307 | — | unknown | — | — | — |
| IONITY | `ionity` | 300 | oui | yes | oui | oui | non |
| Tesla Superchargeurs | `tesla` | 288 | — | unknown | — | oui | non |
| Greenspot | `greenspot` | 282 | oui | unknown | — | — | — |
| Morbihan Énergies (Freshmile) | `morbihan-energies` | 257 | — | unknown | — | — | — |
| Sorégies | `soregies` | 246 | oui | no | — | — | oui |
| SDEA Aube (Freshmile) | `syndicat-departemental-energie-aube` | 233 | — | unknown | — | — | — |
| FDE Somme (Freshmile) | `federation-departementale-d-energie-de-la-somme` | 203 | — | unknown | — | — | — |
| Atlante | `atlante` | 190 | — | unknown | — | oui | non |
| Zunder | `zunder` | 115 | oui | unknown | — | oui | non |
| Fastned | `fastned` | 66 | — | unknown | — | oui | non |
| Shell Recharge | `shell-recharge` | 33 | — | unknown | — | — | — |
| Electromaps | `electromaps` | 29 | oui | unknown | — | — | — |
| Carrefour Energies | `carrefour-energies` | hors registre | oui | yes | oui | — | non |
| MObiVE (Citeos) | `mobive` | hors registre | oui | unknown | oui | oui | non |
| Chargemap Pass | `chargemap-pass` | hors registre | — | no | — | — | — |
| Bip&Go | `bip-and-go` | hors registre | oui | no | — | — | — |
| Ulys (VINCI Autoroutes) | `ulys` | hors registre | oui | unknown | — | — | — |
| Plugsurfing | `plugsurfing` | hors registre | oui | no | — | — | — |
| Beev | `beev` | hors registre | — | unknown | — | — | — |

« — » = non confirmé par une source.

## Pages non lisibles (à revérifier manuellement)

powerdot.fr (robots), evzen.com/guide, modulo/qovoltis/50five (homepages), mobility.totalenergies.com, indigoneo.fr, renault.fr Plug Inn Fast Charge, aide WAAT, load-stations.com, go-electra.com/newsroom, allego.eu/fr-fr, aide Shell (redirigée), chargemap.com blog.

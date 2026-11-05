# Note de conformité V1 — Branché

> **Brouillon à faire valider par un avocat.** Rédigé par l'agent juridique le 5 novembre 2026 ; rien ici n'est un avis juridique validé.

## Conforme en V1 (sous réserve de compléter les placeholders)
- **LCEN** : mentions légales publiées (`apps/web/legal/mentions-legales.html`), base : art. 1-1 LCEN depuis la loi SREN de 2024 ; défaut sanctionné d'1 an et 75 000 € (art. 1-2). Un éditeur **non professionnel** peut rester anonyme en ne publiant que les coordonnées de l'hébergeur (art. 1-1, II), à condition d'avoir donné son identité à l'hébergeur ; ce régime tombe dès qu'il y a une activité économique ([Simonnet Avocat](https://www.simonnetavocat.fr/mentions-legales-dun-site-internet-obligations-sanctions-et-modele/)). Branché vise une activité commerciale : **publier l'identité complète**.
- **RGPD / ePrivacy** : position traitée sur l'appareil (tuiles 0,25°) ⇒ pas de collecte serveur ; aucun traceur ⇒ pas de bandeau cookies ([CNIL](https://www.cnil.fr/fr/cookies-comment-mettre-mon-site-web-en-conformite)). Logs Render conservés 7 j sur l'offre Hobby ([Render](https://render.com/docs/logging)). Transferts US : GitHub, Render, Stripe déclarent le DPF + CCT ([GitHub](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement), [Render](https://render.com/privacy), [Stripe](https://stripe.com/fr/privacy)) ; DPF validé par le Tribunal de l'UE (aff. T-553/23, 3 sept. 2025), pourvoi possible ([Club des juristes](https://www.leclubdesjuristes.com/societe/numerique/le-tribunal-de-lunion-europeenne-valide-le-data-privacy-framework-12069/)).
- **Mode démo** : aucun débit, aucune borne réelle ⇒ pas de service de paiement ni de vente d'électricité. Annoncé dans les CGU et par un bandeau permanent.

## Ce qui bloque le paiement réel
1. **Statut d'opérateur de mobilité (eMSP)** au sens du décret n° 2017-26 ([Légifrance](https://www.legifrance.gouv.fr/jorf/id/JORFSCTA000033860627)) : il faut un contrat avec chaque opérateur de bornes (CPO), soit en direct, soit via une plateforme d'itinérance (**Gireve**, protocole OCPI ([Gireve](https://www.gireve.com/gireve-connects-easytrip-to-its-platform-with-ocpi/))), soit en **marque blanche** chez un eMSP existant. Il faut aussi un identifiant eMSP (AFIREV en France).
2. **DSP2 (paiements)** : encaisser l'argent de l'utilisateur pour le reverser à un CPO, c'est un service de paiement. Il faut alors un agrément ACPR, le statut d'agent d'un établissement agréé, ou une exemption démontrée. L'ACPR interprète restrictivement l'exclusion « agent commercial » pour les plateformes qui agissent pour les deux parties ([ACPR](https://acpr.banque-france.fr/system/files/import/acpr/medias/documents/sb-21-1.pdf)). Option probable : Branché **revend la recharge en son nom** (achat au CPO, revente à l'utilisateur, Stripe en marchand) ou passe par un eMSP en marque blanche. **À trancher par un avocat.**
3. **Stripe Checkout en pré-autorisation** : techniquement prêt, mais il faut une entité immatriculée, des CGV de vente (droit de la consommation : prix TTC, facture, et absence de rétractation à justifier pour un service pleinement exécuté), un médiateur de la consommation ([economie.gouv.fr](https://www.economie.gouv.fr/mediation-conso/vous-etes-un-professionnel/vos-principales-obligations)), et une politique de confidentialité mise à jour.
4. **Hébergement** : GitHub Pages interdit de l'utiliser pour « faire tourner une activité en ligne » ([GitHub](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)) ⇒ migrer le site avant toute monétisation.

## AFIR — règlement (UE) 2023/1804 ([EUR-Lex](https://eur-lex.europa.eu/eli/reg/2023/1804/oj/eng))
- Art. 5 : recharge **ad hoc sans contrat** obligatoire pour les bornes publiques déployées depuis le 13/04/2024 ; lecteur CB/sans contact obligatoire à ≥ 50 kW (QR seul admis < 50 kW) ; mise à niveau des bornes ≥ 50 kW existantes sur le RTE-T avant le 01/01/2027 ([Plugchoice](https://plugchoice.com/en/news/afir-explained-data-and-payment-rules-for-public-charging)). Cela justifie le renvoi vers le paiement direct à la borne.
- Art. 5 : les **prestataires de services de mobilité** doivent afficher **tous les prix applicables avant la session**, en distinguant chaque composante ([BDEW](https://www.bdew.de/media/documents/AFIR_Interpretation_Paper_BDEW_EN.pdf)). C'est une obligation pour Branché dès le paiement réel.
- Art. 20 : données statiques et dynamiques (disponibilité, prix ad hoc) disponibles gratuitement via les points d'accès nationaux. C'est une source future pour la disponibilité en temps réel (transport.data.gouv.fr).

## Licences (attribution à afficher dans l'app et sur le site)
- **IRVE — Licence Ouverte 2.0** : citer la source (au minimum le nom du producteur, avec un lien) et la **date de dernière mise à jour**, sans suggérer d'aval officiel ([data.gouv.fr](https://www.data.gouv.fr/pages/legal/licences/etalab-2-0)). La date doit venir de `data/meta.json`. Le fichier consolidé historique sera supprimé le 31/12/2026, au profit de la version de transport.data.gouv.fr : **vérifier l'URL du pipeline**.
- **OpenStreetMap — ODbL** : « © contributeurs OpenStreetMap », avec un lien vers openstreetmap.org/copyright, visible en coin de carte ou accessible par un bouton (i) ([OSMF](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines)).
- **OpenFreeMap** : pas d'attribution exigée par ses CGU, mais le crédit d'usage est « OpenFreeMap © OpenMapTiles Data from OpenStreetMap » ; service fourni sans garantie ([quick start](https://openfreemap.org/quick_start/), [ToS](https://openfreemap.org/tos/)). MapLibre : BSD-3-Clause, à créditer dans « Licences ».

## À faire valider par un avocat
1. Montage du paiement réel : revente, agent ou marque blanche, et exposition DSP2/ACPR.
2. Contrats CPO / Gireve / eMSP : responsabilité en cas de panne, reversements, prix AFIR.
3. CGV de recharge : droit de rétractation, pré-autorisation de 50 €, litiges, médiateur.
4. Choix de publier l'identité de l'éditeur (anonymat LCEN ou non) avant la création de la société.
5. Durées de conservation [X] et registre des traitements (art. 30 RGPD).
6. Statut « trader » DSA dans App Store Connect et Play Console (particulier ou professionnel).

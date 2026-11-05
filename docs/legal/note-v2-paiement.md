# Note juridique V2 — parcours de recharge sans compte (brouillon, à valider par un avocat)

Brouillon de l'équipe « dev paiement » à relire par l'agent `juridique` puis par un avocat. Rien ici n'est validé.

## Données nouvelles
| Traitement | Données | Où | Base / remarque |
|---|---|---|---|
| Historique des recharges, véhicule, recharge en cours | borne, durée, kWh, montant saisi, modèle, % batterie | **sur l'appareil uniquement** (AsyncStorage) | Pas de traitement par Branché (données jamais envoyées). Suppression par l'utilisateur dans « Mes recharges ». |
| Retour « Ça a marché ? » (facultatif) | identifiant de station, oui/non, montant payé, kWh, pré-autorisation (facultatifs) | API Branché, **mémoire, 90 jours max** | Aucune IP ni identifiant stocké ; empreinte salée anti-doublon gardée 6 h. Statistiques publiées au jour près. Données a priori anonymes : [À VÉRIFIER : caractère anonyme au sens du RGPD, risque de ré-identification sur bornes peu fréquentées]. |
| Signalement « borne hors service » | type, position de la borne | API Branché, 24 h | Régime existant de `/v1/reports`. |
| **Reconnaissance du véhicule sur photo** (facultative) | photo prise par l'utilisateur, réduite (≤ 1,5 Mo) | transmise par l'API Branché à **Anthropic PBC (sous-traitant, États-Unis)**, jamais stockée ni journalisée par Branché | Mention ajoutée dans `apps/web/legal/confidentialite.html` (section 4). [À VÉRIFIER : DPA Anthropic, conservation des entrées API côté Anthropic, transfert hors UE (DPF / clauses types), information si la photo contient une plaque ou des personnes — l'écran recommande de photographier le véhicule seul]. |
| Détection de la marque via les applis constructeur installées (Android) | présence d'une appli parmi une liste fermée de paquets déclarés dans `<queries>` | **sur l'appareil uniquement**, jamais envoyée | Expliquée à l'écran (« Nous avons vu l'appli X : est-ce votre voiture ? »). Pas de `QUERY_ALL_PACKAGES`. [À VÉRIFIER : politique Google Play « Package visibility » — usage justifié et déclaré]. |
| Fin automatique de recharge | position comparée à celle de la borne pendant une recharge suivie | **sur l'appareil uniquement** | Position non envoyée ; seulement pendant une recharge démarrée par l'utilisateur. |

## Paiement
- Branché ne voit, ne transmet ni ne stocke aucune donnée de carte : l'utilisateur paie l'opérateur (lecteur de la borne ou page officielle ouverte dans un navigateur intégré isolé). Pas de service de paiement au sens DSP2 fourni par Branché.
- « Préparer ma recharge » ne débite rien : le débit se fait à la borne, chez l'opérateur, en un geste depuis Branché (affiché honnêtement dans l'app).
- Comptes opérateurs : proposés seulement quand l'opérateur l'impose ; connexion sur le site officiel dans le navigateur intégré (session conservée par ce navigateur). Branché retient uniquement « compte X connecté le … » sur l'appareil ; badges : nom seulement. [À VÉRIFIER : CGU des opérateurs sur l'ouverture de leur site depuis une app tierce].
- Prix affichés : tarif déclaré par l'opérateur dans la base IRVE, **analysé automatiquement** et présenté comme estimation ; la borne et l'opérateur font foi (AFIR art. 5 : prix ad hoc affiché par l'opérateur).

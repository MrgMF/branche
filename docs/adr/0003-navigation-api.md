# ADR 0003 — API de navigation : itinéraire, incidents, signalements

- Statut : accepté · 05/11/2026 · Auteur : dev-backend (avis juridique intégré)

| Décision | Pourquoi | Conséquence / plus tard |
|---|---|---|
| `POST /v1/route` (corps JSON), `GET` → 405 | Les coordonnées précises ne doivent figurer ni dans les URL ni dans les journaux (avis juridique) | Écart à la V1.1 initiale (`GET ?from&to`), contrat mis à jour |
| TomTom Routing si `TOMTOM_API_KEY`, alternative de plus courte `travelTimeInSeconds` (avec trafic, sans lissage) | Seul fournisseur avec trafic temps réel et offre gratuite ; clé côté serveur, jamais renvoyée | Quota gratuit limité ; rate-limit 20/min/IP sur la route |
| Repli Valhalla, URL `VALHALLA_URL`, défaut public FOSSGIS, `traffic:false` | Fonctionne sans aucune clé (règle du projet) | Le serveur FOSSGIS est **non commercial, non prévu pour la production** : en production, clé TomTom ou Valhalla auto-hébergé |
| Aucun cache des itinéraires | Conditions TomTom : pas de cache partagé des réponses | Chaque calcul appelle le fournisseur |
| Champ `attribution` dans la réponse | Mentions exigées par TomTom et par la licence ODbL (OSM) | L'app l'affiche sous le tracé |
| Incidents : DATEX II Bison Futé via data.gouv (`INCIDENTS_URL`), `fast-xml-parser`, v2 (SOAP) et v3 tolérés, cache 2 min, copie périmée si panne | Licence Ouverte 2.0, cache autorisé ; flux réel = SOAP + `d2LogicalModel` v2 | Fixture réelle du 30/09/2026 dans `test/fixtures` ; entités XML bornées |
| Signalements en mémoire, TTL 1 h (borne_hs 24 h), 10/h/IP, position arrondie à 4 décimales | Minimisation RGPD : ni IP ni identifiant stockés ; la limite utilise une empreinte salée par processus | Perdus au redémarrage (acceptable) ; pas de type « police » en attendant le juridique |
| Journaux expurgés (`req` = méthode + URL masquée) | Pas de corps, d'IP ni de coordonnées ; `bbox` arrondie à 2 décimales | Diagnostic moins riche, assumé |
| `NODE_ENV=production` : jamais de Valhalla public ; sans clé ni `VALHALLA_URL` → 503 `routing_unavailable` + avertissement au démarrage | Revue critique : ne pas dépendre en production d'un service non commercial | Itinéraire indisponible tant que la clé n'est pas saisie sur Render |
| Interrupteur `REPORTS_DISABLED` (zones + date de fin) : 403 `reports_disabled`, signalements de la zone masqués | Note juridique : interdiction préfectorale de diffusion possible | Changement par variable d'environnement (redéploiement) ; date avec fuseau obligatoire |
| Type `qr_suspect`, TTL 24 h, sévérité 3, diffusé après 2 signalants distincts à < 50 m | Prévenir la fraude au QR code sans permettre à une seule personne de discréditer une borne (revue critique) | Empreinte salée en mémoire pour ce seul type ; alerte retardée jusqu'au 2e signalement |

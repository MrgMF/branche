// Config plugin : déclare les applis d'opérateurs que Branché peut OUVRIR via « Démarrer avec l'appli »
// (passerelle comme un lien Waze). iOS : LSApplicationQueriesSchemes (pour que Linking.canOpenURL voie l'appli) ;
// Android 11+ : <queries><package> (visibilité du paquet). Liste fermée et SOURCÉE (operator-portals.json appLaunch),
// jamais QUERY_ALL_PACKAGES (interdit par Google Play). N'imite ni ne stocke aucun identifiant.
const { withAndroidManifest, withInfoPlist } = require('expo/config-plugins');

module.exports = function withOperatorAppQueries(config, { schemes = [], packages = [] } = {}) {
  config = withInfoPlist(config, (cfg) => {
    const list = new Set(cfg.modResults.LSApplicationQueriesSchemes ?? []);
    for (const s of schemes) list.add(s);
    if (list.size) cfg.modResults.LSApplicationQueriesSchemes = [...list];
    return cfg;
  });
  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    const queries = (manifest.queries = manifest.queries ?? [{}]);
    const q = queries[0];
    const existing = new Set((q.package ?? []).map((p) => p.$['android:name']));
    q.package = [...(q.package ?? []), ...packages.filter((p) => !existing.has(p)).map((p) => ({ $: { 'android:name': p } }))];
    return cfg;
  });
  return config;
};

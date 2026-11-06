// Config plugin : déclare dans <queries> (Android 11+) les applis constructeur dont Branché vérifie la présence
// pour proposer la marque du véhicule. Liste fermée, pas de QUERY_ALL_PACKAGES (interdit par Google Play).
const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withVehicleAppQueries(config, { packages = [] } = {}) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    const queries = (manifest.queries = manifest.queries ?? [{}]);
    const q = queries[0];
    const existing = new Set((q.package ?? []).map((p) => p.$['android:name']));
    q.package = [...(q.package ?? []), ...packages.filter((p) => !existing.has(p)).map((p) => ({ $: { 'android:name': p } }))];
    return cfg;
  });
};

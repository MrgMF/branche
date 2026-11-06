import { describe, expect, it } from 'vitest';
import { describeTariff, freeCredible, parseTariff, planTariff, stationTariff, ttcFactor } from './tariff';

// Textes RÉELS du champ `tarification` de la base IRVE (site/data/tiles/*.json, novembre 2026), copiés tels quels.
type Case = [string, Record<string, unknown>];
const REAL: Case[] = [
  ['0.69€ / kwh', { kind: 'priced', perKwh: 0.69 }],
  ['0,29€ / kWh', { perKwh: 0.29 }],
  ['HPC 49cts/Kwh', { perKwh: 0.49 }],
  ['59 cts/kWh', { perKwh: 0.59 }],
  ['0,35cts/KWH HT', { perKwh: 0.35, ht: true }],
  ['0,399 e/ kwh', { perKwh: 0.399 }],
  ['0.45€TTC/kWh', { perKwh: 0.45, ht: false }],
  ['0,42€KWHHT', { perKwh: 0.42, ht: true }],
  ['0,42€/KWHTTC', { perKwh: 0.42, ht: false }],
  ['1,25€/KWH HT', { perKwh: 1.25, ht: true }],
  ['0,40€ / kwh pour les non abonnés.', { perKwh: 0.4 }],
  ['0.32€ / kW', { perKwh: 0.32 }],
  ['0.2€/AC au kWh', { perKwh: 0.2 }],
  ['Bornes rapides: 2€ + 0.59€ / kWh', { perKwh: 0.59, session: 2 }],
  ['0.25€+0.35/kWh', { perKwh: 0.35, session: 0.25 }],
  ['0,39E/kWh et 1E de cout fixe par session de recharge.', { perKwh: 0.39, session: 1 }],
  ['Frais de lancement de la charge : 0,5 € H Frais de consommation énergie : 0,42 € HT / kWh', { perKwh: 0.42, session: 0.5, ht: true }],
  ['2,5 € à la connexion / 2€ /kWh', { perKwh: 2, session: 2.5 }],
  ['Charge normale : 0,025€ / min', { perMin: 0.025, perKwh: undefined }],
  ['0,17/kWh + 0,125/mn', { perKwh: 0.17, perMin: 0.125 }],
  ['2,09 â‚¬HT/h', { perMin: 0.0348, ht: true }],
  ['3 €/heure', { perMin: 0.05 }],
  [
    'Coût de l’énergie : 0.32€ / KWH Coût de la durée lorsque le véhicule est en charge : 0.1€ / Minute Coût de la durée lorsque le véhicule est chargé : 0.1€ / Minute',
    { perKwh: 0.32, perMin: 0.1, idle: { perMin: 0.1, afterMin: 0 } },
  ],
  [
    'lorsque la voitutre est branché: 0.32€/Kwh + 0.1€ /min lorsque la voiture est chargée mais toujours branché: 0.1€/min',
    { perKwh: 0.32, perMin: 0.1, idle: { perMin: 0.1, afterMin: 0 } },
  ],
  [
    "entre 08:00 et 20:00 : 0.30916667€ par kwh de charge, 3.75€ par heure d'occupation hors charge, entre 20:00 et 08:00 : 0.30916667€ par kwh de charge, par défaut : 0.30916667€ par kwh de charge",
    { perKwh: 0.30916667, idle: { perMin: 0.0625, afterMin: 0 }, perMin: undefined, varies: false },
  ],
  [
    "par défaut : 0.4167€ par kwh de charge, par défaut : 6.0€ par heure d'occupation hors charge, 0.4167€ par kwh de charge, 6.0€ par heure de charge, par défaut : 0.4167€ par kwh de charge",
    { perKwh: 0.4167, perMin: 0.1, idle: { perMin: 0.1, afterMin: 0 } },
  ],
  // Signe euro mal encodé (U+0080) dans la source
  [
    "par défaut : 0.4583\u0080 par kwh de charge, par défaut : 6.0\u0080 par heure d'occupation hors charge, 0.4583\u0080 par kwh de charge, 6.0\u0080 par heure de charge",
    { perKwh: 0.4583, perMin: 0.1, idle: { perMin: 0.1, afterMin: 0 } },
  ],
  [
    "par défaut : prix de départ 1.25€, 0.33334€ par kwh de charge, 0.25€ par heure de charge, 0.25€ par heure d'occupation hors charge",
    { perKwh: 0.33334, session: 1.25, perMin: 0.0042 },
  ],
  ['0,35€/kWh + 0,03€/min entre 6h et 18h, 15€ la session entre 18h et 6h', { perKwh: 0.35, perMin: 0.03, session: 15, varies: true }],
  ['0,0417€/kWh entre 6h et 21h, 0,0208€/kWh entre 21h et 6h', { perKwh: 0.0417, perKwhMin: 0.0208, varies: true }],
  ['0,5€/kWh entre 6h et 21h, 0,35€/kWh entre 21h et 6h', { perKwh: 0.5, perKwhMin: 0.35, varies: true }],
  ['0.50 € par KWh + 0.025 € par minute la 1ère heure + 0.10 € par minute au-delà de 60 minutes', { perKwh: 0.5, perMin: 0.025, perMinLater: { afterMin: 60, perMin: 0.1 } }],
  ['0,42 € HT / kWh + 0,08€ HT/ min à partir de 90min', { perKwh: 0.42, perMinLater: { afterMin: 90, perMin: 0.08 }, ht: true }],
  [
    '0,49E/kWh puis 30 min de parking gratuit une fois la charge terminée. Aprè 30 min, 0,09E/min de parking supplémentaire. 1E de cout fixe par session de recharge.',
    { perKwh: 0.49, session: 1, idle: { perMin: 0.09, afterMin: 30 } },
  ],
  ['0.30€/kWh+ 30 minutes après la recharge 2.40€/h', { perKwh: 0.3, idle: { perMin: 0.04, afterMin: 30 } }],
  [
    'Energie Tous les jours 0,29 €/kWh Stationnement à la borne Pendant la recharge Gratuit En dehors des sessions de recharge 0,04 €/min Après 1 h période de grâce',
    { perKwh: 0.29, idle: { perMin: 0.04, afterMin: 60 } },
  ],
  ['0.30€/KW + 0.025€/min de stationnement', { perKwh: 0.3, idle: { perMin: 0.025, afterMin: 0 } }],
  ['60min gratuit, après 0.20€/kWh + 0.01€/min', { perKwh: 0.2, perMin: 0.01 }],
  [
    '{"fixedPrice":0,"energyPrice":0.55,"minimumBilling":0,"matrix":[],"matrixOSF":[{"duration":0,"interval":1,"price":0.3,"gracePeriodBeforeOSF":900}],"hasDynamicTarif":false,"ecoHour":false}',
    { perKwh: 0.55, idle: { perMin: 0.3, afterMin: 15 }, session: undefined },
  ],
  // Montant sans unité : supposé au kWh, et signalé comme tel
  ['0,45', { perKwh: 0.45, guessedUnit: true }],
  ['0.4916', { perKwh: 0.4916, guessedUnit: true }],
  ['0.50€', { perKwh: 0.5, guessedUnit: true }],
  // Rien d'exploitable : on ne devine pas
  ['TRUE', { kind: 'unknown' }],
  ['Inconnu', { kind: 'unknown' }],
  ['0', { kind: 'unknown' }],
  ['0 pour utilisateur', { kind: 'unknown' }],
  ['FR*S61_GA', { kind: 'unknown' }],
  ['Non communiqué', { kind: 'unknown' }],
  ['Grille tarifaire en ligne', { kind: 'unknown' }],
  ['Tarification au kWh plus frais de connexion éventuelles en fonction de l abonnement détenu', { kind: 'unknown', notes: ['Facturé au kWh (montant non publié).', 'Frais de connexion ou de session possibles.', 'Prix différent pour les abonnés.'] }],
  ['https://www.metropolis-recharge.fr/', { kind: 'link', url: 'https://www.metropolis-recharge.fr/' }],
  ['gratuit', { kind: 'free' }],
  ['La recharge est gratuite pour les Admin CQFD, CQFD véhicules, Véhicules EKLEO', { kind: 'unknown', notes: ['Gratuit pour certains usagers seulement, selon l’opérateur.'] }],
];

describe('parseTariff — textes réels IRVE', () => {
  it(`couvre au moins 25 exemples réels (${REAL.length})`, () => expect(REAL.length).toBeGreaterThanOrEqual(25));
  it.each(REAL)('%s', (raw, expected) => {
    const t = parseTariff(raw);
    for (const [k, v] of Object.entries(expected)) {
      const got = (t as unknown as Record<string, unknown>)[k];
      if (typeof v === 'number') expect(got, k).toBeCloseTo(v, 4);
      else expect(got, k).toEqual(v);
    }
    if (!('kind' in expected) && Object.keys(expected).some((k) => ['perKwh', 'perMin', 'session', 'idle'].includes(k))) expect(t.kind).toBe('priced');
  });
});

describe('parseTariff — cas limites', () => {
  it('vide, null, gratuité IRVE', () => {
    expect(parseTariff('').kind).toBe('unknown');
    expect(parseTariff(null).kind).toBe('unknown');
    expect(parseTariff('', { free: true }).kind).toBe('free');
  });
  it('les heures de plage et les durées ne deviennent jamais des prix', () => {
    const t = parseTariff('8h à 22h = activation à 0,99€ + 0,48€/kWh + 0,05€/min pendant 90min');
    expect(t.perKwh).toBe(0.48);
    expect(t.perMin).toBe(0.05);
    expect(t.session).toBe(0.99);
  });
  it('valeurs aberrantes ignorées (5 €/kWh, 60 €/min)', () => {
    const t = parseTariff('AC 1€/kWh - DC 5€/kWh');
    expect(t.perKwh).toBe(1);
    expect(parseTariff('60€/min').kind).toBe('unknown');
  });
  it('lien conservé à côté d’un prix', () => {
    const t = parseTariff('0,45 €/kWh, détails sur https://exemple.fr/tarifs');
    expect(t.kind).toBe('priced');
    expect(t.url).toBe('https://exemple.fr/tarifs');
  });
});

describe('describeTariff / ttcFactor', () => {
  it('lignes lisibles, HT signalé, occupation avec tolérance', () => {
    const t = parseTariff('0,49E/kWh puis 30 min de parking gratuit une fois la charge terminée. Aprè 30 min, 0,09E/min de parking supplémentaire. 1E de cout fixe par session de recharge.');
    expect(describeTariff(t)).toEqual([
      'Énergie : 0,49 €/kWh',
      'Frais de session : 1,00 €',
      'Occupation après la charge : 0,09 €/min (5,40 €/h) après 30 min de tolérance',
    ]);
    const ht = parseTariff('0,42€KWHHT');
    expect(describeTariff(ht)).toContain('Prix annoncés hors taxes : TVA de 20 % en plus (incluse dans l’estimation).');
    expect(ttcFactor(ht)).toBe(1.2);
    expect(describeTariff(parseTariff('0,45'))[0]).toBe('Énergie : 0,45 €/kWh (unité non précisée, supposée au kWh)');
    expect(describeTariff(parseTariff('0,5€/kWh entre 6h et 21h, 0,35€/kWh entre 21h et 6h'))[0]).toBe('Énergie : 0,35 €/kWh à 0,50 €/kWh selon l’heure');
    expect(describeTariff(parseTariff('3.75€ par heure d\'occupation hors charge, 0.3€ par kwh')).join('|')).toContain('(3,75 €/h), dès la fin de charge');
  });
});

describe('gratuité déclarée : crédible seulement < 50 kW et sans moyen de paiement', () => {
  it.each([
    ['300 kW, badge seul (TotalEnergies Massy, réelle)', { free: true, kw: 300, pay: ['badge'] }],
    ['50 kW pile', { free: true, kw: 50, pay: [] }],
    ['22 kW, CB déclarée', { free: true, kw: 22, pay: ['cb'] }],
    ['22 kW, paiement à l’acte', { free: true, kw: 22, pay: ['acte', 'badge'] }],
    ['22 kW, QR dynamique', { free: true, kw: 22, pay: ['qr_dynamique'] }],
    ['texte « Gratuit » sur 150 kW', { kw: 150, pay: [] }],
  ] as [string, { free?: boolean; kw: number; pay: string[] }][])('%s → « à vérifier », pas gratuit', (_l, ctx) => {
    const t = parseTariff(ctx.free ? '' : 'Gratuit', ctx);
    expect(t.kind).not.toBe('free');
    expect(t.freeDoubtful).toBe(true);
    expect(describeTariff(t)).toEqual(['Déclarée gratuite dans la base nationale, à vérifier.']);
  });
  it('22 kW, badge seul ou rien : gratuit crédible', () => {
    expect(parseTariff('', { free: true, kw: 22, pay: ['badge'] }).kind).toBe('free');
    expect(parseTariff('', { free: true, kw: 7.4, pay: [] }).kind).toBe('free');
    expect(freeCredible({ kw: 49.9, pay: ['badge'] })).toBe(true);
  });
  it('un tarif publié l’emporte (ni gratuit, ni « à vérifier »)', () => {
    const t = parseTariff('0,39 €/kWh', { free: true, kw: 150, pay: ['cb'] });
    expect(t).toMatchObject({ kind: 'priced', perKwh: 0.39 });
    expect(t.freeDoubtful).toBeUndefined();
  });
  it('stationTariff / planTariff appliquent la même règle', () => {
    expect(stationTariff({ prix: '', free: true, kw: 300, pay: ['badge'] }).freeDoubtful).toBe(true);
    expect(planTariff({ tariffRaw: '', free: true, stationKw: 300, pointKw: 22, pay: ['badge'] }).freeDoubtful).toBe(true);
    // Ancien plan sans puissance de station : puissance du point
    expect(planTariff({ tariffRaw: '', free: true, pointKw: 22 }).kind).toBe('free');
  });
});

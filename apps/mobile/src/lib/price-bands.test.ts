// V2.1 prix : tarifs à plages horaires (jamais additionnés) et tarifs alternatifs non horaires — textes réels IRVE (site/data).
import { describe, expect, it } from 'vitest';
import { bestNearby, rankCheapest } from './cheapest';
import { applicableTariff, bandCosts, estimateCharge, priceTraps, totalCost } from './estimate';
import type { Station } from './stations';
import { bandLabel, describeTariff, parseTariff, pickAlternative, tariffAtMinute } from './tariff';
import { VEHICLES } from './vehicle';

const zoe = VEHICLES.find((x) => x.id === 'renault-zoe-52')!;
const at = (h: number, m = 0) => new Date(2026, 10, 6, h, m).getTime();
const base = { vehicle: zoe, socPercent: 30, pointKw: 22, plugs: ['t2' as const] };

const ZEPHYRE = '0,35€/kWh + 0,03€/min entre 6h et 18h, 15€ la session entre 18h et 6h'; // FRZP1P36580 (165 points)
const ZEPHYRE_8_20 = '0,3€/kWh + 0,03€/min entre 8h et 20h, 15€ la session entre 18h et 6h';
const NIGHT_KWH = '0,5€/kWh entre 6h et 21h, 0,35€/kWh entre 21h et 6h';
const DAY_MIN = '0,26€/kWh + 0,03€/min entre 6h et 18h, 0,52€/kWh entre 18h et 6h';
const DAY_SESSION = '0,25€/kWh + 2€ la session entre 6h et 18h, 0,25€/kWh entre 18h et 6h';
const UNBANDED_REST = '0,35€/kWh + 0,03€/min entre 6h et 21h, 0,2€/kWh';
const EASY_DAY_IDLE =
  "entre 08:00 et 20:00 : 0.30916667€ par kwh de charge, 3.75€ par heure d'occupation hors charge, entre 20:00 et 08:00 : 0.30916667€ par kwh de charge, par défaut : 0.30916667€ par kwh de charge";
const EASY_DAY_TIME =
  "entre 07:00 et 22:00 : 0.3333€ par kwh de charge, entre 07:00 et 22:00 : 5.0€ par heure d'occupation hors charge, 0.3333€ par kwh de charge, 5.0€ par heure de charge, entre 22:00 et 07:00 : 0.3333€ par kwh de charge, par défaut : ";
const LEAD = '8h à 22h = activation à 0,99€ + 0,48€/kWh + 0,05€/min pendant 90min, 0;10€/min au delà. De 22h à 8h = 20€';

describe('plages horaires : un tarif complet par plage', () => {
  it('Zephyre : jour = kWh + minute, nuit = forfait 15 € seul ; jamais additionnés', () => {
    const t = parseTariff(ZEPHYRE);
    expect(t.bands!.list.map(bandLabel)).toEqual(['06:00–18:00', '18:00–06:00']);
    expect(t.bands!.list[0].tariff).toMatchObject({ perKwh: 0.35, perMin: 0.03 });
    expect(t.bands!.list[0].tariff.session).toBeUndefined();
    expect(t.bands!.list[1].tariff).toMatchObject({ session: 15 });
    expect(t.bands!.list[1].tariff.perKwh).toBeUndefined();
    const day = estimateCharge({ ...base, tariff: t, startAt: at(9) });
    expect(day.bandMode).toBe('band');
    expect(day.cost).toBeCloseTo(day.kWhBilled * 0.35 + day.minutes * 0.03, 1); // ≈ 12 €, pas 27 €
    expect(day.cost!).toBeLessThan(14);
    const night = estimateCharge({ ...base, tariff: t, startAt: at(22) });
    expect(night.cost).toBe(15);
  });

  it('Zephyre : alertes sur la plage applicable seulement (jour : minute ≈ +0,07 €/kWh, pas de forfait ; nuit : forfait)', () => {
    const t = parseTariff(ZEPHYRE);
    const day = totalCost({ ...base, tariff: t, startAt: at(9) });
    const traps = priceTraps(t, day);
    const m = traps.find((x) => x.kind === 'perMin');
    expect(m && m.kind === 'perMin' && m.perKwh).toBeCloseTo(0.35 + (0.03 * 60) / (22 * 1.1), 1); // ≈ 0,42
    expect(m && m.kind === 'perMin' && m.worse).toBe(false);
    expect(traps.some((x) => x.kind === 'session')).toBe(false);
    const night = totalCost({ ...base, socPercent: 70, tariff: t, startAt: at(23) });
    expect(priceTraps(t, night).map((x) => x.kind)).toEqual(['session']);
  });

  it('chevauchement de deux plages : la plus chère pour cette recharge, signalée', () => {
    const t = parseTariff(ZEPHYRE);
    const e = estimateCharge({ ...base, tariff: t, startAt: at(17, 30) });
    expect(e.bandMode).toBe('overlap');
    expect(e.cost).toBe(15);
  });

  it('heure non couverte (plages publiées incohérentes 8h–20h / 18h–6h) : tarif le plus élevé, signalé', () => {
    const t = parseTariff(ZEPHYRE_8_20);
    expect(t.bands).toBeDefined();
    expect(tariffAtMinute(t, 7 * 60)).toBeNull();
    expect(estimateCharge({ ...base, tariff: t, startAt: at(7) }).bandMode).toBe('fallback');
    expect(estimateCharge({ ...base, tariff: t, startAt: at(10) }).bandMode).toBe('band');
  });

  it.each([
    [NIGHT_KWH, 9, 0.5, 23, 0.35],
    [DAY_SESSION, 9, 0.25, 20, 0.25],
    [UNBANDED_REST, 23, 0.2, 9, 0.35],
  ])('plage applicable selon l’heure : %s', (raw, h1, k1, h2, k2) => {
    const t = parseTariff(raw);
    expect(estimateCharge({ ...base, socPercent: 60, tariff: t, startAt: at(h1) }).applied.perKwh).toBe(k1);
    expect(estimateCharge({ ...base, socPercent: 60, tariff: t, startAt: at(h2) }).applied.perKwh).toBe(k2);
  });

  it('jour à la minute moins cher le jour, nuit au kWh doublé : coût de la plage, pas la somme', () => {
    const t = parseTariff(DAY_MIN);
    const day = estimateCharge({ ...base, tariff: t, startAt: at(10) });
    const night = estimateCharge({ ...base, tariff: t, startAt: at(23) });
    expect(night.cost).toBeCloseTo(night.kWhBilled * 0.52, 1);
    expect(day.cost).toBeCloseTo(day.kWhBilled * 0.26 + day.minutes * 0.03, 1);
    expect(bandCosts({ ...base, tariff: t }).map((x) => x.cost)).toEqual([day.cost, night.cost]);
  });

  it('format « entre HH:MM et HH:MM : » (Easycharge/Freshmile) : occupation et minute rattachées à leur plage, HT hérité', () => {
    const a = parseTariff(EASY_DAY_IDLE);
    expect(a.bands!.list[0].tariff.idle).toEqual({ perMin: 0.0625, afterMin: 0 });
    expect(a.bands!.list[1].tariff.idle).toBeUndefined();
    expect(a.bands!.list.every((b) => b.tariff.htLikely)).toBe(true);
    const night = totalCost({ ...base, tariff: a, startAt: at(21), stayMin: 600 });
    expect(night.idle).toBe(0); // 21 h : pas d'occupation facturée la nuit
    expect(priceTraps(a, night).some((x) => x.kind === 'idle')).toBe(false);
    const day = totalCost({ ...base, tariff: a, startAt: at(9), stayMin: 240 });
    expect(day.idle!).toBeGreaterThan(0);
    const b = parseTariff(EASY_DAY_TIME);
    expect(b.bands!.list[0].tariff.perMin).toBeCloseTo(5 / 60, 3);
    expect(b.bands!.list[1].tariff.perMin).toBeUndefined();
    expect(priceTraps(b, totalCost({ ...base, tariff: b, startAt: at(23) })).some((x) => x.kind === 'perMin')).toBe(false);
  });

  it('plage en tête de phrase (« 8h à 22h = … . De 22h à 8h = 20€ ») : nuit = forfait 20 €', () => {
    const t = parseTariff(LEAD);
    expect(t.bands!.list.map(bandLabel)).toEqual(['08:00–22:00', '22:00–08:00']);
    expect(t.bands!.list[1].tariff.session).toBe(20);
    expect(estimateCharge({ ...base, tariff: t, startAt: at(23) }).cost).toBe(20);
  });

  it('description : « estimation au tarif de l’heure de début » quand les plages sont analysées', () => {
    expect(describeTariff(parseTariff(ZEPHYRE))).toContain('Le tarif varie selon l’heure : estimation au tarif de l’heure de début.');
    expect(applicableTariff(parseTariff('0,40 €/kWh'), at(9), 10, 60).mode).toBe('flat');
  });
});

describe('tarifs alternatifs non horaires : le bon, jamais additionnés', () => {
  it('abonné / non abonné : paiement direct (non abonné)', () => {
    const t = parseTariff('Abonnés : 0,25 €/kWh ; non abonnés : 0,40 €/kWh + 1 € par session');
    expect(t).toMatchObject({ perKwh: 0.4, session: 1 });
    expect(parseTariff('0,30 €/kWh pour les abonnés, 0,45 €/kWh sans abonnement').perKwh).toBe(0.45);
  });
  it('AC / DC et par puissance : selon la puissance du point', () => {
    const acdc = 'AC : 0,35 €/kWh ; DC : 0,55 €/kWh + 0,20 €/min';
    expect(parseTariff(acdc, { pointKw: 22 })).toMatchObject({ perKwh: 0.35 });
    expect(parseTariff(acdc, { pointKw: 22 }).perMin).toBeUndefined();
    expect(parseTariff(acdc, { pointKw: 150 })).toMatchObject({ perKwh: 0.55, perMin: 0.2 });
    const pw = 'Jusqu’à 22 kW : 0,30 €/kWh ; au-delà de 50 kW : 0,59 €/kWh';
    expect(parseTariff(pw, { pointKw: 11 }).perKwh).toBe(0.3);
    expect(parseTariff(pw, { pointKw: 100 }).perKwh).toBe(0.59);
    const speed = 'Bornes rapides : 2€ + 0,59€/kWh ; bornes ultra rapides : 2€ + 0,72€/kWh';
    expect(parseTariff(speed, { pointKw: 50 }).perKwh).toBe(0.59);
    expect(parseTariff(speed, { pointKw: 300 }).perKwh).toBe(0.72);
  });
  it('textes réels à prix unique inchangés', () => {
    for (const raw of ['Bornes rapides: 2€ + 0.59€ / kWh', '0,3 €/kWh+0,1 €/min pour les non abonnés', '0.36€ AC /KW', 'Charge normale : 0,025€ / min'])
      expect(pickAlternative(raw, 22)).toBe(raw);
  });
});

describe('« Moins cher » : coût de la plage applicable à l’heure courante', () => {
  const st = (id: string, lat: number, prix: string): Station => ({ id, n: id, o: id, lat, lon: 2.3, p: 2, kw: 22, c: ['t2'], pay: ['cb'], prix });
  const me = { lat: 48.75, lon: 2.3 };
  const list = [st('zephyre', 48.7505, ZEPHYRE), st('kwh', 48.761, '0,40 €/kWh')];
  const o = { vehicle: zoe, socPercent: 30, from: me, user: me, includeDetour: false };
  it('le jour, Zephyre (≈ 12 €) n’est pas gonflée par le forfait de nuit', () => {
    const r = rankCheapest(list, { ...o, at: at(9) });
    expect(r[0].s.id).toBe('kwh');
    expect(r.find((x) => x.s.id === 'zephyre')!.score!).toBeLessThan(14);
    const b = bestNearby(r, me);
    expect(b === null || b.saving < 3).toBe(true);
  });
  it('la nuit : forfait 15 €', () => {
    expect(rankCheapest(list, { ...o, at: at(23) }).find((x) => x.s.id === 'zephyre')!.score).toBe(15);
  });
});

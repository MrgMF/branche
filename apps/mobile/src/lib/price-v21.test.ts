// V2.1 prix : coût total réel de MA recharge, pièges tarifaires, « Le moins cher près de moi ».
import { describe, expect, it } from 'vitest';
import { bestNearby, bestPoint, rankCheapest } from './cheapest';
import { estimateCharge, IDLE_ALERT_LEAD_MIN, priceTraps, STAY_MIN, stayMinutes, totalCost } from './estimate';
import type { Station } from './stations';
import { parseTariff } from './tariff';
import { VEHICLES } from './vehicle';

const v = (id: string) => VEHICLES.find((x) => x.id === id)!;
const zoe = v('renault-zoe-52');
const base = { vehicle: zoe, socPercent: 20, pointKw: 22, plugs: ['t2' as const] };

describe('totalCost', () => {
  it('au kWh seul : total = énergie, prix effectif = prix publié', () => {
    const c = totalCost({ ...base, tariff: parseTariff('0,40 €/kWh') });
    const e = estimateCharge({ ...base, tariff: parseTariff('0,40 €/kWh') });
    expect(c.kWh).toBe(e.kWhBilled);
    expect(c.chargeMin).toBe(e.minutes);
    expect(c.total).toBeCloseTo(e.kWhBilled * 0.4, 1);
    expect(c.effectivePerKwh).toBeCloseTo(0.4, 2);
    expect(c.idle).toBe(0);
    expect(c.unknown).toBe(false);
  });

  it('énergie + temps + forfait additionnés, effectif = total / kWh', () => {
    const t = parseTariff('1 € par session + 0,30 €/kWh + 0,05 €/min');
    const c = totalCost({ ...base, tariff: t });
    expect(c.session).toBe(1);
    expect(c.time).toBeCloseTo(c.chargeMin * 0.05, 1);
    expect(c.total).toBeCloseTo(c.kWh * 0.3 + c.chargeMin * 0.05 + 1, 1);
    expect(c.effectivePerKwh).toBeCloseTo(c.total! / c.kWh, 3);
  });

  it('occupation : rien si l’on part à la fin de charge, pénalité selon la durée de stationnement prévue', () => {
    const t = parseTariff('0,49E/kWh puis 30 min de parking gratuit une fois la charge terminée. Aprè 30 min, 0,09E/min de parking supplémentaire.');
    const now = totalCost({ ...base, tariff: t });
    expect(now.idle).toBe(0);
    expect(now.idleFromMin).toBe(now.chargeMin + 30);
    const night = totalCost({ ...base, tariff: t, stayMin: stayMinutes('night') });
    expect(night.stayMin).toBe(600);
    expect(night.idle).toBeCloseTo((600 - now.chargeMin - 30) * 0.09, 1);
    expect(night.total).toBeCloseTo(now.total! + night.idle!, 1);
    expect(night.effectivePerKwh!).toBeGreaterThan(now.effectivePerKwh!);
  });

  it('cas CLCV : les frais d’occupation peuvent doubler la facture', () => {
    const t = parseTariff("0,50 €/kWh, 6 € par heure d'occupation hors charge");
    const c = totalCost({ ...base, socPercent: 60, tariff: t, stayMin: STAY_MIN.night });
    expect(c.idle!).toBeGreaterThan(c.charge!);
  });

  it('on repart avant la fin : charge écourtée (kWh et minutes réduits)', () => {
    const t = parseTariff('0,40 €/kWh');
    const full = totalCost({ ...base, vehicle: v('vw-id3-58'), pointKw: 7.4, tariff: t });
    const hour = totalCost({ ...base, vehicle: v('vw-id3-58'), pointKw: 7.4, tariff: t, stayMin: 60 });
    expect(full.chargeMin).toBeGreaterThan(60);
    expect(hour.cutShort).toBe(true);
    expect(hour.chargeMin).toBe(60);
    expect(hour.kWh).toBeLessThan(full.kWh);
    expect(hour.kWh).toBeCloseTo(7.4 * 1.1, 0);
  });

  it('tarif inconnu → total null (« Inconnu »), jamais 0 ; occupation seule → inconnu aussi', () => {
    for (const raw of ['Grille tarifaire en ligne', '', "6.0€ par heure d'occupation hors charge"]) {
      const c = totalCost({ ...base, tariff: parseTariff(raw) });
      expect(c.total).toBeNull();
      expect(c.effectivePerKwh).toBeNull();
      expect(c.unknown).toBe(true);
    }
    expect(totalCost({ ...base, tariff: parseTariff('', { free: true, kw: 300, pay: ['badge'] }) }).total).toBeNull();
  });

  it('gratuit crédible → 0 € connu ; HT majoré de 20 %', () => {
    expect(totalCost({ ...base, tariff: parseTariff('gratuit') }).total).toBe(0);
    const ht = totalCost({ ...base, tariff: parseTariff('0,40 € HT / kWh') });
    expect(ht.perKwh).toBeCloseTo(0.48, 3);
    expect(ht.effectivePerKwh).toBeCloseTo(0.48, 2);
  });
});

describe('priceTraps', () => {
  it('à la minute : une voiture lente paie beaucoup plus cher au kWh (Zoe 22 kW vs Spring 7 kW)', () => {
    const t = parseTariff('0,25 €/kWh + 0,05 €/min');
    const spring = totalCost({ ...base, vehicle: v('dacia-spring'), tariff: t });
    const traps = priceTraps(t, spring);
    const m = traps.find((x) => x.kind === 'perMin');
    expect(m && m.kind === 'perMin' && m.perKwh).toBeCloseTo(spring.charge! / spring.kWh, 2);
    expect(m && m.kind === 'perMin' && m.worse).toBe(true);
    const fast = totalCost({ ...base, tariff: t });
    const mf = priceTraps(t, fast).find((x) => x.kind === 'perMin');
    expect(mf && mf.kind === 'perMin' && mf.perKwh).toBeLessThan(m && m.kind === 'perMin' ? m.perKwh : 0);
  });

  it('au kWh seul : aucune alerte minute ni forfait', () => {
    const t = parseTariff('0,40 €/kWh');
    expect(priceTraps(t, totalCost({ ...base, tariff: t }))).toEqual([]);
  });

  it('forfait de session > 20 % du total : défavorable pour une petite recharge seulement', () => {
    const t = parseTariff('3 € par session + 0,30 €/kWh');
    const small = totalCost({ ...base, socPercent: 70, tariff: t });
    expect(priceTraps(t, small).some((x) => x.kind === 'session')).toBe(true);
    const big = totalCost({ ...base, vehicle: v('renault-scenic-87'), socPercent: 10, tariff: t });
    expect(priceTraps(t, big).some((x) => x.kind === 'session')).toBe(false);
  });

  it('occupation : heure de débranchement calculée depuis le branchement, délai sinon', () => {
    const t = parseTariff('0,49E/kWh puis 30 min de parking gratuit une fois la charge terminée. Aprè 30 min, 0,09E/min de parking supplémentaire.');
    const c = totalCost({ ...base, tariff: t });
    const at = Date.UTC(2026, 10, 6, 9, 0);
    const idle = priceTraps(t, c, at).find((x) => x.kind === 'idle');
    expect(idle).toEqual({ kind: 'idle', afterMin: 30, inMin: c.chargeMin + 30, at: at + (c.chargeMin + 30) * 60_000 });
    const rel = priceTraps(t, c).find((x) => x.kind === 'idle');
    expect(rel && rel.kind === 'idle' && rel.at).toBeNull();
    expect(IDLE_ALERT_LEAD_MIN).toBe(10);
  });

  it('tarif inconnu : aucune alerte inventée', () => {
    const t = parseTariff('Tarifs sur le site');
    expect(priceTraps(t, totalCost({ ...base, tariff: t }))).toEqual([]);
  });
});

const st = (id: string, lat: number, prix: string | undefined, over: Partial<Station> = {}): Station => ({
  id, n: id, lat, lon: 2.3, p: 2, kw: 22, c: ['t2'], pay: ['cb'], prix, ...over,
});
const me = { lat: 48.75, lon: 2.3 };

describe('rankCheapest / bestNearby', () => {
  const list = [
    st('proche', 48.7505, '0,60 €/kWh'), // ~55 m
    st('moins-chere', 48.761, '0,30 €/kWh'), // ~1,2 km
    st('inconnue', 48.7502, undefined),
    st('moyenne', 48.755, '0,45 €/kWh'),
    st('reservee', 48.7501, '0,10 €/kWh', { acc: 'reserve' }),
    st('chademo', 48.7501, '0,10 €/kWh', { c: ['chademo'], kw: 50 }),
    st('loin', 49.2, '0,05 €/kWh'),
  ];
  const opts = { vehicle: zoe, socPercent: 20, from: me, user: me, includeDetour: false };

  it('classe par coût total puis distance ; prix non publié en fin ; incompatibles, réservées et lointaines exclues', () => {
    const r = rankCheapest(list, opts);
    expect(r.map((x) => x.s.id)).toEqual(['moins-chere', 'moyenne', 'proche', 'inconnue']);
    expect(r[3].score).toBeNull();
    expect(r[0].d).toBeCloseTo(1.22, 1);
  });

  it('même emplacement publié deux fois : une seule ligne', () => {
    const r = rankCheapest([st('a', 48.752, '0,40 €/kWh', { o: 'X' }), st('b', 48.752, '0,40 €/kWh', { o: 'X' })], opts);
    expect(r).toHaveLength(1);
  });

  it('à prix égal : la plus proche d’abord', () => {
    const r = rankCheapest([st('b', 48.76, '0,40 €/kWh'), st('a', 48.752, '0,40 €/kWh')], opts);
    expect(r.map((x) => x.s.id)).toEqual(['a', 'b']);
  });

  it('détour : coût du trajet aller ajouté (kWh du trajet × prix effectif), itinéraire connu prioritaire', () => {
    const r = rankCheapest(list, { ...opts, includeDetour: true });
    const best = r.find((x) => x.s.id === 'moins-chere')!;
    expect(best.detour!.routed).toBe(false);
    expect(best.detour!.kWh).toBeCloseTo((best.d! * zoe.consumptionKWhPer100) / 100, 1);
    expect(best.score).toBeCloseTo(best.cost.total! + best.detour!.cost!, 2);
    const routed = rankCheapest(list, { ...opts, includeDetour: true, routes: { 'moins-chere': { distanceM: 2400, durationS: 360 } } }).find((x) => x.s.id === 'moins-chere')!;
    expect(routed.detour).toMatchObject({ km: 2.4, routed: true, min: 6 });
    expect(rankCheapest(list, { ...opts, includeDetour: true }).find((x) => x.s.id === 'inconnue')!.detour!.cost).toBeNull();
  });

  it('carte « Meilleur prix proche » : gain ≥ 15 % vs la plus proche, sinon rien', () => {
    const r = rankCheapest(list, opts);
    const b = bestNearby(r, me)!;
    expect(b.best.s.id).toBe('moins-chere');
    expect(b.nearest.s.id).toBe('proche');
    expect(b.saving).toBeCloseTo(b.nearest.score! - b.best.score!, 2);
    expect(b.gain).toBeCloseTo(0.5, 1);
    expect(bestNearby(rankCheapest([st('p', 48.7505, '0,40 €/kWh'), st('q', 48.76, '0,36 €/kWh')], opts), me)).toBeNull(); // 10 %
    // Seule borne au prix publié : aucune comparaison possible (la borne sans prix n'est jamais « battue »)
    expect(bestNearby(rankCheapest([st('p', 48.7501, undefined), st('q', 48.76, '0,30 €/kWh')], opts), me)).toBeNull();
    expect(bestNearby(rankCheapest([st('p', 48.7501, undefined)], opts), me)).toBeNull();
  });

  it('point retenu : le plus puissant compatible avec le véhicule', () => {
    const s = st('x', 48.75, '0,4 €/kWh', { kw: 150, c: ['ccs', 't2', 'chademo'], pdc: [['A', 150, ['ccs']], ['B', 22, ['t2']], ['C', 50, ['chademo']]] });
    expect(bestPoint(s, v('nissan-leaf-40'))).toEqual({ kw: 50, plugs: ['chademo'] });
    expect(bestPoint(s, zoe)).toEqual({ kw: 150, plugs: ['ccs'] });
    expect(bestPoint({ ...s, pdc: undefined }, v('nissan-leaf-40'))).toEqual({ kw: 150, plugs: ['t2', 'chademo'] });
  });
});

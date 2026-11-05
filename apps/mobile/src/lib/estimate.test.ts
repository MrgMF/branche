import { describe, expect, it } from 'vitest';
import { durationLabel, estimateCharge, isDc, powerAt, progressAt, costOf } from './estimate';
import { parseTariff } from './tariff';
import { VEHICLES } from './vehicle';

const v = (id: string) => VEHICLES.find((x) => x.id === id)!;
const kwh049 = parseTariff('0,49 €/kWh');

describe('estimateCharge', () => {
  it('AC 22 kW avec une voiture limitée à 11 kW : puissance = min(point, véhicule), linéaire', () => {
    const e = estimateCharge({ vehicle: v('vw-id3-58'), socPercent: 20, pointKw: 22, plugs: ['t2'], tariff: kwh049 });
    expect(e.dc).toBe(false);
    expect(e.powerKw).toBe(11);
    expect(e.kWh).toBeCloseTo(34.8, 1); // 58 × 60 %
    expect(e.kWhBilled).toBeCloseTo(38.3, 1); // pertes AC 10 %
    expect(e.minutes).toBeCloseTo(190, -1); // 34,8 kWh / 11 kW
    expect(e.cost).toBeCloseTo(38.28 * 0.49, 1);
    expect(e.unknownPrice).toBe(false);
  });

  it('DC : la courbe ralentit au-delà de 50 % (plus long qu’à puissance constante)', () => {
    const e = estimateCharge({ vehicle: v('kia-ev6-77'), socPercent: 10, pointKw: 150, plugs: ['ccs'], tariff: kwh049 });
    expect(e.dc).toBe(true);
    expect(e.powerKw).toBe(150);
    const constant = ((74 * 0.7) / 150) * 60;
    expect(e.minutes).toBeGreaterThan(constant * 1.2);
    expect(e.minutes).toBeLessThan(constant * 1.6);
  });

  it('DC limité par le véhicule (Zoe 50 kW sur borne 300 kW)', () => {
    const e = estimateCharge({ vehicle: v('renault-zoe-52'), socPercent: 30, pointKw: 300, plugs: ['ccs'], tariff: kwh049 });
    expect(e.powerKw).toBe(50);
  });

  it('frais de session, temps de charge et palier après 60 min ; HT majoré de 20 %', () => {
    const t = parseTariff('0.50 € par KWh + 0.025 € par minute la 1ère heure + 0.10 € par minute au-delà de 60 minutes');
    const c = costOf(t, 10, 90)!;
    expect(c.energy).toBeCloseTo(5);
    expect(c.time).toBeCloseTo(60 * 0.025 + 30 * 0.1);
    const ht = costOf(parseTariff('Frais de lancement de la charge : 0,5 € H Frais de consommation énergie : 0,42 € HT / kWh'), 10, 30)!;
    expect(ht.total).toBeCloseTo((0.5 + 4.2) * 1.2);
  });

  it('prix inconnu : durée et kWh quand même, coût null', () => {
    const e = estimateCharge({ vehicle: v('peugeot-e208'), socPercent: 40, pointKw: 7.4, plugs: ['t2'], tariff: parseTariff('Grille tarifaire en ligne') });
    expect(e.unknownPrice).toBe(true);
    expect(e.cost).toBeNull();
    expect(e.kWh).toBeGreaterThan(18);
    expect(e.minutes).toBeGreaterThan(100);
  });

  it('gratuit : coût 0', () => {
    expect(estimateCharge({ vehicle: null, socPercent: null, pointKw: 22, plugs: ['t2'], tariff: parseTariff('gratuit') }).cost).toBe(0);
  });

  it('sans véhicule ni % : profil générique et 20 % supposés, signalés', () => {
    const e = estimateCharge({ vehicle: null, socPercent: null, pointKw: 0, plugs: ['t2'], tariff: kwh049 });
    expect(e.assumedVehicle && e.assumedSoc && e.assumedPower).toBe(true);
    expect(e.fromSoc).toBe(20);
    expect(e.toSoc).toBe(80);
  });

  it('déjà à 85 % : on vise +10 % (jamais une estimation négative)', () => {
    const e = estimateCharge({ vehicle: v('mg4-64'), socPercent: 85, pointKw: 11, plugs: ['t2'], tariff: kwh049 });
    expect(e.toSoc).toBe(95);
    expect(e.kWh).toBeGreaterThan(0);
  });

  it('seulement une pénalité d’occupation publiée : estimation partielle', () => {
    const e = estimateCharge({ vehicle: null, socPercent: 20, pointKw: 22, plugs: ['t2'], tariff: parseTariff("6.0€ par heure d'occupation hors charge") });
    expect(e.partial).toBe(true);
  });
});

describe('progressAt (suivi en direct)', () => {
  const input = { vehicle: v('renault-megane-60'), socPercent: 20, pointKw: 50, plugs: ['ccs' as const], tariff: kwh049 };
  it('monotone, cohérent avec l’estimation, terminé à l’heure prévue', () => {
    const e = estimateCharge(input);
    const p0 = progressAt(input, 0);
    const p1 = progressAt(input, e.minutes / 2);
    const p2 = progressAt(input, e.minutes + 1);
    expect(p0.soc).toBe(20);
    expect(p0.kWh).toBe(0);
    expect(p1.soc).toBeGreaterThan(40);
    expect(p1.soc).toBeLessThan(80);
    expect(p1.remainingMin).toBeCloseTo(e.minutes / 2, -1);
    expect(p2.done).toBe(true);
    expect(p2.soc).toBe(80);
    expect(p2.kWh).toBeCloseTo(e.kWh, 0);
    expect(p2.cost).toBeCloseTo(e.cost!, 0);
  });
});

describe('utilitaires', () => {
  it('isDc / powerAt / durationLabel', () => {
    expect(isDc(150, ['ccs'])).toBe(true);
    expect(isDc(22, ['t2'])).toBe(false);
    expect(isDc(22, ['t2', 'chademo'])).toBe(false);
    expect(isDc(0, ['ccs'])).toBe(true);
    expect(powerAt(100, 30, true)).toBe(100);
    expect(powerAt(100, 80, true)).toBeCloseTo(45);
    expect(powerAt(11, 80, false)).toBe(11);
    expect(durationLabel(42)).toBe('42 min');
    expect(durationLabel(65)).toBe('1 h 05');
  });
  it('au moins 25 modèles, valeurs plausibles et identifiants uniques', () => {
    expect(VEHICLES.length).toBeGreaterThanOrEqual(25);
    expect(new Set(VEHICLES.map((x) => x.id)).size).toBe(VEHICLES.length);
    for (const m of VEHICLES) {
      expect(m.batteryKWh).toBeGreaterThan(20);
      expect(m.batteryKWh).toBeLessThan(120);
      expect(m.consumptionKWhPer100).toBeGreaterThan(10);
      expect(m.maxAcKW).toBeGreaterThan(3);
      expect(m.plugs.length).toBeGreaterThan(0);
    }
  });
});

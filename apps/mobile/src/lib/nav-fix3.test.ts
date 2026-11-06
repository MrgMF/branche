// Consolidation du guidage : proposition de trajet plus rapide (validité, tracé coupé), noms de bornes propres.
import { describe, expect, it } from 'vitest';
import { lineFrom, OFFER_ROUTE_ID, offerAlt, offerStillValid, routeTolerance } from './guidance';
import { cumulative, type LonLat } from './navigation';
import { navName, tidyCaps } from './stations';
import { fr } from '../i18n/fr';

// Tronc commun vers le nord (≈ 1,1 km), puis bifurcation : le trajet proposé part vers l'est.
const trunk: LonLat[] = [
  [2.3, 48.75],
  [2.3, 48.755],
  [2.3, 48.76],
];
const offerLine: LonLat[] = [...trunk, [2.31, 48.76], [2.32, 48.76]];
const offer = { route: { geometry: offerLine }, gainS: 300 };

describe('1. proposition plus rapide : toujours sur le trajet proposé ?', () => {
  it('sur le tronc commun (écart faible) : valable', () => {
    expect(offerStillValid({ lat: 48.7525, lon: 2.3002, accuracy: 8 }, offer)).toBe(true);
  });
  it('bifurcation dépassée (tout droit au lieu de tourner, > tolérance) : retirée', () => {
    expect(offerStillValid({ lat: 48.7625, lon: 2.3, accuracy: 8 }, offer)).toBe(false);
  });
  it('position trop imprécise (> 100 m) : pas de verdict, l’offre reste', () => {
    expect(offerStillValid({ lat: 48.7625, lon: 2.3, accuracy: 150 }, offer)).toBe(true);
  });
  it('tolérance identique à la détection hors itinéraire (précision comprise)', () => {
    expect(routeTolerance(null)).toBe(50);
    expect(routeTolerance(5)).toBe(45);
    expect(routeTolerance(200)).toBe(90);
  });
});

describe('2. tracé de la proposition coupé à la position actuelle', () => {
  it('ne dessine que la partie à venir, depuis la projection de la position', () => {
    const p = { lat: 48.7575, lon: 2.3001 };
    const cut = lineFrom(offerLine, p);
    expect(cut[0]![1]).toBeCloseTo(48.7575, 4);
    expect(cut[0]![0]).toBeCloseTo(2.3, 6);
    expect(cut.slice(1)).toEqual(offerLine.slice(2));
    const total = cumulative(offerLine).at(-1)!;
    expect(cumulative(cut).at(-1)!).toBeLessThan(total - 700);
  });
  it('offerAlt(offre, position) : identifiant propre (style distinct du tronçon parcouru) et tracé coupé', () => {
    const [a] = offerAlt(offer, { lat: 48.7575, lon: 2.3 });
    expect(a!.id).toBe(OFFER_ROUTE_ID);
    expect(a!.coords.length).toBe(4);
    expect(a!.label).toBe('−5 min');
    // Sans position : tracé complet (rétrocompatible).
    expect(offerAlt(offer)[0]!.coords).toEqual(offerLine);
  });
});

describe('3. voix du recalcul', () => {
  it('« Recalcul » à la détection, « Nouvel itinéraire » réservé au succès', () => {
    expect(fr.voice.rerouting).toBe('Recalcul de l’itinéraire.');
    expect(fr.voice.newRoute).toBe('Nouvel itinéraire.');
  });
});

describe('5. noms de bornes : jamais le nom IRVE brut en capitales', () => {
  it('capitales → casse de titre ; nom déjà propre inchangé', () => {
    expect(tidyCaps("L'HAY LES ROSES")).toBe("L'Hay les Roses");
    expect(tidyCaps('STATION DE RECHARGE SDCC 18 RUE DE LA PAIX')).toBe('Station de Recharge SDCC 18 Rue de la Paix');
    expect(tidyCaps('Metropolis - Express - Antony')).toBe('Metropolis - Express - Antony');
    expect(tidyCaps('ZI')).toBe('ZI');
  });
  it('navName : nom propre de la borne', () => {
    expect(navName({ n: "L'HAY LES ROSES", o: 'Op', a: '1 rue X 94240' })).toBe("L'Hay les Roses");
  });
});

describe('mineur : bretelle d’accès', () => {
  it('« prendre la bretelle », pas une insertion', () => {
    expect(fr.instr.ramp({ towards: 'A86' })).toBe('Prenez la bretelle vers A86');
    expect(fr.guidance.maneuver.ramp).toBe('bretelle');
  });
});

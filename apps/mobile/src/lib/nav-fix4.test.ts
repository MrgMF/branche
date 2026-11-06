// Finitions navigation (nav4) : bretelles Valhalla (17/18/19) et noms de bornes propres (sigles, article de commune).
import { describe, expect, it } from 'vitest';
import { parseValhallaTrip } from './valhallaParse';
import { tidyCaps } from './stations';

describe('bretelles Valhalla : types 17/18/19 → manœuvre « ramp »', () => {
  const shape = 'o~a_|AsyfnCwB_E{AeC';
  const trip = {
    status: 0,
    summary: { time: 120, length: 2, has_toll: false, has_highway: true },
    legs: [
      {
        shape,
        maneuvers: [
          { type: 1, length: 0.5, begin_shape_index: 0, street_names: ['D1'] },
          { type: 18, length: 0.5, begin_shape_index: 1, bearing_before: 10, bearing_after: 40, street_names: ['Bretelle'] }, // kRampRight
          { type: 19, length: 0.5, begin_shape_index: 2, bearing_before: 40, bearing_after: 10, sign: { exit_toward_elements: [{ text: 'A6' }] } }, // kRampLeft
          { type: 17, length: 0.5, begin_shape_index: 2, bearing_before: 10, bearing_after: 12 }, // kRampStraight
          { type: 4, length: 0, begin_shape_index: 3 },
        ],
      },
    ],
  };

  it('toutes mappées sur « ramp », l’angle fixe le côté (positif = droite)', () => {
    const { steps } = parseValhallaTrip(trip);
    const ramps = steps.filter((s) => s.maneuver === 'ramp');
    expect(ramps).toHaveLength(3);
    expect(ramps[0]!.angle).toBe(30); // 18 : à droite
    expect(ramps[0]!.instruction).toBe('Prenez la bretelle sur Bretelle');
    expect(ramps[1]!.angle).toBe(-30); // 19 : à gauche
    expect(ramps[1]!.instruction).toBe('Prenez la bretelle vers A6');
    expect(ramps[2]!.angle).toBe(2); // 17 : tout droit
  });
});

describe('tidyCaps : sigles conservés, article de commune capitalisé', () => {
  it('sigles ≤ 4 lettres tout en majuscules gardés (sauf petits mots), le reste en casse de titre', () => {
    expect(tidyCaps('SDE 76')).toBe('SDE 76');
    expect(tidyCaps('ZAC')).toBe('ZAC');
    expect(tidyCaps('PARKING EDF')).toBe('Parking EDF');
    // Non-régression : un mot courant ≤ 4 lettres avec voyelle reste un mot (RUE → Rue), un sigle sans voyelle est gardé.
    expect(tidyCaps('STATION DE RECHARGE SDCC 18 RUE DE LA PAIX')).toBe('Station de Recharge SDCC 18 Rue de la Paix');
    expect(tidyCaps("L'HAY LES ROSES")).toBe("L'Hay les Roses");
  });

  it('article de commune : capitale en tête et après un séparateur « - »', () => {
    expect(tidyCaps('la Seyne-sur-Mer')).toBe('La Seyne-sur-Mer');
    expect(tidyCaps('Parking - la Poste')).toBe('Parking - La Poste');
    // Nom déjà propre inchangé.
    expect(tidyCaps('Metropolis - Express - Antony')).toBe('Metropolis - Express - Antony');
  });
});

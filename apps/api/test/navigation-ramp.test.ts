// Bretelles Valhalla (enum DirectionsLeg.Maneuver.Type) : 17 kRampStraight, 18 kRampRight, 19 kRampLeft → « ramp ».
import { describe, expect, it } from 'vitest';
import { parseValhallaTrip, valhallaManeuver } from '../src/navigation/route.js';

describe('route.ts : manœuvres bretelle', () => {
  it('17/18/19 → « ramp » (23/24 restent keep-left/right)', () => {
    expect(valhallaManeuver(17)).toBe('ramp');
    expect(valhallaManeuver(18)).toBe('ramp');
    expect(valhallaManeuver(19)).toBe('ramp');
    expect(valhallaManeuver(23)).toBe('keep-right');
    expect(valhallaManeuver(24)).toBe('keep-left');
  });

  it('l’angle (bearing) fixe le côté de l’icône', () => {
    const trip = {
      status: 0,
      summary: { time: 120, length: 2, has_toll: false, has_highway: true },
      legs: [
        {
          shape: 'o~a_|AsyfnCwB_E{AeC',
          maneuvers: [
            { type: 1, length: 0.5, begin_shape_index: 0, street_names: ['D1'] },
            { type: 18, length: 0.5, begin_shape_index: 1, bearing_before: 10, bearing_after: 40, street_names: ['Bretelle'] },
            { type: 19, length: 0.5, begin_shape_index: 2, bearing_before: 40, bearing_after: 10, sign: { exit_toward_elements: [{ text: 'A6' }] } },
            { type: 4, length: 0, begin_shape_index: 3 },
          ],
        },
      ],
    };
    const ramps = parseValhallaTrip(trip).steps.filter((s) => s.maneuver === 'ramp');
    expect(ramps).toHaveLength(2);
    expect(ramps[0]!.angle).toBe(30);
    expect(ramps[1]!.angle).toBe(-30);
    expect(ramps[1]!.instruction).toBe('Prenez la bretelle vers A6');
  });
});

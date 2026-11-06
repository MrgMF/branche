// Consolidation navigation V2 (passe 2) : trajet proposé sur la carte, bascule sans trafic, étape sans double annonce,
// batterie après une étape, session audio de la voix.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  announcementText,
  liveArrivalSoc,
  lostTraffic,
  maneuverVoice,
  OFFER_ROUTE_ID,
  offerAlt,
  socAfterStop,
  socNowEstimate,
  SOC_CHOICES,
  type VehicleLike,
} from './guidance';
import type { LonLat, RouteStep } from './navigation';
import { setLang } from '../i18n';

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
const speakMock = vi.fn();
vi.mock('expo-speech', () => ({ speak: (...a: unknown[]) => speakMock(...a), stop: vi.fn() }));

beforeAll(() => setLang('fr', 'fr-FR'));

const line: LonLat[] = [
  [2.3, 48.75],
  [2.31, 48.75],
  [2.32, 48.76],
];
const step = (maneuver: RouteStep['maneuver'], instruction = ''): RouteStep => ({ instruction, distanceM: 0, lon: 2.3, lat: 48.75, maneuver });

describe('1. trajet plus rapide tracé sur la carte jusqu’à la décision', () => {
  it('tracé proposé avec l’étiquette « −X min »', () => {
    const alts = offerAlt({ route: { geometry: line }, gainS: 290 });
    expect(alts).toEqual([{ id: OFFER_ROUTE_ID, coords: line, label: '−5 min' }]);
  });
  it('aucune proposition (ou décision prise) : rien sur la carte', () => {
    expect(offerAlt(null)).toEqual([]);
    expect(offerAlt(undefined)).toEqual([]);
    expect(offerAlt({ route: { geometry: [line[0]!] }, gainS: 400 })).toEqual([]);
  });
  it('gain inférieur à une minute arrondi à 1', () => {
    expect(offerAlt({ route: { geometry: line }, gainS: 20 })[0]!.label).toBe('−1 min');
  });
});

describe('5. bascule vers Valhalla en cours de guidage', () => {
  it('TomTom avec trafic → Valhalla sans trafic : avertissement', () => {
    expect(lostTraffic({ provider: 'tomtom', traffic: true }, { provider: 'valhalla', traffic: false })).toBe(true);
  });
  it('déjà sans trafic, ou trafic conservé : pas d’avertissement', () => {
    expect(lostTraffic({ provider: 'valhalla', traffic: false }, { provider: 'valhalla', traffic: false })).toBe(false);
    expect(lostTraffic({ provider: 'tomtom', traffic: true }, { provider: 'tomtom', traffic: true })).toBe(false);
    expect(lostTraffic({ provider: null, traffic: false }, { provider: 'valhalla', traffic: false })).toBe(false);
  });
});

describe('6. étape : pas de double annonce', () => {
  const wp = step('waypoint', 'Vous avez atteint votre étape');
  it('niveau proche de l’étape : rien (l’arrivée à l’étape est annoncée à part)', () => {
    expect(maneuverVoice('near', 40, wp)).toBeNull();
  });
  it('approche : « Dans X, vous arrivez à votre étape. »', () => {
    expect(maneuverVoice('mid', 500, wp)).toBe('Dans 500 mètres, vous arrivez à votre étape.');
  });
  it('destination : « Dans X… » à l’approche, rien au niveau proche', () => {
    expect(maneuverVoice('near', 40, step('arrive'))).toBeNull();
    expect(maneuverVoice('far', 800, step('arrive'))).toMatch(/^Dans 800 mètres/);
  });
  it('une manœuvre suivie de près par l’étape n’enchaîne pas « puis vous avez atteint votre étape »', () => {
    const turn = step('turn-right', 'Tournez à droite');
    expect(announcementText('mid', 300, turn, { step: wp, gapM: 60 })).toBe('Dans 300 mètres, tournez à droite.');
    expect(maneuverVoice('mid', 300, turn, { step: wp, gapM: 60 })).toBe('Dans 300 mètres, tournez à droite.');
  });
});

describe('8. reprise après une étape : batterie', () => {
  const v: VehicleLike = { name: 'R5', batteryKWh: 52, consumptionKWhPer100: 15, socPercent: 40, plugs: ['ccs'] };
  const socAfter = (x: VehicleLike, soc: number, m: number) => soc - ((m / 1000) * x.consumptionKWhPer100) / 100 / x.batteryKWh * 100;

  it('sans recharge déclarée : on repart de l’estimation courante, jamais du niveau saisi au départ', () => {
    const est = socNowEstimate(v, socAfter, 30_000, 60);
    expect(est).toBeLessThan(v.socPercent);
    const base = socAfterStop(est, undefined);
    expect(base).toBe(est);
    expect(base).toBeLessThan(v.socPercent);
    // Trajet suivant depuis cette base : batterie à l'arrivée ≤ batterie actuelle, et jamais remontante.
    const v2 = { ...v, socPercent: base };
    const a1 = liveArrivalSoc(v2, socAfter, socNowEstimate(v2, socAfter, 0, 60), 10_000, 600, null);
    const a2 = liveArrivalSoc(v2, socAfter, socNowEstimate(v2, socAfter, 2_000, 60), 8_500, 500, a1);
    expect(a1).toBeLessThanOrEqual(Math.round(base));
    expect(a2).toBeLessThanOrEqual(a1);
  });
  it('recharge déclarée : la batterie repart du niveau déclaré (borné 0–100)', () => {
    expect(socAfterStop(8, 80)).toBe(80);
    expect(socAfterStop(8, 120)).toBe(100);
    expect(socAfterStop(8, Number.NaN)).toBe(8);
    expect(socAfterStop(-3, null)).toBe(0);
  });
  it('choix proposés : cibles de recharge courantes', () => {
    expect([...SOC_CHOICES]).toEqual([50, 60, 70, 80, 90, 100]);
  });
});

describe('2. voix : session audio de guidage', () => {
  it('iOS : session audio système (atténuation de la musique, interruptions gérées)', async () => {
    const voice = await import('./voice');
    expect(voice.SPEECH_AUDIO).toEqual({ useApplicationAudioSession: false });
    voice.setMuted(false);
    voice.speak('Tournez à droite.', 'maneuver');
    expect(speakMock).toHaveBeenCalledTimes(1);
    expect(speakMock.mock.calls[0]![1]).toMatchObject({ useApplicationAudioSession: false, language: 'fr-FR' });
    voice.stopSpeaking();
  });
});

describe('guidage sur ordinateur : caméra dans la zone libre', () => {
  it('≥ 768 px : véhicule décalé à gauche de la colonne de boutons ; mobile : centré', async () => {
    const { followOffsetFor, GUIDANCE_ACTIONS_W } = await import('./guidance');
    expect(followOffsetFor(1280, 800)).toEqual({ x: -GUIDANCE_ACTIONS_W / 2, y: 144 });
    expect(followOffsetFor(390, 844)).toEqual({ x: 0, y: 150 });
    expect(followOffsetFor(844, 390).x).toBeLessThan(0);
  });
});

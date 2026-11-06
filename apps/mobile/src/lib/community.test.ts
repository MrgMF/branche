import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./config', () => ({ API_URL: 'http://api.test', DATA_URL: '', SITE_URL: '', DEV_HOSTS: [] }));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { flushCheckins, pendingCheckins, sendCheckin } from './community';

const offline = () => vi.fn(async () => Promise.reject(new TypeError('Failed to fetch')));
const online = (status = 201) => vi.fn(async () => new Response('{}', { status }));

beforeEach(async () => {
  await AsyncStorage.removeItem('branche.checkins.queue.v1');
});
afterEach(() => vi.unstubAllGlobals());

describe('retours communautaires hors ligne', () => {
  it('hors ligne : mis en file locale, puis renvoyé au retour du réseau (dans l’ordre)', async () => {
    vi.stubGlobal('fetch', offline());
    expect(await sendCheckin({ stationId: 'A', ok: true, pricePaid: 9.8 })).toBe('queued');
    expect(await sendCheckin({ stationId: 'B', ok: false })).toBe('queued');
    expect(await pendingCheckins()).toBe(2);
    expect(await flushCheckins()).toBe(0); // toujours hors ligne : rien de perdu
    expect(await pendingCheckins()).toBe(2);

    const f = online();
    vi.stubGlobal('fetch', f);
    expect(await flushCheckins()).toBe(2);
    expect(await pendingCheckins()).toBe(0);
    const bodies = f.mock.calls.map((c) => JSON.parse(((c as unknown[])[1] as RequestInit).body as string));
    expect(bodies).toEqual([{ stationId: 'A', ok: true, pricePaid: 9.8 }, { stationId: 'B', ok: false }]);
  });
  it('en ligne : envoyé directement ; refus de l’API (4xx) : abandonné, pas mis en file', async () => {
    vi.stubGlobal('fetch', online());
    expect(await sendCheckin({ stationId: 'A', ok: true })).toBe('sent');
    vi.stubGlobal('fetch', online(400));
    expect(await sendCheckin({ stationId: 'A', ok: true })).toBe('rejected');
    expect(await pendingCheckins()).toBe(0);
  });
  it('erreur serveur (5xx) : gardé pour plus tard', async () => {
    vi.stubGlobal('fetch', online(503));
    expect(await sendCheckin({ stationId: 'A', ok: true })).toBe('queued');
    expect(await pendingCheckins()).toBe(1);
  });
});

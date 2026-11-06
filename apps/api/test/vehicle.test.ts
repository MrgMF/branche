import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { VEHICLE_CATALOG } from '../src/vehicles/catalog.js';
import { AnthropicVehicleIdentifier } from '../src/vehicles/identify.js';
import { makeApp } from './helpers.js';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const IMG = Buffer.alloc(3000, 7).toString('base64');
const post = (a: FastifyInstance, payload: unknown, ip = '198.51.100.7') => a.inject({ method: 'POST', url: '/v1/vehicle/identify', payload: payload as Record<string, unknown>, remoteAddress: ip });

/** Faux fetch Anthropic : enregistre la requête, répond un appel d'outil. */
function fakeAnthropic(input: Record<string, unknown> | null, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    const content = input ? [{ type: 'tool_use', id: 'tu_1', name: 'identifier_vehicule', input }] : [{ type: 'text', text: 'je ne sais pas' }];
    return new Response(JSON.stringify({ content }), { status, headers: { 'content-type': 'application/json' } });
  };
  return { fetch, calls };
}

describe('POST /v1/vehicle/identify', () => {
  it('sans clé : 503 et /v1/meta annonce vehicleIdentify:false', async () => {
    ({ app } = await makeApp());
    const meta = (await app.inject('/v1/meta')).json();
    expect(meta).toMatchObject({ v: 2, features: { vehicleIdentify: false, checkins: true, availability: true } });
    expect(meta).toHaveProperty('routing');
    const r = await post(app, { image: IMG, mediaType: 'image/jpeg' });
    expect(r.statusCode).toBe(503);
    expect(r.json().error.code).toBe('vehicle_identify_unavailable');
  });

  it('avec clé : appel Anthropic (clé serveur, outil imposé, énumération fermée) → identifiant VEHICLES', async () => {
    const f = fakeAnthropic({ vehicleId: 'renault-megane-60', confidence: 'haute' });
    ({ app } = await makeApp({ ANTHROPIC_API_KEY: 'sk-ant-test', ANTHROPIC_MODEL: 'modele-test' }, { fetch: f.fetch }));
    expect((await app.inject('/v1/meta')).json().features.vehicleIdentify).toBe(true);
    const r = await post(app, { image: IMG, mediaType: 'image/jpeg' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.json()).toEqual({ vehicleId: 'renault-megane-60', confidence: 'haute' });
    expect(r.body).not.toContain('sk-ant');
    const call = f.calls[0]!;
    expect(call.url).toBe('https://api.anthropic.com/v1/messages');
    expect((call.init.headers as Record<string, string>)['x-api-key']).toBe('sk-ant-test');
    const sent = JSON.parse(call.init.body as string);
    expect(sent.model).toBe('modele-test');
    expect(sent.tool_choice).toEqual({ type: 'tool', name: 'identifier_vehicule' });
    expect(sent.tools[0].input_schema.properties.vehicleId.enum).toEqual([...VEHICLE_CATALOG.map((v) => v.id), 'inconnu']);
    expect(sent.messages[0].content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: IMG } });
  });

  it('« inconnu », identifiant hors liste ou réponse sans outil → vehicleId null', async () => {
    for (const input of [{ vehicleId: 'inconnu', confidence: 'faible' }, { vehicleId: 'ferrari-f40', confidence: 'haute' }, null]) {
      const f = fakeAnthropic(input);
      const m = await makeApp({ ANTHROPIC_API_KEY: 'k' }, { fetch: f.fetch });
      expect((await post(m.app, { image: IMG, mediaType: 'image/png' })).json().vehicleId).toBeNull();
      await m.app.close();
    }
  });

  it('fournisseur en erreur → 502 identify_failed ; l’image n’apparaît jamais dans les journaux', async () => {
    const lines: string[] = [];
    const f = fakeAnthropic(null, 500);
    ({ app } = await makeApp({ ANTHROPIC_API_KEY: 'k' }, { fetch: f.fetch, logger: { level: 'info', stream: { write: (m) => void lines.push(m) } } }));
    const r = await post(app, { image: IMG, mediaType: 'image/jpeg' });
    expect(r.statusCode).toBe(502);
    expect(r.json().error.code).toBe('identify_failed');
    expect(lines.join('')).not.toContain(IMG.slice(0, 40));
  });

  it('validation : base64 invalide, type non image, image > 1,5 Mo, champ inconnu', async () => {
    ({ app } = await makeApp({}, { vehicleIdentifier: { identify: async () => ({ vehicleId: null, confidence: 'faible' }) } }));
    expect((await post(app, { image: '%%%'.repeat(50), mediaType: 'image/jpeg' })).json().error.code).toBe('invalid_image');
    expect((await post(app, { image: IMG, mediaType: 'application/pdf' })).statusCode).toBe(400);
    expect((await post(app, { image: IMG, mediaType: 'image/jpeg', gps: '48,2' })).statusCode).toBe(400);
    const big = Buffer.alloc(1.6 * 1024 * 1024, 1).toString('base64');
    expect([400, 413]).toContain((await post(app, { image: big, mediaType: 'image/jpeg' })).statusCode);
  });

  it('limite 10 par heure et par IP', async () => {
    ({ app } = await makeApp({}, { vehicleIdentifier: { identify: async () => ({ vehicleId: 'mg4-64', confidence: 'moyenne' }) } }));
    for (let i = 0; i < 10; i++) expect((await post(app, { image: IMG, mediaType: 'image/jpeg' })).statusCode).toBe(200);
    expect((await post(app, { image: IMG, mediaType: 'image/jpeg' })).statusCode).toBe(429);
  });

  it('catalogue serveur = VEHICLES de l’app (mêmes identifiants)', () => {
    const src = readFileSync(new URL('../../mobile/src/lib/vehicle.ts', import.meta.url), 'utf8');
    const ids = [...src.matchAll(/\{ id: '([^']+)', name: '/g)].map((m) => m[1]).filter((id) => id !== 'generique');
    expect(VEHICLE_CATALOG.map((v) => v.id)).toEqual(ids);
  });

  it('identifiant direct (classe) : en-tête anthropic-version', async () => {
    const f = fakeAnthropic({ vehicleId: 'tesla-m3-rwd', confidence: 'moyenne' });
    const r = await new AnthropicVehicleIdentifier('k', 'm', f.fetch).identify(IMG, 'image/webp');
    expect(r).toEqual({ vehicleId: 'tesla-m3-rwd', confidence: 'moyenne' });
    expect((f.calls[0]!.init.headers as Record<string, string>)['anthropic-version']).toBe('2023-06-01');
  });
});

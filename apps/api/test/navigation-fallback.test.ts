import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { makeApp } from './helpers.js';

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
const VALHALLA = fixture('valhalla-route-v2.json');
const KEY = 'tt-secret-KEY-123';
const PARIS = { lat: 48.858, lon: 2.347 };
const VERSAILLES = { lat: 48.8049, lon: 2.1301 };
const json = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'application/json' } });

let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
});

function fetchWith(tomtom: () => Response | Promise<Response>) {
  const calls: string[] = [];
  const fn = async (url: string) => {
    calls.push(url.replace(/key=[^&]+/, 'key=***'));
    if (url.includes('api.tomtom.com')) return tomtom();
    if (url.endsWith('/trace_attributes')) return json('{}', 400);
    if (url.includes('/route')) return json(VALHALLA);
    return new Response('?', { status: 404 });
  };
  return { fn, calls };
}

describe('POST /v1/route — TomTom en panne, repli Valhalla sans trafic', () => {
  it('TomTom HTTP 503 → itinéraire Valhalla, provider valhalla, traffic:false', async () => {
    const f = fetchWith(() => new Response('down', { status: 503 }));
    ({ app } = await makeApp({ TOMTOM_API_KEY: KEY, VALHALLA_URL: 'https://valhalla.interne.example/route' }, { fetch: f.fn }));
    const res = await app.inject({ method: 'POST', url: '/v1/route', payload: { from: PARIS, to: VERSAILLES } });
    expect(res.statusCode).toBe(200);
    const r = res.json();
    expect(r.provider).toBe('valhalla');
    expect(r.traffic).toBe(false);
    expect(r.routes.length).toBeGreaterThan(0);
    expect(f.calls[0]).toContain('api.tomtom.com');
    expect(f.calls[1]).toBe('https://valhalla.interne.example/route');
    expect(res.body).not.toContain(KEY);
  });

  it('TomTom injoignable (erreur réseau) → repli aussi', async () => {
    const f = fetchWith(() => {
      throw new TypeError('fetch failed');
    });
    ({ app } = await makeApp({ TOMTOM_API_KEY: KEY, VALHALLA_URL: 'https://valhalla.interne.example/route' }, { fetch: f.fn }));
    const res = await app.inject({ method: 'POST', url: '/v1/route', payload: { from: PARIS, to: VERSAILLES } });
    expect(res.statusCode).toBe(200);
    expect(res.json().provider).toBe('valhalla');
  });

  it('TomTom fonctionne → pas d’appel Valhalla', async () => {
    const f = fetchWith(() => json(fixture('tomtom-route-v2.json')));
    ({ app } = await makeApp({ TOMTOM_API_KEY: KEY, VALHALLA_URL: 'https://valhalla.interne.example/route' }, { fetch: f.fn }));
    const res = await app.inject({ method: 'POST', url: '/v1/route', payload: { from: PARIS, to: VERSAILLES } });
    expect(res.json().provider).toBe('tomtom');
    expect(f.calls.every((u) => u.includes('api.tomtom.com'))).toBe(true);
  });

  it('production sans VALHALLA_URL : jamais de repli vers le serveur public FOSSGIS (502)', async () => {
    const f = fetchWith(() => new Response('down', { status: 503 }));
    ({ app } = await makeApp({ NODE_ENV: 'production', TOMTOM_API_KEY: KEY }, { fetch: f.fn }));
    const res = await app.inject({ method: 'POST', url: '/v1/route', payload: { from: PARIS, to: VERSAILLES } });
    expect(res.statusCode).toBe(502);
    expect(f.calls.some((u) => u.includes('openstreetmap.de'))).toBe(false);
    expect(f.calls.length).toBe(1);
  });

  it('les deux en panne → 502 route_provider_error', async () => {
    const calls: string[] = [];
    const fn = async (url: string) => {
      calls.push(url);
      return new Response('down', { status: 500 });
    };
    ({ app } = await makeApp({ TOMTOM_API_KEY: KEY, VALHALLA_URL: 'https://valhalla.interne.example/route' }, { fetch: fn }));
    const res = await app.inject({ method: 'POST', url: '/v1/route', payload: { from: PARIS, to: VERSAILLES } });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('route_provider_error');
    expect(calls.length).toBe(2);
  });
});

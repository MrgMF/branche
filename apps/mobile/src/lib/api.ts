import { API_URL } from './config';
import { tr } from '../i18n';

export type SessionStatus = 'awaiting_payment' | 'starting' | 'charging' | 'completed' | 'cancelled' | 'failed';

export interface Session {
  id: string;
  status: SessionStatus;
  stationId: string;
  stationName: string;
  pdcId: string | null;
  checkoutUrl: string;
  demo: boolean;
  priceCentsPerKwh: number;
  feeCents: number;
  preauthCents: number;
  energyWh: number;
  powerKw: number;
  costCents: number;
  totalCents: number;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  error: string | null;
}

export interface ApiConfig {
  priceCentsPerKwh: number;
  feeCents: number;
  preauthCents: number;
  currency: 'eur';
  demo: boolean;
}

export const apiEnabled = () => API_URL.length > 0;

const TIMEOUT_MS = 15000;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new Error(tr().errors.payNet);
  } finally {
    clearTimeout(timer);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (body as { error?: { message?: string } })?.error?.message ?? tr().errors.http(res.status);
    throw new Error(msg);
  }
  return body as T;
}

export const getConfig = () => call<ApiConfig>('/v1/config');

/** Le service gratuit peut mettre jusqu'à ~50 s à se réveiller : plusieurs essais espacés. */
export async function getConfigWithRetry(delays = [0, 4000, 10000, 20000]): Promise<ApiConfig> {
  let last: unknown;
  for (const d of delays) {
    if (d) await new Promise((r) => setTimeout(r, d));
    try {
      return await getConfig();
    } catch (e) {
      last = e;
    }
  }
  throw last;
}
export const createSession = (input: { stationId: string; stationName: string; pdcId?: string; returnUrl: string }) =>
  call<Session>('/v1/sessions', { method: 'POST', body: JSON.stringify(input) });
export const getSession = (id: string) => call<Session>(`/v1/sessions/${encodeURIComponent(id)}`);
export const stopSession = (id: string) => call<Session>(`/v1/sessions/${encodeURIComponent(id)}/stop`, { method: 'POST', body: '{}' });
export const cancelSession = (id: string) => call<Session>(`/v1/sessions/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: '{}' });

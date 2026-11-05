import { API_URL } from './config';

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

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (body as { error?: { message?: string } })?.error?.message ?? `Erreur ${res.status}`;
    throw new Error(msg);
  }
  return body as T;
}

export const getConfig = () => call<ApiConfig>('/v1/config');
export const createSession = (input: { stationId: string; stationName: string; pdcId?: string; returnUrl: string }) =>
  call<Session>('/v1/sessions', { method: 'POST', body: JSON.stringify(input) });
export const getSession = (id: string) => call<Session>(`/v1/sessions/${encodeURIComponent(id)}`);
export const stopSession = (id: string) => call<Session>(`/v1/sessions/${encodeURIComponent(id)}/stop`, { method: 'POST', body: '{}' });
export const cancelSession = (id: string) => call<Session>(`/v1/sessions/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: '{}' });

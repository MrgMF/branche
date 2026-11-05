/** Cache mémoire à expiration, borné (éviction de l'entrée la plus ancienne). */
export class TtlCache<V> {
  private readonly map = new Map<string, { v: V; exp: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number,
    private readonly max = 500,
  ) {}

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.exp <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    return hit.v;
  }

  set(key: string, v: V): void {
    this.map.delete(key);
    if (this.map.size >= this.max) {
      const t = this.now();
      for (const [k, e] of this.map) if (e.exp <= t) this.map.delete(k);
      while (this.map.size >= this.max) {
        const oldest = this.map.keys().next().value;
        if (oldest === undefined) break;
        this.map.delete(oldest);
      }
    }
    this.map.set(key, { v, exp: this.now() + this.ttlMs });
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** fetch avec délai maximal. */
export async function fetchWithTimeout(fetchFn: FetchLike, url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetchFn(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

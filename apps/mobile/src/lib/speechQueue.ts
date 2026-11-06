// File d'annonces vocales (pure, testée) : priorité manœuvre > danger > info, une manœuvre n'est jamais coupée,
// une annonce combinée par position (les parties d'un même passage sont dites en une phrase).

export type Priority = 'maneuver' | 'danger' | 'info';
export const RANK: Record<Priority, number> = { maneuver: 3, danger: 2, info: 1 };

export interface Part {
  text: string;
  priority: Priority;
}

export interface Engine {
  /** Dit le texte ; `done` doit être appelé à la fin (ou en cas d'erreur / d'arrêt). */
  speak(text: string, done: () => void): void;
  stop(): void;
}

interface Item {
  text: string;
  priority: Priority;
  at: number;
}

/** Une info ou un danger en attente plus de 8 s n'a plus de sens : abandonné. */
const STALE_MS = 8000;

/** Combine les parties d'une même position : la plus prioritaire d'abord, doublons retirés. */
export function combine(parts: Part[]): Item | null {
  const seen = new Set<string>();
  const list = parts
    .filter((p) => p.text.trim())
    .filter((p) => (seen.has(p.text) ? false : (seen.add(p.text), true)))
    .sort((a, b) => RANK[b.priority] - RANK[a.priority]);
  if (!list.length) return null;
  const text = list.map((p) => p.text.trim().replace(/([^.!?])$/, '$1.')).join(' ');
  return { text, priority: list[0]!.priority, at: 0 };
}

export class SpeechQueue {
  private current: Item | null = null;
  private queue: Item[] = [];
  private token = 0;
  private guard: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly engine: Engine,
    private readonly now: () => number = Date.now,
    /** Garde-fou si le moteur ne signale jamais la fin (ms par caractère + marge). */
    private readonly maxMs = (text: string) => 2500 + text.length * 90,
  ) {}

  /** Annonce d'une position (une ou plusieurs parties, dites en une seule phrase). */
  announce(parts: Part[]): void {
    const item = combine(parts);
    if (!item) return;
    item.at = this.now();
    const cur = this.current;
    if (!cur) return this.play(item);
    // Une manœuvre en cours n'est jamais coupée ; une info ou un danger cèdent la place à plus prioritaire.
    if (cur.priority !== 'maneuver' && RANK[item.priority] > RANK[cur.priority]) {
      this.token++; // la fin signalée par stop() ne doit pas relancer la file
      this.engine.stop();
      return this.play(item);
    }
    // En attente : une seule manœuvre (la plus récente remplace l'ancienne, périmée), tri par priorité.
    if (item.priority === 'maneuver') this.queue = this.queue.filter((q) => q.priority !== 'maneuver');
    this.queue.push(item);
    this.queue.sort((a, b) => RANK[b.priority] - RANK[a.priority] || a.at - b.at);
  }

  /** Tout arrêter (fin du guidage, voix coupée). */
  clear(): void {
    this.queue = [];
    this.token++;
    if (this.guard) clearTimeout(this.guard);
    this.guard = null;
    if (this.current) this.engine.stop();
    this.current = null;
  }

  get speaking(): string | null {
    return this.current?.text ?? null;
  }

  get pending(): string[] {
    return this.queue.map((q) => q.text);
  }

  private play(item: Item): void {
    const token = ++this.token;
    this.current = item;
    if (this.guard) clearTimeout(this.guard);
    const finish = () => {
      if (token !== this.token) return;
      if (this.guard) clearTimeout(this.guard);
      this.guard = null;
      this.current = null;
      this.next();
    };
    this.guard = setTimeout(finish, this.maxMs(item.text));
    try {
      this.engine.speak(item.text, finish);
    } catch {
      finish();
    }
  }

  private next(): void {
    const t = this.now();
    this.queue = this.queue.filter((q) => q.priority === 'maneuver' || t - q.at < STALE_MS);
    const n = this.queue.shift();
    if (n) this.play(n);
  }
}

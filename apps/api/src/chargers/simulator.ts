import type { ChargerAdapter, ChargerReading, StartParams } from './types.js';

export interface SimulatorOptions {
  powerKw: number;
  /** Facteur d'accélération du temps pour l'énergie. */
  speed: number;
  /** Durée réelle de la rampe de puissance (ms). */
  rampMs?: number;
  now?: () => number;
}

interface SimState {
  startedAt: number;
  stoppedAt: number | null;
  maxEnergyWh: number;
}

/**
 * Borne simulée, calcul paresseux : rien ne tourne en tâche de fond.
 * Puissance P(t) = Pmax × min(t / rampe, 1) ; énergie = ∫P dt × speed.
 */
export class SimulatorCharger implements ChargerAdapter {
  readonly name = 'simulator';
  private readonly sessions = new Map<string, SimState>();
  private readonly rampMs: number;
  private readonly now: () => number;

  constructor(private readonly opts: SimulatorOptions) {
    this.rampMs = opts.rampMs ?? 20_000;
    this.now = opts.now ?? Date.now;
  }

  async start({ sessionId, maxEnergyWh }: StartParams): Promise<void> {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        startedAt: this.now(),
        stoppedAt: null,
        maxEnergyWh: maxEnergyWh ?? Number.POSITIVE_INFINITY,
      });
    }
  }

  /** Oublie une session terminée (libère la mémoire). */
  forget(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  async stop(sessionId: string): Promise<ChargerReading> {
    const s = this.sessions.get(sessionId);
    if (!s) return { energyWh: 0, powerKw: 0 };
    if (s.stoppedAt === null) s.stoppedAt = this.now();
    return this.compute(s);
  }

  async read(sessionId: string): Promise<ChargerReading> {
    const s = this.sessions.get(sessionId);
    if (!s) return { energyWh: 0, powerKw: 0 };
    return this.compute(s);
  }

  private compute(s: SimState): ChargerReading {
    const end = s.stoppedAt ?? this.now();
    const t = Math.max(0, end - s.startedAt);
    const pMax = this.opts.powerKw;
    const ramp = this.rampMs;
    // Intégrale de P(t) en kW·ms.
    const kwMs = t <= ramp ? (pMax * t * t) / (2 * ramp) : (pMax * ramp) / 2 + pMax * (t - ramp);
    const rawWh = (kwMs / 3_600_000) * 1000 * this.opts.speed;
    const capped = rawWh >= s.maxEnergyWh;
    const energyWh = Math.min(rawWh, s.maxEnergyWh);
    const powerKw = s.stoppedAt !== null || capped ? 0 : pMax * Math.min(t / ramp, 1);
    return { energyWh: Math.floor(energyWh), powerKw: Math.round(powerKw * 10) / 10 };
  }
}

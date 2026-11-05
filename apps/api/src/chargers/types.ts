/** Mesure instantanée renvoyée par une borne. */
export interface ChargerReading {
  /** Énergie délivrée depuis le démarrage (Wh). */
  energyWh: number;
  /** Puissance instantanée (kW). */
  powerKw: number;
}

export interface StartParams {
  sessionId: string;
  stationId: string;
  pdcId: string | null;
  /**
   * Limite d'énergie (Wh) au-delà de laquelle la borne doit s'arrêter d'elle-même
   * (dérivée de la pré-autorisation). Les API eMSP/OCPI exposent en général une limite équivalente.
   */
  maxEnergyWh?: number;
}

/**
 * Adaptateur de borne. V1 : simulateur. Plus tard : eMSP marque blanche / OCPI
 * (START_SESSION / STOP_SESSION / sessions pushées par le CPO).
 */
export interface ChargerAdapter {
  readonly name: string;
  start(params: StartParams): Promise<void>;
  stop(sessionId: string): Promise<ChargerReading>;
  read(sessionId: string): Promise<ChargerReading>;
}

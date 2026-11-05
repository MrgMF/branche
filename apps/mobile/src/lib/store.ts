// Petit état partagé entre écrans (pas de persistance en V1).
import type { Station } from './stations';

export interface DirectCharge {
  station: { id: string; name: string; operator?: string; tel?: string };
  operatorName: string;
  url: string;
  startedAt: number;
}

let stations: Station[] = [];
let current: Station | null = null;
let direct: DirectCharge | null = null;

export const store = {
  setStations: (list: Station[]) => {
    stations = list;
  },
  stations: () => stations,
  setCurrent: (s: Station | null) => {
    current = s;
  },
  current: () => current,
  setDirect: (d: DirectCharge | null) => {
    direct = d;
  },
  direct: () => direct,
};

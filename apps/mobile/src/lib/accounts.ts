// « Mes comptes de recharge » et « Mes badges » : seulement des mentions locales (« compte X connecté le … »,
// « badge Chargemap Pass »). Aucun identifiant, mot de passe, numéro de badge ni carte : la connexion se fait sur
// le site officiel de l'opérateur, dans le navigateur intégré, qui garde lui-même sa session.
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface ConnectedAccount {
  operatorKey: string;
  name: string;
  connectedAt: number;
}
export interface Wallet {
  accounts: ConnectedAccount[];
  badges: string[];
}

/** Badges d'itinérance courants en France (nom seulement). */
export const BADGES = [
  'Chargemap Pass',
  'Shell Recharge',
  'Freshmile',
  'Izivia Pass',
  'Plugsurfing',
  'Electromaps',
  'Mobilize Charge Pass',
  'Free2Move Charge',
  'TotalEnergies Charge Pass',
  'Ulys',
  'Bip&Go',
];

const KEY = 'branche.wallet.v1';
let cache: Wallet | null = null;

export async function loadWallet(): Promise<Wallet> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const w = raw ? (JSON.parse(raw) as Partial<Wallet>) : {};
    cache = { accounts: Array.isArray(w.accounts) ? w.accounts : [], badges: Array.isArray(w.badges) ? w.badges : [] };
  } catch {
    cache = { accounts: [], badges: [] };
  }
  return cache;
}

async function save(w: Wallet): Promise<Wallet> {
  cache = w;
  await AsyncStorage.setItem(KEY, JSON.stringify(w)).catch(() => undefined);
  return w;
}

export async function markConnected(operatorKey: string, name: string): Promise<Wallet> {
  const w = await loadWallet();
  return save({ ...w, accounts: [...w.accounts.filter((a) => a.operatorKey !== operatorKey), { operatorKey, name, connectedAt: Date.now() }] });
}
export async function forgetAccount(operatorKey: string): Promise<Wallet> {
  const w = await loadWallet();
  return save({ ...w, accounts: w.accounts.filter((a) => a.operatorKey !== operatorKey) });
}
export async function setBadges(badges: string[]): Promise<Wallet> {
  const w = await loadWallet();
  return save({ ...w, badges: [...new Set(badges.map((b) => b.trim()).filter(Boolean))] });
}

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');

/** Badges de l'utilisateur acceptés selon la liste de l'opérateur (comparaison tolérante). */
export function acceptedBadges(mine: string[], accepted: string[] | null | undefined): string[] {
  if (!accepted?.length) return [];
  const acc = accepted.map(fold);
  return mine.filter((b) => {
    const f = fold(b);
    return acc.some((a) => a.includes(f) || f.includes(a));
  });
}

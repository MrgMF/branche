// Analyse du champ libre IRVE `tarification` (texte saisi par chaque opérateur) — fonction pure, testée dans tariff.test.ts.
import { tr } from '../i18n';
import { num, perKwh as perKwhFmt, perMin as perMinFmt } from '../i18n/format';
// But : afficher AVANT de payer un prix lisible (€/kWh, €/min, frais de session, occupation) et estimer le coût.
// Prudence : on n'invente rien. Si le texte est ambigu, le résultat le dit (guessedUnit, kind 'unknown').

export interface Tariff {
  kind: 'free' | 'priced' | 'link' | 'unknown';
  /** € par kWh (valeur la plus élevée si plusieurs plages horaires). */
  perKwh?: number;
  /** Plus bas €/kWh si le tarif varie selon l'heure. */
  perKwhMin?: number;
  /** € par minute PENDANT la charge. */
  perMin?: number;
  /** Prix à la minute plus élevé au-delà de N minutes de charge (« 0,10 €/min au-delà de 60 min »). */
  perMinLater?: { afterMin: number; perMin: number };
  /** Frais fixes par session (connexion, lancement, prix de départ). */
  session?: number;
  /** Occupation / stationnement après la fin de charge : € par minute, à partir de `afterMin` minutes après la fin. */
  idle?: { perMin: number; afterMin: number };
  /** Prix annoncés hors taxes (TVA 20 % en plus). */
  ht: boolean;
  /** Tarif différent selon l'heure de la journée. */
  varies: boolean;
  /** Montant sans unité (« 0,45 ») interprété comme €/kWh. */
  guessedUnit: boolean;
  url?: string;
  /** Informations utiles quand aucun montant n'est publié. */
  notes: string[];
  raw: string;
  /** Gratuité déclarée (champ IRVE `gratuit` ou texte) mais contredite par la borne : ≥ 50 kW ou moyen de paiement déclaré. */
  freeDoubtful?: true;
}

/** Données de la borne qui permettent de juger une gratuité déclarée. */
export interface FreeContext {
  /** Gratuité déclarée dans la base IRVE (champ `gratuit`). */
  free?: boolean;
  /** Puissance maximale de la station (kW). */
  kw?: number;
  /** Moyens de paiement déclarés dans l'IRVE. */
  pay?: readonly string[];
}

// Un moyen de paiement déclaré contredit une recharge gratuite (le badge sert souvent d'accès, pas de paiement : exclu).
const PAYING = new Set(['cb', 'sans_contact', 'acte', 'qr_dynamique', 'site_web', 'liquide']);

/**
 * Gratuité crédible : ni charge rapide (≥ 50 kW, jamais gratuite en pratique), ni moyen de paiement déclaré.
 * Sinon la mention IRVE est affichée « à vérifier » et le coût reste inconnu.
 */
export function freeCredible(c: Pick<FreeContext, 'kw' | 'pay'>): boolean {
  return !((c.kw ?? 0) >= 50 || (c.pay ?? []).some((p) => PAYING.has(p)));
}

type Kind = 'kwh' | 'min' | 'hour' | 'session' | 'none';
interface Amount {
  v: number;
  kind: Kind;
  idle: boolean;
  session: boolean;
  threshold?: { min: number; grace: boolean };
}

const IDLE = /occupation|hors charge|stationnement|parking|immobilisation|est charg[ée]e?|charg[ée]e? mais|v[ée]hicule charg[ée]|fin de (la )?charge|charge termin[ée]e|apr[eè]s la (re)?charge|en dehors des sessions|une fois charg/;
const SESSION = /connexion|activation|frais de (session|lancement|d[ée]marrage|mise en charge|service)|prix de d[ée]part|co[uû]t fixe|frais fixes?|forfait|par session|la session|de session|par recharge|droit d'acc[eè]s|lancement de la charge/;

function normalize(raw: string): string {
  let t = raw
    .replace(/\u00e2\u201a\u00ac|\u0080/g, '\u20ac') // mojibake fréquent du signe euro (Windows-1252 / UTF-8 mal décodé)
    .replace(/[\u00a0\u2000-\u200b\u202f\u205f\u3000]/g, ' ')
    .replace(/[\u2019`\u00b4]/g, "'")
    .toLowerCase();
  t = t.replace(/(\d),(\d)/g, '$1.$2');
  t = t.replace(/\beuros?\b|\beur\b/g, '€');
  // « 0,39E/kWh », « 1E de coût », « 0,399 e/ kwh »
  t = t.replace(/(\d)\s?e(?![a-zà-ÿ])/g, '$1€');
  return t.replace(/\s+/g, ' ').trim();
}

// Séparateurs de clauses : le contexte d'un montant ne déborde pas sur la clause voisine.
const CLAUSE = /[,;|+(]|\. | puis | lorsque | quand | co[uû]t de /;

const toMin = (n: number, unit: string) => (/^h/.test(unit) ? n * 60 : n);

export function parseTariff(raw: string | null | undefined, opts: FreeContext = {}): Tariff {
  const src = (raw ?? '').trim();
  const out: Tariff = { kind: 'unknown', ht: false, varies: false, guessedUnit: false, notes: [], raw: src };
  const url = src.match(/https?:\/\/[^\s,;)]+/i)?.[0];
  if (url) out.url = url;
  let t = normalize(src.replace(/https?:\/\/[^\s,;)]+/gi, ' '));

  // 0. Tarif exporté en JSON par certains opérateurs (souvent tronqué : lecture par expressions régulières)
  if (/"energyprice"\s*:/.test(t)) {
    const g = (k: string) => Number(t.match(new RegExp(`"${k}"\\s*:\\s*([\\d.]+)`))?.[1] ?? NaN);
    const e = g('energyprice');
    const f = g('fixedprice');
    const osf = t.match(/"matrixosf"\s*:\s*\[\s*\{[^}]*?"price"\s*:\s*([\d.]+)[^}]*?"graceperiodbeforeosf"\s*:\s*(\d+)/);
    if (Number.isFinite(e) && e > 0 && e <= 2.5) out.perKwh = e;
    if (Number.isFinite(f) && f > 0 && f <= 30) out.session = f;
    if (osf && Number(osf[1]) > 0) out.idle = { perMin: Number(osf[1]), afterMin: Math.round(Number(osf[2]) / 60) };
    if (out.perKwh !== undefined || out.session !== undefined || out.idle) out.kind = 'priced';
    return out;
  }

  // 1. Plages horaires → retirées (leurs nombres ne sont pas des prix)
  let bands = 0;
  const band = (re: RegExp) => {
    t = t.replace(re, () => {
      bands++;
      return ' ¤ ';
    });
  };
  band(/entre \d{1,2}(?:[:h]\d{0,2})? ?(?:et|à|a|-) ?\d{1,2}(?:[:h]\d{0,2})?/g);
  band(/de \d{1,2}h\d{0,2} ?(?:à|a|-) ?\d{1,2}h\d{0,2}/g);
  band(/from \d{1,2} ?(?:am|pm)? ?\/ ?\d{1,2} ?(?:am|pm)/g);
  band(/\d{1,2}h\d{0,2} ?(?:-|à|a) ?\d{1,2}h\d{0,2}/g);
  t = t.replace(/\d{1,2}:\d{2}/g, ' ');

  // 2. Seuils de temps → marqueurs sans chiffres (§a§, §b§…)
  const thresholds: { min: number; grace: boolean }[] = [];
  const mark = (min: number, grace: boolean) => {
    thresholds.push({ min, grace });
    return ` §${String.fromCharCode(97 + thresholds.length - 1)}§ `;
  };
  const U = '(min(?:utes?)?|mn|h(?:eures?)?)\\b';
  t = t.replace(new RegExp(`(\\d+) ?${U} (?:de parking gratuit|de gratuit[ée]|gratuites?|de p[ée]riode de gr[aâ]ce|p[ée]riode de gr[aâ]ce|apr[eè]s la (?:re)?charge|apr[eè]s la fin)`, 'g'), (_m, n, u) => mark(toMin(Number(n), u), true));
  t = t.replace(new RegExp(`(?:au-del[aà] de|au del[aà] de|apr[eè]s?|pass[ée]e?s?|d[eè]s la|[àa] partir de) (?:les |la |le )?(\\d+) ?(?:[eè]re |premi[eè]res? )?${U}`, 'g'), (_m, n, u) => mark(toMin(Number(n), u), false));
  t = t.replace(/(?:la |les )?(?:1[eè]re|premi[eè]re) heure/g, ' ');

  // 3. Montants
  const NUM = /(\d+(?:\.\d+)?)/g;
  const UNIT = /^\s*(cts?|centimes?|c€)?\s*(€)?\s*(ht|ttc)?\s*(?:\/|par |le |la |à la |a la |l'|au |à l'|a l'|de l'|d'|pour )?\s*(?:€\s*)?(?:(ht|ttc)\s*)?(?:\/\s*)?(kwh|kw\b|minutes?|minu\w*|min\b|mn\b|heures?|h\b|session|recharge)?/;
  const matches = [...t.matchAll(NUM)];
  const amounts: Amount[] = [];
  let prevEnd = 0;
  matches.forEach((m, i) => {
    const start = m.index ?? 0;
    const numEnd = start + m[0].length;
    const u = UNIT.exec(t.slice(numEnd)) ?? [''];
    const unitEnd = numEnd + u[0].length;
    const nextStart = matches[i + 1]?.index ?? t.length;
    const afterFull = t.slice(unitEnd, Math.max(unitEnd, nextStart));
    const after = afterFull.split(CLAUSE)[0] ?? '';
    const betweenPrev = t.slice(prevEnd, start);
    const before = betweenPrev.split(CLAUSE).pop() ?? '';
    prevEnd = unitEnd;
    let v = Number(m[1]);
    if (!Number.isFinite(v)) return;
    const cents = !!u[1];
    if (cents && v >= 1) v = v / 100; // « 49 cts » ; « 0,35 cts » = 0,35 € (saisie fréquente)
    const unitWord = (u[5] ?? '') || (/kwh|\bkw\b/.test(after) ? 'kwh' : '');
    let kind: Kind = 'none';
    if (/^kw/.test(unitWord)) kind = 'kwh';
    else if (/^m/.test(unitWord)) kind = 'min';
    else if (/^h/.test(unitWord)) kind = 'hour';
    else if (/session|recharge/.test(unitWord)) kind = 'session';
    // « 60min gratuit », « 22h » : une durée, pas un prix (ni €, ni « / », ni « par »)
    if ((kind === 'min' || kind === 'hour') && !u[2] && !/\/|par |la |le /.test(u[0])) kind = 'none';
    const ctx = `${before} ${u[0]} ${after}`;
    const marks = [...`${betweenPrev} ${afterFull.split(/[,;|]/)[0]}`.matchAll(/§([a-z])§/g)].map((x) => thresholds[x[1].charCodeAt(0) - 97]).filter(Boolean);
    const th = marks[marks.length - 1];
    // « Frais de lancement : 0,5 € H » (HT tronqué) : le libellé de frais fixes l'emporte sur une unité de temps douteuse
    const isSession = kind === 'session' || (kind === 'none' && SESSION.test(ctx)) || (kind !== 'kwh' && SESSION.test(before) && !/\/|par /.test(u[0]));
    // « 2 € + 0,59 €/kWh » : montant en euros sans unité suivi d'un prix au kWh → frais de session
    const plusNext = kind === 'none' && !!u[2] && /^\s*\+/.test(afterFull) && /kwh|kw\b/.test(t.slice(nextStart, nextStart + 20));
    amounts.push({ v, kind: isSession || plusNext ? 'session' : kind, idle: IDLE.test(ctx) || !!th?.grace, session: isSession || plusNext, threshold: th });
  });

  if (/ht(?![a-z])/.test(t) && !/ttc/.test(t)) out.ht = true;

  const kwh = amounts.filter((a) => a.kind === 'kwh' && a.v > 0.005 && a.v <= 2.5).map((a) => a.v);
  const timeFees = amounts.filter((a) => (a.kind === 'min' || a.kind === 'hour') && a.v > 0);
  const perMinOf = (a: Amount) => (a.kind === 'hour' ? a.v / 60 : a.v);
  const charging = timeFees.filter((a) => !a.idle && perMinOf(a) <= 2);
  const idle = timeFees.filter((a) => a.idle && perMinOf(a) <= 2);
  const sessions = amounts.filter((a) => a.kind === 'session' && a.v > 0 && a.v <= 30).map((a) => a.v);
  const r4 = (x: number) => Math.round(x * 10000) / 10000;

  if (kwh.length) {
    out.perKwh = Math.max(...kwh);
    if (Math.min(...kwh) !== out.perKwh && bands > 0) out.perKwhMin = Math.min(...kwh);
  }
  const plain = charging.filter((a) => !a.threshold);
  const later = charging.filter((a) => a.threshold && !a.threshold.grace);
  if (plain.length) out.perMin = r4(Math.max(...plain.map(perMinOf)));
  if (later.length) {
    const l = later.reduce((x, y) => (perMinOf(y) > perMinOf(x) ? y : x));
    out.perMinLater = { afterMin: l.threshold!.min, perMin: r4(perMinOf(l)) };
    if (out.perMin === undefined) out.perMin = 0;
  }
  if (idle.length) {
    const i = idle.reduce((x, y) => (perMinOf(y) > perMinOf(x) ? y : x));
    out.idle = { perMin: r4(perMinOf(i)), afterMin: i.threshold?.min ?? 0 };
  }
  if (sessions.length) out.session = Math.max(...sessions);

  // Montant seul sans unité (« 0,45 », « 0.50 € ») : très probablement €/kWh, signalé comme supposé.
  if (out.perKwh === undefined && out.perMin === undefined && out.session === undefined && !out.idle) {
    const bare = amounts.filter((a) => a.kind === 'none' && !a.session);
    const rest = t.replace(/[\d.€\s]|ttc|ht/g, '');
    if (bare.length === 1 && bare[0].v >= 0.05 && bare[0].v <= 1.5 && rest.length <= 3) {
      out.perKwh = bare[0].v;
      out.guessedUnit = true;
    }
  }

  const priced = out.perKwh !== undefined || out.perMin !== undefined || out.session !== undefined || !!out.idle;
  if (priced) {
    out.kind = 'priced';
    const kinds = [kwh, charging.map(perMinOf), sessions];
    out.varies = bands > 0 && (kinds.some((k) => new Set(k).size > 1) || amounts.some((a) => a.kind === 'session') && bands > 1);
    return out;
  }
  if (opts.free || /^(gratuit|gratuite|free|0 ?€|recharge gratuite)\.?$/.test(t)) {
    if (freeCredible(opts)) {
      out.kind = 'free';
      return out;
    }
    out.freeDoubtful = true;
  }
  if (/gratuit/.test(t) && !out.freeDoubtful) out.notes.push(tr().tariff.notePartialFree);
  if (out.url) out.kind = 'link';
  if (/kwh/.test(t)) out.notes.push(tr().tariff.noteKwh);
  if (/minute|\bmin\b|dur[ée]e|temps/.test(t)) out.notes.push(tr().tariff.noteTime);
  if (/connexion|session/.test(t)) out.notes.push(tr().tariff.noteSession);
  if (/abonn/.test(t)) out.notes.push(tr().tariff.noteSubscribers);
  return out;
}

const eur = (x: number, digits = 2) => `${num(x, digits, digits)} €`;
const perKwhText = perKwhFmt;
const perMinText = perMinFmt;

export function describeTariff(t: Tariff): string[] {
  const T = tr().tariff;
  if (t.kind === 'free') return [T.free];
  if (t.freeDoubtful) return [T.freeDoubtful];
  if (t.kind !== 'priced') return [];
  const lines: string[] = [];
  if (t.perKwh !== undefined) {
    lines.push(
      t.perKwhMin !== undefined ? T.energyRange(perKwhText(t.perKwhMin), perKwhText(t.perKwh)) : T.energy(perKwhText(t.perKwh), t.guessedUnit),
    );
  }
  if (t.perMin) lines.push(T.time(perMinText(t.perMin)));
  if (t.perMinLater) lines.push(T.later(t.perMinLater.afterMin, perMinText(t.perMinLater.perMin)));
  if (t.session) lines.push(T.session(eur(t.session)));
  if (t.idle) lines.push(T.idle(perMinText(t.idle.perMin), t.idle.afterMin));
  if (t.ht) lines.push(T.ht);
  if (t.varies) lines.push(T.varies);
  return lines;
}

/** Tarif d'une station (texte IRVE + gratuité jugée avec sa puissance et ses moyens de paiement). */
export const stationTariff = (s: { prix?: string | null; free?: boolean; kw?: number; pay?: readonly string[] }) =>
  parseTariff(s.prix, { free: s.free, kw: s.kw, pay: s.pay });

/** Tarif repris dans le suivi d'une recharge (plan enregistré au paiement). */
export const planTariff = (p: { tariffRaw?: string; free?: boolean; stationKw?: number; pointKw?: number; pay?: readonly string[] } | null | undefined) =>
  parseTariff(p?.tariffRaw, { free: p?.free, kw: p?.stationKw ?? p?.pointKw, pay: p?.pay });

/** Multiplicateur TTC (les prix HT sont majorés de la TVA à 20 %). */
export const ttcFactor = (t: Pick<Tariff, 'ht'>) => (t.ht ? 1.2 : 1);

// Analyse du champ libre IRVE `tarification` (texte saisi par chaque opérateur) — fonction pure, testée dans tariff.test.ts.
import { tr } from '../i18n';
import { num, perKwh as perKwhFmt, perMin as perMinFmt } from '../i18n/format';
import { verifyQr, type Operator } from './qr';
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
  /**
   * Prix publiés probablement hors taxes sans le dire : chaque montant à 4 décimales ou plus est un prix rond divisé
   * par 1,2 (0,33334 = 0,40 / 1,2 ; 6,6667 = 8 / 1,2). Affichés ≈ ×1,2 et estimés TTC, avec la mention.
   */
  htLikely?: true;
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
  /**
   * Plages horaires analysées : chaque plage est un tarif complet distinct (composantes rattachées à leur plage), jamais
   * additionnées. `default` : tarif hors plages (« par défaut », ou clause sans horaire). Absent : texte non analysable par
   * plage (on garde alors les champs ci-dessus, au plus élevé).
   */
  bands?: { list: TariffBand[]; default?: Tariff };
}

/** Plage horaire [from, to[ en minutes depuis minuit (heure locale) ; to ≤ from : passe minuit. */
export interface TariffBand {
  from: number;
  to: number;
  tariff: Tariff;
}

/** La plage contient-elle cette minute de la journée ? */
export const bandHas = (b: Pick<TariffBand, 'from' | 'to'>, m: number) => (b.from === b.to ? true : b.from < b.to ? m >= b.from && m < b.to : m >= b.from || m < b.to);
/** « 06:00–18:00 ». */
export const bandLabel = (b: Pick<TariffBand, 'from' | 'to'>) => {
  const f = (x: number) => `${String(Math.floor(x / 60) % 24).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
  return `${f(b.from)}–${f(b.to)}`;
};

const HEADER = /(?:entre (\d{1,2}):(\d{2}) et (\d{1,2}):(\d{2})|par d[ée]faut)\s*:/gi;
const LEAD = /^\s*(?:de\s*)?(\d{1,2})\s*h\s*(\d{2})?\s*(?:à|a|-)\s*(\d{1,2})\s*h\s*(\d{2})?/i;
const TRAIL = /(?:entre|de)\s*(\d{1,2})\s*h\s*(\d{2})?\s*(?:et|à|a|-)\s*(\d{1,2})\s*h\s*(\d{2})?/i;

/**
 * Découpe un texte à plages horaires en tarifs distincts. Deux formes réelles (IRVE) :
 * - « entre 08:00 et 20:00 : <composantes>, entre 20:00 et 08:00 : <composantes>, par défaut : … » (en-têtes) ;
 * - « 0,35€/kWh + 0,03€/min entre 6h et 18h, 15€ la session entre 18h et 6h » (plage en fin de clause ; clause sans
 *   horaire = tarif des autres heures).
 * Une plage répétée est fusionnée (même texte analysé ensemble). Rien si moins de deux tarifs publiés distincts.
 */
function splitBands(src: string): { key: string; from: number; to: number; text: string }[] | null {
  const parts: { key: string; from: number; to: number; text: string }[] = [];
  const heads = [...src.matchAll(HEADER)];
  if (heads.length >= 2 && heads.some((h) => h[1] !== undefined)) {
    const pre = src.slice(0, heads[0].index).trim();
    if (pre.replace(/[,;\s]/g, '')) parts.push({ key: 'default', from: 0, to: 0, text: pre });
    heads.forEach((h, i) => {
      const text = src.slice((h.index ?? 0) + h[0].length, heads[i + 1]?.index ?? src.length).replace(/[,;\s]+$/, '');
      if (h[1] === undefined) parts.push({ key: 'default', from: 0, to: 0, text });
      else {
        const from = Number(h[1]) * 60 + Number(h[2]);
        const to = Number(h[3]) * 60 + Number(h[4]);
        parts.push({ key: `${from}-${to}`, from, to, text });
      }
    });
  } else {
    // « 8h à 22h = … . De 22h à 8h = 20€ » : plage en tête de phrase, phrases séparées par un point
    const lead = LEAD.test(src);
    const chunks = (lead ? src.split(/\.\s+(?=(?:de\s*)?\d{1,2}\s*h)/i) : src.split(/,\s+|;\s*/)).map((c) => c.trim()).filter(Boolean);
    if (chunks.length < 2) return null;
    let banded = 0;
    for (const c of chunks) {
      const m = (lead ? LEAD : TRAIL).exec(c);
      if (m) {
        banded++;
        const from = Number(m[1]) * 60 + Number(m[2] ?? 0);
        const to = Number(m[3]) * 60 + Number(m[4] ?? 0);
        parts.push({ key: `${from}-${to}`, from, to, text: c.replace(lead ? LEAD : TRAIL, ' ').replace(/^\s*=\s*/, '') });
      } else parts.push({ key: 'default', from: 0, to: 0, text: c });
    }
    if (!banded) return null;
  }
  const merged = new Map<string, { key: string; from: number; to: number; text: string }>();
  for (const p of parts) {
    const m = merged.get(p.key);
    if (m) m.text = `${m.text}, ${p.text}`;
    else merged.set(p.key, { ...p });
  }
  return [...merged.values()];
}

/** Tarif applicable à une minute de la journée : sa plage, sinon le tarif par défaut, sinon null (heure non couverte). */
export function tariffAtMinute(t: Tariff, m: number): Tariff | null {
  if (!t.bands) return t;
  const b = t.bands.list.find((x) => bandHas(x, m));
  return b ? b.tariff : t.bands.default ?? null;
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
  /** Nombre de décimales écrites (zéros finaux exclus). */
  dec: number;
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

/** Décimales écrites d'un nombre (« 0.33334 » → 5, « 6.0 » → 0). */
const decimals = (x: string) => (x.split('.')[1] ?? '').replace(/0+$/, '').length;
/**
 * TVA 20 % : un prix HT publié vaut le prix TTC rond (au centime) divisé par 1,2, à 1e-3 près. À partir de 6 décimales
 * écrites (`dec`), un TTC au millième est aussi accepté (0,30916667 × 1,2 = 0,371) : une telle précision ne s'explique
 * que par une division, et l'écart d'arrondi reste sous 1e-6.
 */
const VAT = 1.2;
export function htRound(v: number, dec = 0): boolean {
  const ttc = v * VAT;
  if (!(v > 0)) return false;
  if (Math.abs(ttc - Math.round(ttc * 100) / 100) <= 1e-3 + 1e-9) return true;
  return dec >= 6 && Math.abs(ttc - Math.round(ttc * 1000) / 1000) <= 2e-6;
}
/**
 * Montants publiés probablement HT : au moins un montant à 4 décimales ou plus, et tous ceux-là sont des prix ronds
 * divisés par 1,2. Jamais si le texte dit TTC (HT annoncé : déjà traité par `ht`).
 */
function likelyHt(values: { v: number; dec: number }[], text: string): boolean {
  if (/ttc/.test(text)) return false;
  const long = values.filter((a) => a.v > 0 && a.dec >= 4);
  return long.length > 0 && long.every((a) => htRound(a.v, a.dec));
}

/** Plages analysées une à une (chaque plage : tarif complet ; HT hérité du texte entier, publié de façon homogène). */
function attachBands(out: Tariff, src: string, opts: FreeContext) {
  const parts = splitBands(src.replace(/https?:\/\/[^\s,;)]+/gi, ' '));
  if (!parts) return;
  const parse = (text: string) => {
    let b = parseTariff(text, { ...opts, noBands: true });
    // Plage au prix fixe seul (« De 22h à 8h = 20€ ») : forfait de la recharge sur cette plage
    const flat = text.match(/^\s*(\d+(?:[.,]\d+)?)\s*(?:€|eur)\s*\.?\s*$/i);
    if (b.kind !== 'priced' && flat) b = parseTariff(`${flat[1]} € par session`, { ...opts, noBands: true });
    if (b.kind !== 'priced') return null;
    return { ...b, ht: out.ht, htLikely: out.htLikely, varies: false, perKwhMin: undefined } as Tariff;
  };
  const list: TariffBand[] = [];
  let def: Tariff | undefined;
  for (const p of parts) {
    const t = parse(p.text);
    if (!t) continue;
    if (p.key === 'default') def = t;
    else list.push({ from: p.from, to: p.to, tariff: t });
  }
  if (list.length + (def ? 1 : 0) >= 2 && list.length >= 1) out.bands = { list, ...(def ? { default: def } : {}) };
}

// ——— Tarifs alternatifs non horaires : jamais additionnés, on garde celui qui s'applique ———
const AMOUNT = /\d+(?:[.,]\d+)?\s*(?:€|e\b|eur|cts?|c€)/i;
const SUBSCRIBER = /abonn/i;
const NON_SUBSCRIBER = /non[\s-]?abonn|sans abonnement|paiement direct|ad[\s-]?hoc|sans compte|\bcb\b|carte bancaire/i;

/** Plage de puissance d'une clause (« ≤ 22 kW », « > 50 kW », « bornes rapides »…), null si aucune. */
function powerRange(c: string): { min: number; max: number } | null {
  const t = c.toLowerCase();
  let m = t.match(/(?:<=?|≤|jusqu.?[àa]|moins de|inf[ée]rieure? [àa])\s*(\d+(?:[.,]\d+)?)\s*kw\b/);
  if (m) return { min: 0, max: Number(m[1].replace(',', '.')) };
  m = t.match(/(?:>=?|≥|plus de|au[\s-]del[àa] de|[àa] partir de|sup[ée]rieure? [àa])\s*(\d+(?:[.,]\d+)?)\s*kw\b/);
  if (m) return { min: Number(m[1].replace(',', '.')) + (/^>|plus de|au[\s-]del|sup/.test(m[0]) ? 0.01 : 0), max: Infinity };
  m = t.match(/(\d+(?:[.,]\d+)?)\s*(?:à|a|-)\s*(\d+(?:[.,]\d+)?)\s*kw\b/);
  if (m) return { min: Number(m[1].replace(',', '.')), max: Number(m[2].replace(',', '.')) };
  if (/\bdc\b|courant continu/.test(t)) return { min: 25, max: Infinity };
  if (/\bac\b|courant alternatif/.test(t)) return { min: 0, max: 43 };
  if (/ultra[\s-]?rapide/.test(t)) return { min: 150, max: Infinity };
  if (/\brapide/.test(t)) return { min: 43.01, max: Infinity };
  if (/\b(?:normale|lente|acc[ée]l[ée]r[ée]e|standard)\b/.test(t)) return { min: 0, max: 43 };
  return null;
}

/**
 * Tarifs alternatifs dans un même texte (abonné / non abonné, AC / DC, par puissance) : on ne garde que les clauses qui
 * s'appliquent au paiement direct (non abonné) et à la puissance du point. Rien n'est filtré si une seule clause chiffrée
 * porte une étiquette (pas d'alternative) ou si le filtre ne laisse aucun montant.
 */
export function pickAlternative(src: string, kw?: number): string {
  const clauses = src.split(/\s*(?:[;|\n]|\.\s+(?=\D)|,\s+(?=\D)|\s+\/\s+(?=\D))\s*/).filter((c) => c.trim());
  const priced = clauses.filter((c) => AMOUNT.test(c));
  if (priced.length < 2) return src;
  let keep = clauses;
  // Abonné vs non abonné : prix sans compte (paiement direct)
  const sub = priced.filter((c) => SUBSCRIBER.test(c) && !NON_SUBSCRIBER.test(c));
  const nonSub = priced.filter((c) => NON_SUBSCRIBER.test(c) || !SUBSCRIBER.test(c));
  if (sub.length && nonSub.length) keep = keep.filter((c) => !sub.includes(c));
  // Par puissance (AC/DC, ≤ 22 kW / > 50 kW, normale / rapide) : la plage qui contient la puissance du point
  const ranged = keep.filter((c) => AMOUNT.test(c) && powerRange(c));
  if (kw && kw > 0 && ranged.length >= 2) {
    const fits = ranged.filter((c) => {
      const r = powerRange(c)!;
      return kw >= r.min && kw <= r.max;
    });
    // Plusieurs plages valables (« rapide » et « ultra rapide » pour 300 kW) : la plus précise (bornes les plus serrées)
    const narrower = (a: string, b: string) => {
      const x = powerRange(a)!;
      const y = powerRange(b)!;
      return y.max < x.max || (y.max === x.max && y.min > x.min);
    };
    const best = fits.length ? fits.reduce((a, b) => (narrower(a, b) ? b : a)) : null;
    if (best) keep = keep.filter((c) => !ranged.includes(c) || c === best);
  }
  if (keep.length === clauses.length || !keep.some((c) => AMOUNT.test(c))) return src;
  return keep.join(', ');
}

export function parseTariff(raw: string | null | undefined, opts: FreeContext & { noBands?: boolean; pointKw?: number } = {}): Tariff {
  const src = pickAlternative((raw ?? '').trim(), opts.pointKw ?? opts.kw);
  const out: Tariff = { kind: 'unknown', ht: false, varies: false, guessedUnit: false, notes: [], raw: (raw ?? '').trim() };
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
    const raw = (k: string) => t.match(new RegExp(`"${k}"\\s*:\\s*([\\d.]+)`))?.[1] ?? '';
    const vals = [raw('energyprice'), raw('fixedprice'), osf?.[1] ?? ''].filter(Boolean).map((x) => ({ v: Number(x), dec: decimals(x) }));
    if (out.kind === 'priced' && likelyHt(vals, t.replace(/"[a-z]+"/g, ''))) out.htLikely = true;
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
    amounts.push({ v, dec: decimals(m[1]), kind: isSession || plusNext ? 'session' : kind, idle: IDLE.test(ctx) || !!th?.grace, session: isSession || plusNext, threshold: th });
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
    if (!out.ht && likelyHt(amounts, t)) out.htLikely = true;
    const kinds = [kwh, charging.map(perMinOf), sessions];
    out.varies = bands > 0 && (kinds.some((k) => new Set(k).size > 1) || amounts.some((a) => a.kind === 'session') && bands > 1);
    if (bands > 0 && !opts.noBands) attachBands(out, src, opts);
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

export interface DescribeOptions {
  /**
   * Réseau payant selon ses sources (portalPaid) : une gratuité déclarée mais non crédible devient « tarif non publié
   * dans la base nationale » plutôt que « gratuit, à vérifier ».
   */
  paidNetwork?: boolean;
}

export function describeTariff(t: Tariff, opts: DescribeOptions = {}): string[] {
  const T = tr().tariff;
  if (t.kind === 'free') return [T.free];
  if (t.freeDoubtful) return [opts.paidNetwork ? tr().pricing.unpublished : T.freeDoubtful];
  if (t.kind !== 'priced') return [];
  const lines: string[] = [];
  // Publié probablement HT : montants affichés TTC (≈ ×1,2), comme dans l'estimation
  const f = t.htLikely ? VAT : 1;
  const ap = (x: string) => (t.htLikely ? `≈ ${x}` : x);
  const kwhT = (x: number) => ap(perKwhText(x * f));
  const minT = (x: number) => ap(perMinText(x * f));
  if (t.perKwh !== undefined) {
    lines.push(t.perKwhMin !== undefined ? T.energyRange(kwhT(t.perKwhMin), kwhT(t.perKwh)) : T.energy(kwhT(t.perKwh), t.guessedUnit));
  }
  if (t.perMin) lines.push(T.time(minT(t.perMin)));
  if (t.perMinLater) lines.push(T.later(t.perMinLater.afterMin, minT(t.perMinLater.perMin)));
  if (t.session) lines.push(T.session(ap(eur(t.session * f))));
  if (t.idle) lines.push(T.idle(minT(t.idle.perMin), t.idle.afterMin));
  if (t.ht) lines.push(T.ht);
  if (t.htLikely) {
    const [v, unit] = t.perKwh !== undefined ? [t.perKwh, '€/kWh'] : t.session ? [t.session, '€'] : [t.perMin ?? t.idle?.perMin ?? 0, '€/min'];
    lines.push(T.htLikely(`${num(v, 5, 2)} ${unit}`, `${num(v * VAT, 3, 2)} ${unit}`));
  }
  if (t.varies) lines.push(t.bands ? T.variesBands : T.varies);
  return lines;
}

/** Tarif d'une station (texte IRVE + gratuité jugée avec sa puissance et ses moyens de paiement). */
export const stationTariff = (s: { prix?: string | null; free?: boolean; kw?: number; pay?: readonly string[] }, pointKw?: number) =>
  parseTariff(s.prix, { free: s.free, kw: s.kw, pay: s.pay, pointKw });

/** Tarif repris dans le suivi d'une recharge (plan enregistré au paiement). */
export const planTariff = (p: { tariffRaw?: string; free?: boolean; stationKw?: number; pointKw?: number; pay?: readonly string[] } | null | undefined) =>
  parseTariff(p?.tariffRaw, { free: p?.free, kw: p?.stationKw ?? p?.pointKw, pay: p?.pay, pointKw: p?.pointKw });

/** Multiplicateur TTC (les prix HT, annoncés ou probables, sont majorés de la TVA à 20 %). */
export const ttcFactor = (t: Pick<Tariff, 'ht' | 'htLikely'>) => (t.ht || t.htLikely ? VAT : 1);

/**
 * Lien de tarif IRVE sûr à ouvrir : https seulement, et passé par le vérificateur de QR (mêmes règles anti-sosie,
 * raccourcisseurs, liens entre particuliers). Sinon null : le lien n'est pas proposé.
 */
export function safeTariffUrl(url: string | undefined, operatorKey: string | null, ops: Operator[]): string | null {
  if (!url || !/^https:\/\//i.test(url.trim())) return null;
  const r = verifyQr(url.trim(), operatorKey, ops);
  return r.kind === 'url' && r.verdict !== 'dangerous' && r.url?.startsWith('https://') ? r.url : null;
}

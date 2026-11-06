// Élisions et contractions devant un nom d'opérateur : « d’Izivia », « del operador », « dell’operatore », « vom Betreiber ».
import { describe, expect, it } from 'vitest';
import { DICTS } from './index';

type Fn = (...a: unknown[]) => unknown;
/** Noms des paramètres d'une phrase composée (« (op, short) => … »). */
const paramsOf = (f: Fn) => (/^\s*(?:function\s*\w*\s*)?\(([^)]*)\)/.exec(f.toString())?.[1] ?? '').split(',').map((x) => x.trim().split(/[\s=:]/)[0]).filter(Boolean);
/**
 * Toutes les phrases produites avec `name` dans chaque paramètre listé dans `opParams` (nom d'opérateur), et le contexte
 * de méthode (c.op = name) ; les autres paramètres reçoivent une valeur neutre.
 */
function sentences(dict: unknown, name: string, opParams: string[]): string[] {
  const out: string[] = [];
  const ctx = { op: name, short: '0001', plugs: 'Type 2', stationCable: true, dc: false, contactless: false };
  const neutral: Record<string, unknown> = { id: { entry: null, digits: null }, r: { source: 'irve', refs: null }, b: { accepted: [], maybe: false, name: null } };
  const walk = (v: unknown) => {
    if (typeof v === 'string') out.push(v);
    else if (typeof v === 'function') {
      const ps = paramsOf(v as Fn);
      for (const way of ['page', 'reader', 'nearest']) {
        const args = ps.map((p) => (p === 'c' ? ctx : opParams.includes(p) ? name : p === 'way' ? way : p in neutral ? neutral[p] : 'X'));
        try {
          const r = (v as Fn)(...args);
          if (typeof r === 'string') out.push(r);
          else if (r && typeof r === 'object') walk(r);
        } catch {
          /* valeur neutre inadaptée */
        }
      }
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(dict);
  return out;
}

describe('« de + nom » toujours élidé en français (de())', () => {
  const all = sentences(DICTS.fr, 'Izivia', ['op', 'n', 'st', 'stationOp', 'connected']);
  it('jamais « de Izivia », « le nom de Izivia »…', () => {
    expect(all.filter((x) => /\bde Izivia/.test(x))).toEqual([]);
  });
  it('exemples', () => {
    expect(DICTS.fr.qr.official('Izivia')).toBe('Domaine d’Izivia selon la base nationale IRVE.');
    expect(DICTS.fr.qr.officialSite('Bouygues Energies & Services')).toContain('site officiel de Bouygues');
    expect(DICTS.fr.qr.otherPay('ENGIE Vianeo', 'Izivia')).toMatch(/^Page de paiement officielle d’ENGIE Vianeo,/);
    expect(DICTS.fr.accounts.connectedQ('Ionity')).toBe('Connecté au site d’Ionity ?');
    expect(DICTS.fr.accounts.connectA11y('Electra')).toBe('Se connecter sur le site d’Electra');
    expect(DICTS.fr.qr.lookalike('Izivia', 'izivia.com')).toContain('celui d’Izivia');
  });
});

describe('contractions avec le nom par défaut de l’opérateur', () => {
  it.each([
    ['es', /\b(de|a) el operador/],
    ['pt', /\b(de|a|por) o operador/],
    ['it', /\b(di|a|da) l’operatore/],
    ['de', /\b(von|bei|an) der Betreiber\b/],
  ] as const)('%s : jamais %s', (lang, bad) => {
    const fallback = DICTS[lang].common.operatorFallback;
    const hits = sentences(DICTS[lang], fallback, ['op', 'stationOp']).filter((x) => bad.test(x));
    expect(hits).toEqual([]);
  });
  it('exemples', () => {
    expect(DICTS.es.recharger.readyNotice('el operador')).toContain('pagas al operador');
    expect(DICTS.it.recharge.keptHere('l’operatore')).toContain('dall’operatore');
    expect(DICTS.pt.here.payHint('o operador')).toContain('ao operador');
    expect(DICTS.de.here.payHint('der Betreiber')).toContain('an den Betreiber');
    expect(DICTS.de.here.payHint('Ionity')).toContain('an Ionity');
  });
});

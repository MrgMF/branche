// Traductions : toutes les langues ont toutes les clés (même forme que fr), et aucune chaîne française n'est restée
// en dur dans src/app et src/components (détection simple, commentaires ignorés).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DICTS, LANGS, pickLang, setLang, setUnits, tr } from './index';
import { bigDist, distText, eur, spokenDist } from './format';
import type { MethodCtx } from './types';

type Node = unknown;
const ctx: MethodCtx = { op: 'Ionity', short: 'E001', plugs: 'CCS', stationCable: true, dc: true, contactless: true };

/** Appelle une fonction de dictionnaire avec des arguments plausibles selon son arité. */
function callAll(fn: (...a: unknown[]) => unknown, path: string): unknown {
  if (path.startsWith('methods.')) return fn(ctx, path.endsWith('badge') ? { accepted: ['A'], maybe: false, name: 'A' } : 'X');
  if (path === 'payer.reader') return fn(['Carte', 'Sans contact']);
  if (path.startsWith('instr.')) return fn({ street: 'Rue A', towards: 'Paris', exit: 2, exitNumber: '12' });
  const args = Array.from({ length: fn.length }, (_, i) => (i % 2 === 0 ? 2 : 'X'));
  try {
    return fn(...args);
  } catch {
    return fn(...Array.from({ length: fn.length }, () => 'X'));
  }
}

function shape(n: Node, path = ''): string[] {
  if (typeof n === 'function') return [`${path}()`];
  if (Array.isArray(n)) return [`${path}[${n.length}]`, ...n.flatMap((x, i) => shape(x, `${path}[${i}]`))];
  if (n && typeof n === 'object') return Object.keys(n as object).sort().flatMap((k) => shape((n as Record<string, Node>)[k], path ? `${path}.${k}` : k));
  return [path];
}

function leaves(n: Node, path = ''): [string, unknown][] {
  if (typeof n === 'function') return [[path, callAll(n as (...a: unknown[]) => unknown, path)]];
  if (Array.isArray(n)) return n.flatMap((x, i) => leaves(x, `${path}[${i}]`));
  if (n && typeof n === 'object') return Object.entries(n as object).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
  return [[path, n]];
}

describe('dictionnaires', () => {
  const ref = shape(DICTS.fr);
  for (const l of LANGS) {
    it(`${l} : mêmes clés que fr, aucune valeur vide`, () => {
      expect(shape(DICTS[l])).toEqual(ref);
      for (const [path, v] of leaves(DICTS[l])) {
        if (typeof v === 'string') expect(v.trim().length, `${l}.${path}`).toBeGreaterThan(0);
        else if (v && typeof v === 'object') expect(JSON.stringify(v).length, `${l}.${path}`).toBeGreaterThan(10);
      }
    });
  }
  it('les langues autres que fr sont réellement traduites', () => {
    for (const l of LANGS.filter((x) => x !== 'fr')) {
      const fr = leaves(DICTS.fr).filter(([, v]) => typeof v === 'string' && (v as string).length > 25);
      const same = fr.filter(([p, v]) => leaves(DICTS[l]).find(([q]) => q === p)?.[1] === v);
      expect(same.map(([p]) => p), l).toEqual([]);
    }
  });
});

describe('langue et formats', () => {
  it('choisit la langue de l’appareil, anglais sinon', () => {
    expect(pickLang(['de-AT', 'fr-FR']).lang).toBe('de');
    expect(pickLang(['pl-PL', 'pt-BR']).lang).toBe('pt');
    expect(pickLang(['ja-JP'])).toEqual({ lang: 'en', tag: 'en-GB' });
  });
  it('formats selon la langue et les unités', () => {
    setLang('en', 'en-US');
    expect(tr().common.back).toBe('Back');
    expect(eur(12.4)).toBe('€12.40');
    expect(distText(1500)).toBe('1.5 km');
    setUnits('mi');
    expect(distText(1609.344 * 2)).toBe('2 mi');
    expect(bigDist(100).unit).toBe('ft');
    expect(spokenDist(804)).toBe('half a mile');
    setLang('de', 'de-DE');
    setUnits('km');
    expect(eur(12.4)).toMatch(/^12,40\s€$/);
    expect(spokenDist(300)).toBe('300 Metern');
    setLang('fr', 'fr-FR');
    expect(distText(1500)).toBe('1,5 km');
  });
});

// ---------------------------------------------------------------- Chaînes en dur
const ROOT = join(__dirname, '..');
const files = (dir: string): string[] =>
  readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) && !e.name.endsWith('.test.ts') ? [join(dir, e.name)] : []));

/** Retire les commentaires (// et bloc) sans toucher aux chaînes. */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  let q: string | null = null;
  while (i < src.length) {
    const c = src[i];
    if (q) {
      out += c;
      if (c === '\\') out += src[++i] ?? '';
      else if (c === q) q = null;
      i++;
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i + 2) + 2;
      if (i < 2) break;
    } else if (c === '{' && src.slice(i, i + 3) === '{/*') {
      const end = src.indexOf('*/}', i);
      i = end < 0 ? src.length : end + 3;
    } else {
      if (c === '"' || c === "'" || c === '`') q = c;
      out += c;
      i++;
    }
  }
  return out;
}

const FRENCH = /[àâçéèêëîïôûùüÿœÉÈÀÇ’]|\b(le|la|les|des|du|une|vous|votre|vos|pour|sur|avec|est|pas|dans|aucun|aucune|borne|bornes|recharge|retour|carte)\b/i;
// Valeurs techniques tolérées (noms propres, unités, styles, identifiants, URL)
const ALLOWED = /^(Branché|CCS|Type 2|kW|kWh|km\/h|€|×|−|\+|–|—|…|[\s\d.,:;%·()/*?-]*)$/;

describe('aucune chaîne française en dur dans src/app et src/components', () => {
  it('détection', () => {
    const hits: string[] = [];
    for (const f of [...files('app'), ...files('components')]) {
      if (f.endsWith('mapHtml.ts')) continue; // page HTML de la carte : libellés injectés depuis le dictionnaire
      const src = stripComments(readFileSync(join(ROOT, f), 'utf8'));
      const lines = src.split('\n');
      lines.forEach((line, n) => {
        if (/^\s*import\b/.test(line) || /^\s*}\s*from\s/.test(line)) return;
        // Texte JSX entre balises
        for (const m of line.matchAll(/>([^<>{}]*[A-Za-zÀ-ÿ]{2,}[^<>{}]*)</g)) if (!ALLOWED.test(m[1].trim()) && FRENCH.test(m[1])) hits.push(`${f}:${n + 1}: ${m[1].trim()}`);
        // Littéraux de chaîne
        for (const m of line.matchAll(/(['"`])((?:\\.|(?!\1).)*?)\1/g)) {
          const v = m[2].replace(/\$\{[^}]*\}/g, ' ');
          if (v.length < 3 || ALLOWED.test(v.trim()) || /^[\w./:#@?=&-]+$/.test(v)) continue;
          if (FRENCH.test(v) && /\s|[àâçéèêëîïôûùüœ’]/.test(v)) hits.push(`${f}:${n + 1}: ${v.trim()}`);
        }
      });
    }
    expect(hits).toEqual([]);
  });
});

describe('textes de paiement (critique paiement)', () => {
  it('aucune langue ne promet Apple Pay / Google Pay', () => {
    for (const l of LANGS) {
      const hits = leaves(DICTS[l]).filter(([, v]) => /Apple Pay|Google Pay/i.test(JSON.stringify(v ?? '')));
      expect(hits.map(([p]) => p), l).toEqual([]);
    }
  });
  it('blockedBody : aucune appli tierce citée, seulement les badges fournis', () => {
    for (const l of LANGS) {
      const txt = DICTS[l].recharger.blockedBody('Lidl France', 'Chargemap Pass, Freshmile');
      expect(txt, l).not.toMatch(/\b(app|appli|application|aplicación|applicazione|aplicação|App)\b/i);
      expect(txt, l).toContain('Chargemap Pass');
    }
  });
  it('pré-autorisation publiée : « jusqu’à 75 € bloqués puis libérés »', () => {
    setLang('fr');
    expect(tr().recharger.preauthMax('Révéo', eur(75, 0))).toMatch(/^Jusqu’à 75\s€ bloqués puis libérés/);
  });
});

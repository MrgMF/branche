import { describe, expect, it } from 'vitest';
import { editDistance, normalizeEvse, operatorPayUrl, registrableDomain, verifyQr, type Operator } from './qr';
// payDomains réels (pipeline/data/operator-portals.json), attachés au registre comme le fait le pipeline (portals.mjs)
import realPortals from '../../../../pipeline/data/operator-portals.json';

const OPS: Operator[] = [
  { key: 'izivia', names: ['Izivia'], domains: ['izivia.com'], payUrl: null },
  { key: 'metropolis', names: ['Metropolis'], domains: ['metropolis-recharge.fr'], payUrl: 'https://pay.metropolis-recharge.fr/evse/{evse}' },
  { key: 'test', names: ['Opérateur Test'], domains: ['localhost:8090'], payUrl: null },
];

describe('registrableDomain', () => {
  it.each([
    ['pay.izivia.com', 'izivia.com'],
    ['izivia.com', 'izivia.com'],
    ['a.b.example.co.uk', 'example.co.uk'],
  ])('%s → %s', (h, d) => expect(registrableDomain(h)).toBe(d));
});

describe('normalizeEvse', () => {
  it('reconnaît les formats eMI3', () => {
    expect(normalizeEvse('FR*S44*E12345*1')).toBe('FRS44E123451');
    expect(normalizeEvse('frs44e12345')).toBe('FRS44E12345');
    expect(normalizeEvse('https://x.fr')).toBeNull();
  });
});

describe('verifyQr', () => {
  it('officiel quand le domaine appartient à l’opérateur de la borne', () => {
    const r = verifyQr('https://pay.izivia.com/c/FRIZIE123', 'izivia', OPS);
    expect(r.verdict).toBe('official');
    expect(r.operatorKey).toBe('izivia');
  });

  it('opérateur connu mais différent de la borne sélectionnée → avertissement', () => {
    expect(verifyQr('https://izivia.com/x', 'metropolis', OPS).verdict).toBe('other-operator');
    expect(verifyQr('https://izivia.com/x', null, OPS).verdict).toBe('known-operator');
  });

  it.each(['https://izivia.com.evil.site/pay', 'https://metropolis-recharge.fr.evil.site/', 'https://pay.izivia.evil.site/', 'https://evil.com/izivia.com/pay', 'https://evil.com/?r=metropolis-recharge.fr'])(
    'sous-domaine ou chemin piégé : %s',
    (raw) => expect(verifyQr(raw, 'izivia', OPS).verdict).toBe('dangerous'),
  );

  it.each(['https://monta.app/pay', 'https://virta.fi/x', 'https://wait.fr', 'https://idea.fr', 'https://reed.fr', 'https://evway.net', 'https://lidi.fr'])(
    'pas de faux positif : %s',
    (raw) => expect(verifyQr(raw, 'izivia', [...OPS, { key: 'watt', names: ['Watt'], domains: ['watt.fr'], payUrl: null }, { key: 'lidl', names: ['Lidl'], domains: ['lidl.fr'], payUrl: null }]).verdict).not.toBe('dangerous'),
  );

  it('même nom, autre extension → bloqué (fraude documentée)', () => {
    expect(verifyQr('https://izivia.site/pay', 'izivia', OPS).verdict).toBe('dangerous');
    expect(verifyQr('https://metropolis-recharge.com/', 'izivia', OPS).verdict).toBe('dangerous');
  });

  it('faute de frappe sur un nom de 5 lettres → avertissement nommant l’opérateur', () => {
    const ops = [...OPS, { key: 'tesla', names: ['Tesla'], domains: ['tesla.com'], payUrl: null }];
    const r = verifyQr('https://teslla.com/x', 'izivia', ops);
    expect(r.verdict).toBe('unknown');
    expect(r.reasons[0]).toContain('Tesla');
  });

  it('plateforme de paiement reconnue', () => {
    expect(verifyQr('https://checkout.stripe.com/c/pay/cs_123', 'izivia', OPS).verdict).toBe('payment-platform');
  });

  it('expose l’hôte complet', () => {
    expect(verifyQr('https://sites.google.com/view/borne', null, OPS).host).toBe('sites.google.com');
  });

  it('domaine inconnu', () => {
    const r = verifyQr('https://chargeplus-paiement.fr/a', 'izivia', OPS);
    expect(r.verdict).toBe('unknown');
  });

  it.each([
    'http://izivia.com/pay',
    'javascript:alert(1)',
    'data:text/html,<script>1</script>',
    'https://user:pass@izivia.com/',
    'https://xn--izvia-hua.com/',
    'https://192.168.1.10/pay',
    'https://bit.ly/3abc',
    'https://izivla.com/pay',
    'https://izivia-paiement.com/pay',
    'https://izivia.com.fr/pay',
    'https://1zivia.com/',
    'not a url',
    '',
  ])('dangereux : %s', (raw) => {
    expect(verifyQr(raw, 'izivia', OPS).verdict).toBe('dangerous');
  });

  it('identifiant de borne seul', () => {
    const r = verifyQr('FR*MGP*E92002DB1P1', null, OPS);
    expect(r.kind).toBe('evse');
    expect(r.evse).toBe('FRMGPE92002DB1P1');
  });

  it('hôte de développement autorisé en http seulement si déclaré', () => {
    expect(verifyQr('http://localhost:8090/pay?evse=X', 'test', OPS).verdict).toBe('dangerous');
    expect(verifyQr('http://localhost:8090/pay?evse=X', 'test', OPS, { devHosts: ['localhost:8090'] }).verdict).toBe('official');
  });
});

describe('outils', () => {
  it('editDistance', () => {
    expect(editDistance('izivia', 'izivla')).toBe(1);
    expect(editDistance('izivia', 'tesla', 2)).toBeGreaterThan(2);
  });
  it('operatorPayUrl', () => {
    expect(operatorPayUrl(OPS[1], 'FR*MGP*E1')).toBe('https://pay.metropolis-recharge.fr/evse/FR*MGP*E1');
    expect(operatorPayUrl(OPS[0], 'X')).toBeNull();
  });
});

describe('verifyQr — pages de paiement officielles sourcées (payDomains)', () => {
  type Entry = { payDomains?: string[]; registryKeys?: string[] };
  const entries = (realPortals as { operators: Record<string, Entry> }).operators;
  const pay = (key: string) => [
    ...new Set(Object.entries(entries).flatMap(([k, e]) => (k === key || e.registryKeys?.includes(key) ? (e.payDomains ?? []) : []))),
  ];
  // Domaines IRVE tels que publiés dans site/data/operators.json
  const REG: Operator[] = [
    { key: 'izivia', names: ['IZIVIA'], domains: ['izivia.com'], payUrl: null },
    { key: 'engie-vianeo', names: ['ENGIE Vianeo'], domains: ['engie.com', 'greenflux.com'], payUrl: null },
    { key: 'qwello', names: ['Qwello France SAS'], domains: ['qwello.fr'], payUrl: null },
    { key: 'virta', names: ['Virta'], domains: ['virta.global'], payUrl: null },
    { key: 'freshmile', names: ['Freshmile'], domains: ['freshmile.com'], payUrl: null },
    { key: 'allego', names: ['Allego'], domains: ['allego.eu'], payUrl: null },
    { key: 'ionity', names: ['Ionity'], domains: ['ionity.eu'], payUrl: null },
  ].map((o) => ({ ...o, payDomains: pay(o.key) }));

  it('sans payDomains, ces pages étaient bloquées comme sosies (régression corrigée)', () => {
    const bare = REG.map(({ payDomains: _p, ...o }) => o);
    expect(verifyQr('https://charge.engie-vianeo.com/', 'engie-vianeo', bare).verdict).toBe('dangerous');
    expect(verifyQr('https://wa.qwello.eu/c/123', 'qwello', bare).verdict).toBe('dangerous');
  });
  it.each([
    ['https://charge.engie-vianeo.com/', 'engie-vianeo'],
    ['https://wa.qwello.eu/c/FR*QWE*E1', 'qwello'],
    ['https://chge.eu/', 'virta'],
    ['https://chge.eu/12345', 'virta'],
    ['https://xfm.fr/AB12', 'freshmile'],
    ['https://recharge.carrefour.fr/', 'allego'],
    ['https://payment.ionity.eu/', 'ionity'],
  ])('%s sur une borne %s → officiel (page sourcée)', (raw, op) => {
    const r = verifyQr(raw, op, REG);
    expect(r.verdict).toBe('official');
    expect(r.source).toBe('portal');
    expect(r.operatorKey).toBe(op);
  });
  it('page officielle d’un autre opérateur → opérateur reconnu, nommé', () => {
    const r = verifyQr('https://chge.eu/', 'izivia', REG);
    expect(r.verdict).toBe('known-operator');
    expect(r.operatorKey).toBe('virta');
    expect(r.reasons[0]).toContain('Virta');
    expect(r.reasons[0]).toContain('IZIVIA');
  });
  it('autre page du même site, sans siteDomains publiés : non vérifiée, pas bloquée', () => {
    expect(verifyQr('https://www.qwello.eu/', 'qwello', REG).verdict).toBe('unknown');
  });
  it.each([
    'https://charge.engie-vianeo.com.evil.site/',
    'https://charge-engie-vianeo.com/',
    'https://engie-vlaneo.com/',
    'https://wa.qwello.com/',
    'https://qwe11o.eu/',
    'https://chge.com/',
    'https://xfm.fr.pay-borne.site/',
    'https://evil.com/?next=chge.eu',
    'https://recharge-carrefour.fr/',
    'https://recharge.carrefour.fr.evil.site/',
    'http://chge.eu/',
    'https://xn--chge-2ra.eu/',
  ])('sosie toujours bloqué : %s', (raw) => {
    expect(verifyQr(raw, 'virta', REG).verdict).toBe('dangerous');
  });
});

describe('verifyQr — domaines des sites sourcés (siteDomains, publiés par pipeline/src/portals.mjs)', () => {
  // Tels que publiés dans operators.json : domaines IRVE + siteDomains tirés des URL sourcées (hors sites tiers)
  const REG: Operator[] = [
    { key: 'bouygues-energies-services', names: ['Bouygues Energies & Services'], domains: ['alizecharge.fr', 'bouygues-es.com'], payUrl: null, siteDomains: ['alizecharge.com', 'reveocharge.com'] },
    { key: 'reveo-syaden', names: ['Révéo'], domains: ['reveocharge.com'], payUrl: null },
    { key: 'engie-vianeo', names: ['ENGIE Vianeo'], domains: ['engie.com', 'greenflux.com'], payUrl: null, payDomains: ['charge.engie-vianeo.com'], siteDomains: ['engie-vianeo.com'] },
    { key: 'qwello', names: ['Qwello France SAS'], domains: ['qwello.fr'], payUrl: null, payDomains: ['wa.qwello.eu'], siteDomains: ['qwello.eu'] },
    { key: 'izivia', names: ['IZIVIA'], domains: ['izivia.com'], payUrl: null },
  ];
  it('pay.alizecharge.com sur une borne Bouygues → officiel (site sourcé, pas un sosie d’alizecharge.fr)', () => {
    const r = verifyQr('https://pay.alizecharge.com/FRS77E770340011', 'bouygues-energies-services', REG);
    expect(r.verdict).toBe('official');
    expect(r.source).toBe('site');
    expect(r.operatorKey).toBe('bouygues-energies-services');
    expect(r.reasons[0]).toBe('Domaine du site officiel de Bouygues Energies & Services (sources vérifiées par Branché).');
  });
  it('sans siteDomains, la même page était bloquée (« porte le nom de… ») : régression corrigée', () => {
    const bare = REG.map(({ siteDomains: _s, ...o }) => o);
    expect(verifyQr('https://pay.alizecharge.com/', 'bouygues-energies-services', bare).verdict).toBe('dangerous');
  });
  it.each([
    ['https://support.reveocharge.com/x', 'bouygues-energies-services'],
    ['https://www.engie-vianeo.com/', 'engie-vianeo'],
    ['https://www.qwello.eu/', 'qwello'],
  ])('%s sur une borne %s → officiel', (raw, op) => {
    expect(verifyQr(raw, op, REG).verdict).toBe('official');
  });
  it('domaine IRVE prioritaire sur le site sourcé (Révéo déclare reveocharge.com dans l’IRVE)', () => {
    const r = verifyQr('https://my.reveocharge.com/', 'reveo-syaden', REG);
    expect(r).toMatchObject({ verdict: 'official', source: 'irve' });
  });
  it('site sourcé d’un autre opérateur → « autre opérateur », nommé', () => {
    const r = verifyQr('https://pay.alizecharge.com/', 'izivia', REG);
    expect(r.verdict).toBe('other-operator');
    expect(r.operatorKey).toBe('bouygues-energies-services');
  });
  it.each(['https://pay-alizecharge.com/', 'https://alizecharge.com.evil.site/', 'https://a1izecharge.com/', 'https://alizecharge.site/', 'https://evil.com/?u=alizecharge.com'])(
    'sosie toujours bloqué : %s',
    (raw) => {
      expect(verifyQr(raw, 'bouygues-energies-services', REG).verdict).toBe('dangerous');
    },
  );
});

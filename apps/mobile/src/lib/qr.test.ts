import { describe, expect, it } from 'vitest';
import { editDistance, normalizeEvse, operatorPayUrl, registrableDomain, verifyQr, type Operator } from './qr';

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

  it('opérateur connu mais différent de la borne sélectionnée', () => {
    expect(verifyQr('https://izivia.com/x', 'metropolis', OPS).verdict).toBe('known-operator');
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

// CPO de test (développement / E2E) : simule la page de paiement ad hoc d'un opérateur,
// telle qu'ouverte par le QR code collé sur une borne. Aucun paiement réel.
// Usage : node scripts/test-cpo.mjs [port]   → http://localhost:8090/pay?evse=FR*TST*E0001
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 8090);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const page = (title, body) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>body{font:16px system-ui;margin:0;background:#F4F6FB;color:#111}main{max-width:420px;margin:0 auto;padding:24px}
.c{background:#fff;border-radius:14px;padding:18px;box-shadow:0 1px 4px #0002}label{display:block;margin:12px 0 4px;font-weight:600}
input{width:100%;box-sizing:border-box;height:46px;border:1px solid #bbb;border-radius:10px;padding:0 12px;font-size:16px}
button{width:100%;height:52px;margin-top:18px;border:0;border-radius:12px;background:#1D4ED8;color:#fff;font-weight:700;font-size:17px}
.b{background:#FFF4D6;padding:10px 12px;border-radius:10px;margin-bottom:14px}</style></head><body><main>${body}</main></body></html>`;

createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  const evse = url.searchParams.get('evse') ?? 'FR*TST*E0001';
  res.setHeader('content-type', 'text/html; charset=utf-8');
  if (url.pathname === '/pay' && req.method === 'GET') {
    res.end(page('Opérateur Test — paiement', `<div class="b">CPO de test — aucun paiement réel</div><div class="c"><h1>Opérateur Test</h1>
<p>Borne <strong>${esc(evse)}</strong> · 0,49 €/kWh</p><form method="post" action="/pay?evse=${encodeURIComponent(evse)}">
<label for="n">Numéro de carte (test)</label><input id="n" name="n" value="4242 4242 4242 4242" inputmode="numeric">
<label for="e">Expiration</label><input id="e" name="e" value="12/30"><button type="submit">Payer et démarrer la recharge</button></form></div>`));
    return;
  }
  if (url.pathname === '/pay' && req.method === 'POST') {
    req.resume();
    res.end(page('Paiement accepté', `<div class="c"><h1>Paiement accepté</h1><p>La borne <strong>${esc(evse)}</strong> démarre. Branchez votre véhicule.</p>
<p>Vous pouvez revenir à votre application.</p></div>`));
    return;
  }
  res.statusCode = 404;
  res.end(page('Introuvable', '<p>Introuvable</p>'));
}).listen(port, '127.0.0.1', () => console.log(`CPO de test sur http://localhost:${port}/pay?evse=FR*TST*E0001`));

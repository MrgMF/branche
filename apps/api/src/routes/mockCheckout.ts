import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppContext } from '../context.js';
import { escapeHtml, formatEuros } from '../lib/html.js';
import { withQuery } from '../lib/returnUrl.js';
import type { SessionRecord } from '../sessions/store.js';

const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
} as const;

function securityHeaders(reply: FastifyReply, nonce: string): void {
  reply
    .header('content-type', 'text/html; charset=utf-8')
    .header('cache-control', 'no-store')
    .header(
      'content-security-policy',
      `default-src 'none'; style-src 'nonce-${nonce}'; img-src 'none'; base-uri 'none'; frame-ancestors 'none'`,
    )
    .header('x-content-type-options', 'nosniff')
    .header('referrer-policy', 'no-referrer')
    .header('x-frame-options', 'DENY');
}

const STYLE = `
:root{--ink:#0F1A17;--muted:#4B5753;--accent:#0B7A55;--accent-pressed:#075C40;--bg:#F1F4F3;--card:#FFFFFF;--border:#DDE4E2;--soft:#E3F2EC;--warn-bg:#FFF4E5;--warn:#7A3E00}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:430px;margin:0 auto;padding:16px 16px 32px}
.demo{display:block;margin:0 0 16px;padding:12px 16px;border-radius:14px;background:var(--warn-bg);color:var(--warn);border:1px solid #F3C98B;font-weight:600}
.demo span{display:block;font-weight:400;font-size:14px}
h1{font-size:24px;line-height:1.25;margin:8px 0 16px}
.card{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:16px;margin-bottom:16px}
dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:10px 16px}
dt{color:var(--muted)}
dd{margin:0;text-align:right;font-weight:600;overflow-wrap:anywhere}
.amount{font-size:20px}
.note{color:var(--muted);font-size:14px;margin:0 0 20px}
form{margin:0}
.btn{display:flex;align-items:center;justify-content:center;width:100%;min-height:52px;padding:12px 16px;border:0;border-radius:14px;background:var(--accent);color:#fff;font:inherit;font-weight:700;font-size:17px;cursor:pointer;text-decoration:none}
.btn:hover,.btn:active{background:var(--accent-pressed)}
.link{display:flex;align-items:center;justify-content:center;width:100%;min-height:48px;margin-top:8px;background:none;border:0;color:var(--ink);font:inherit;text-decoration:underline;cursor:pointer}
.btn:focus-visible,.link:focus-visible{outline:3px solid var(--ink);outline-offset:3px}
.status{background:var(--soft);border-radius:14px;padding:12px 16px;margin-bottom:16px}
@media (prefers-reduced-motion:no-preference){.btn{transition:background .15s}}
`;

function page(nonce: string, title: string, body: string): string {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="color-scheme" content="light">
<title>${escapeHtml(title)} — Branché</title>
<style nonce="${nonce}">${STYLE}</style>
</head>
<body>
<main>
<p class="demo" role="note"><strong>Mode démo — aucun débit réel</strong><span>Paiement et borne simulés : aucune carte n’est demandée.</span></p>
${body}
</main>
</body>
</html>`;
}

function recap(s: SessionRecord): string {
  const kwh = formatEuros(s.priceCentsPerKwh).replace(/ €$/, ' €/kWh');
  return `<section class="card" aria-label="Récapitulatif">
<dl>
<dt>Station</dt><dd>${escapeHtml(s.stationName)}</dd>
${s.pdcId ? `<dt>Point de charge</dt><dd>${escapeHtml(s.pdcId)}</dd>` : ''}
<dt>Pré-autorisation</dt><dd class="amount">${formatEuros(s.preauthCents)}</dd>
<dt>Tarif</dt><dd>${kwh}</dd>
<dt>Frais de service</dt><dd>${formatEuros(s.feeCents)}</dd>
</dl>
</section>`;
}

export async function mockCheckoutRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { sessions } = ctx;
  // Formulaires HTML : le contenu du corps est ignoré.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 4096 }, (_r, _b, done) =>
    done(null, {}),
  );

  const notFoundPage = (reply: FastifyReply) => {
    const nonce = randomBytes(16).toString('base64');
    securityHeaders(reply, nonce);
    return reply
      .code(404)
      .send(page(nonce, 'Session introuvable', '<h1>Session introuvable</h1><p>Ce lien de paiement n’existe pas ou a expiré.</p>'));
  };

  app.get<{ Params: { id: string } }>('/mock-checkout/:id', { schema: { params: idParams } }, async (req, reply) => {
    const found = sessions.find(req.params.id);
    if (!found) return notFoundPage(reply);
    const s = await sessions.get(found.id);
    const nonce = randomBytes(16).toString('base64');
    securityHeaders(reply, nonce);
    const id = encodeURIComponent(s.id);
    const back = escapeHtml(withQuery(s.returnUrl, { session: s.id }));

    if (s.status !== 'awaiting_payment') {
      const msg =
        s.status === 'cancelled'
          ? 'Cette pré-autorisation a été annulée.'
          : s.status === 'failed'
            ? 'Cette recharge n’a pas pu démarrer.'
            : 'Cette pré-autorisation est déjà validée.';
      return reply.send(
        page(
          nonce,
          'Pré-autorisation',
          `<h1>Pré-autorisation</h1><p class="status" role="status">${msg}</p>${recap(s)}<a class="btn" href="${back}">Retour à l’application</a>`,
        ),
      );
    }

    const amount = formatEuros(s.preauthCents);
    return reply.send(
      page(
        nonce,
        'Autoriser la recharge',
        `<h1>Autoriser la recharge</h1>
${recap(s)}
<p class="note">Une empreinte de ${amount} est réservée au démarrage. Seule l’énergie consommée et les frais sont débités à l’arrêt, dans la limite de ce montant.</p>
<form method="post" action="/mock-checkout/${id}/authorize">
<button class="btn" type="submit">Autoriser ${amount}</button>
</form>
<form method="post" action="/mock-checkout/${id}/cancel">
<button class="link" type="submit">Annuler</button>
</form>`,
      ),
    );
  });

  app.post<{ Params: { id: string } }>('/mock-checkout/:id/authorize', { schema: { params: idParams } }, async (req, reply) => {
    const found = sessions.find(req.params.id);
    if (!found) return notFoundPage(reply);
    const s = await sessions.authorizeMock(found.id);
    return reply.code(303).header('cache-control', 'no-store').redirect(withQuery(s.returnUrl, { session: s.id }));
  });

  app.post<{ Params: { id: string } }>('/mock-checkout/:id/cancel', { schema: { params: idParams } }, async (req, reply) => {
    const found = sessions.find(req.params.id);
    if (!found) return notFoundPage(reply);
    const s = await sessions.get(found.id);
    if (s.status === 'awaiting_payment' || s.status === 'starting') await sessions.cancel(s.id);
    return reply
      .code(303)
      .header('cache-control', 'no-store')
      .redirect(withQuery(s.returnUrl, { session: s.id, cancelled: '1' }));
  });
}

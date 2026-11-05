"""E2E V1.1 : paiement direct par connecteur (CPO de test), anti-QR piégé, itinéraire + perturbations + guidage.

Prérequis : site servi (scripts/serve-site.py 8080), API (:8787), CPO de test (scripts/test-cpo.mjs 8090),
app exportée avec DEV_TRUSTED_HOSTS=localhost:8090 et le registre contenant l'opérateur de test.
Usage : python3 scripts/e2e-v11.py http://localhost:8080/branche <dossier_captures>
Dans le bac à sable, TomTom/Valhalla sont injoignables : la réponse de /v1/route est simulée par Playwright
(trajet réaliste Antony → borne). Tout le reste (API, incidents, paiement) est réel.
"""
import json
import math
import sys

from playwright.sync_api import sync_playwright

BASE = sys.argv[1].rstrip('/')
OUT = sys.argv[2]
POS = {'latitude': 48.7536, 'longitude': 2.2975}
STUB_STYLE = {"version": 8, "glyphs": "https://example.invalid/{fontstack}/{range}.pbf", "sources": {},
              "layers": [{"id": "bg", "type": "background", "paint": {"background-color": "#E6ECEA"}}]}
log = []


CORS = {'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST, OPTIONS'}


def fake_route(route):
    if route.request.method == 'OPTIONS':
        route.fulfill(status=204, headers=CORS)
        return
    q = json.loads(route.request.post_data)
    la, lo, lb, lob = q['from']['lat'], q['from']['lon'], q['to']['lat'], q['to']['lon']
    pts = [[lo + (lob - lo) * t / 20, la + (lb - la) * t / 20 + 0.0008 * math.sin(t / 3)] for t in range(21)]
    d = 1000 * 111 * math.hypot(lb - la, (lob - lo) * 0.66)
    body = {"provider": "tomtom", "traffic": True, "durationS": 240, "trafficDelayS": 90, "distanceM": round(d),
            "geometry": pts, "alternativesConsidered": 3,
            "steps": [{"instruction": "Tournez à droite sur la rue Velpeau", "distanceM": 200, "lon": pts[8][0], "lat": pts[8][1]},
                      {"instruction": "Vous êtes arrivé", "distanceM": 0, "lon": pts[-1][0], "lat": pts[-1][1]}]}
    body['attribution'] = '© TomTom'
    route.fulfill(status=200, content_type='application/json', headers=CORS, body=json.dumps(body))


with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, geolocation=POS,
                        permissions=['geolocation'], locale='fr-FR')
    ctx.route('**/tiles.openfreemap.org/**', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps(STUB_STYLE)))
    ctx.route('**/fonts.gstatic.com/**', lambda r: r.abort())
    ctx.route('**/v1/route', fake_route)
    page = ctx.new_page()
    page.on('pageerror', lambda e: log.append(f'pageerror: {e}'))

    page.goto(f'{BASE}/app/', wait_until='networkidle')
    page.wait_for_selector('text=Bornes les plus proches', timeout=20000)
    page.wait_for_timeout(1500)
    page.locator('[role=button][aria-label*=" m,"], [role=button][aria-label*=" km,"]').first.click()
    page.wait_for_selector('text=Payer cette borne', timeout=10000)
    page.screenshot(path=f'{OUT}/a1-fiche.png')

    # --- Itinéraire + perturbations
    page.get_by_role('button', name='Itinéraire le plus rapide').click()
    page.wait_for_selector('text=Arrivée', timeout=20000)
    page.wait_for_timeout(1500)
    page.screenshot(path=f'{OUT}/a2-itineraire.png')
    log.append('itinéraire : OK')
    page.get_by_role('button', name='Démarrer').click()
    page.wait_for_timeout(2500)
    page.screenshot(path=f'{OUT}/a3-guidage.png')
    page.get_by_role('button', name='Arrêter le guidage').click()
    page.wait_for_timeout(800)

    # --- Paiement direct : QR piégé bloqué (la fiche de la borne revient après l'itinéraire)
    page.get_by_role('button', name='Payer depuis Branché').click()
    page.wait_for_selector('text=Payer la borne', timeout=10000)
    box = page.get_by_placeholder('ex. FR*ABC*E1234 ou https://…')
    box.fill('https://bit.ly/borne-paiement')
    page.get_by_role('button', name='Vérifier').click()
    page.wait_for_selector('text=paiement bloqué', timeout=5000)
    page.screenshot(path=f'{OUT}/a4-qr-piege.png')
    log.append('QR piégé bloqué : OK')

    # --- Paiement direct : page officielle de l'opérateur (CPO de test)
    box.fill('http://localhost:8090/pay?evse=FR*TST*E0001')
    page.get_by_role('button', name='Vérifier').click()
    # L'opérateur de test n'est pas celui de la borne sélectionnée → avertissement + confirmation explicite
    page.wait_for_selector('text=Autre opérateur que celui de la borne', timeout=5000)
    page.screenshot(path=f'{OUT}/a5-qr-autre-operateur.png')
    page.get_by_role('checkbox').click()
    with ctx.expect_page() as pop:
        page.get_by_role('button', name='Continuer vers ce site').click()
    cpo = pop.value
    cpo.wait_for_load_state()
    cpo.screenshot(path=f'{OUT}/a6-page-operateur.png')
    cpo.get_by_role('button', name='Payer et démarrer la recharge').click()
    cpo.wait_for_selector('text=Paiement accepté', timeout=5000)
    cpo.screenshot(path=f'{OUT}/a7-paiement-accepte.png')
    page.bring_to_front()
    page.wait_for_selector('text=Paiement en cours chez', timeout=10000)
    page.screenshot(path=f'{OUT}/a8-paiement-en-cours.png')
    page.get_by_role('button', name='J’ai payé et la charge a démarré').click()
    page.wait_for_selector('text=Recharge en cours', timeout=5000)
    page.reload(wait_until='networkidle')
    page.wait_for_selector('text=Recharge en cours', timeout=10000)
    log.append('état de recharge conservé après rechargement : OK')
    page.wait_for_timeout(1500)
    page.screenshot(path=f'{OUT}/a8-suivi.png')
    page.get_by_role('button', name='J’ai terminé ma recharge').click()
    page.wait_for_selector('text=Récapitulatif', timeout=5000)
    page.screenshot(path=f'{OUT}/a9-recap.png')
    log.append('paiement direct (connecteur scan → page opérateur → suivi) : OK')
    b.close()

print('\n'.join(log))

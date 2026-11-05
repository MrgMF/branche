"""E2E V2 « paiement A → Z » sans compte : détection → Recharger ici → point → prix/estimation → QR vérifié →
page CPO de test → démarrage → suivi → fin → historique → export CSV ; parcours « carte au lecteur » (API coupée :
dégradation propre) ; parcours « échec de démarrage » ouvert par lien profond /recharger?evse=.

Prérequis : un site assemblé (scripts/assemble-site.mjs + scripts/e2e-setup.mjs) avec une app exportée par
  EXPO_OFFLINE=1 BASE_URL=/branche/app DATA_URL=http://127.0.0.1:8080/branche/data SITE_URL=http://127.0.0.1:8080/branche \
  API_URL=http://127.0.0.1:8787 DEV_TRUSTED_HOSTS=localhost:8090 npx expo export -p web --clear
Usage : python3 scripts/e2e-v2-paiement.py <dossier_site> <dossier_captures>
Le script sert lui-même <dossier_site> sous /branche/ (port 8080), lance le CPO de test (:8090) et l'API en mode démo
(:8787), et complète les données de test (borne FRTSTP0001 à 2 points, index EVSE). Données réelles IRVE sinon.
"""
import http.server
import json
import os
import subprocess
import sys
import threading
import time
import urllib.request

from playwright.sync_api import sync_playwright

SITE = os.path.abspath(sys.argv[1])
OUT = sys.argv[2]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = 'http://127.0.0.1:8080/branche'
API = 'http://127.0.0.1:8787'
os.makedirs(OUT, exist_ok=True)
STUB_STYLE = {"version": 8, "glyphs": "https://example.invalid/{fontstack}/{range}.pbf", "sources": {},
              "layers": [{"id": "bg", "type": "background", "paint": {"background-color": "#E6ECEA"}}]}
TEST_POS = {'latitude': 48.75856, 'longitude': 2.30352}       # à ~6 m de la borne de test FRTSTP0001
EXPRESS_POS = {'latitude': 48.76304, 'longitude': 2.30668}    # Metropolis Express Antony (réelle, CB, 150 kW)
log = []


def ok(msg):
    log.append(f'OK  {msg}')
    print(f'OK  {msg}', flush=True)


def fnv_bucket(i):
    h = 0x811c9dc5
    for c in i.upper().replace('*', '').replace(' ', ''):
        h ^= ord(c)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return '%02x' % (h % 256)


def setup_data():
    data = os.path.join(SITE, 'data')
    tile_path = os.path.join(data, 'tiles', '195_9.json')
    tile = json.load(open(tile_path))
    tile['s'] = [s for s in tile['s'] if s['id'] != 'FRTSTP0001']
    tile['s'].append({
        'id': 'FRTSTP0001', 'n': 'Borne de test (CPO local)', 'o': 'Opérateur Test', 'ok': 'test', 'tel': '+33 1 23 45 67 89',
        'lat': 48.7585, 'lon': 2.3035, 'p': 2, 'kw': 22, 'c': ['t2'], 'pay': ['qr_dynamique'],
        'prix': '0,49E/kWh puis 30 min de parking gratuit une fois la charge terminée. Aprè 30 min, 0,09E/min de parking supplémentaire.',
        'pdc': [['FR*TST*E0001', 22, ['t2']], ['FR*TST*E0002', 22, ['t2']]],
    })
    json.dump(tile, open(tile_path, 'w'))
    for i in ['FRTSTP0001', 'FRTSTE0001', 'FRTSTE0002']:
        p = os.path.join(data, 'evse', f'{fnv_bucket(i)}.json')
        idx = json.load(open(p)) if os.path.exists(p) else {'v': 1, 'm': {}}
        idx['m'][i] = '195_9'
        json.dump(idx, open(p, 'w'))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=SITE, **k)

    def translate_path(self, path):
        path = path.split('?', 1)[0].split('#', 1)[0]
        if path.startswith('/branche'):
            path = path[len('/branche'):] or '/'
        return super().translate_path(path)

    def send_error(self, code, message=None, explain=None):
        if code == 404:
            body = open(os.path.join(SITE, '404.html'), 'rb').read()
            self.send_response(200 if self.path.split('?')[0].startswith('/branche/app/') else 404)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().send_error(code, message, explain)

    def log_message(self, *a):
        pass


def wait_http(url, t=40):
    end = time.time() + t
    while time.time() < end:
        try:
            urllib.request.urlopen(url, timeout=2)
            return
        except Exception:
            time.sleep(0.5)
    raise RuntimeError(f'{url} injoignable')


def shot(page, name, full=False):
    page.wait_for_timeout(400)
    page.screenshot(path=f'{OUT}/{name}.png', full_page=full)


def new_ctx(b, pos):
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, geolocation=pos,
                        permissions=['geolocation', 'notifications'], locale='fr-FR', timezone_id='Europe/Paris', accept_downloads=True)
    ctx.route('**/tiles.openfreemap.org/**', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps(STUB_STYLE)))
    ctx.route('**/fonts.gstatic.com/**', lambda r: r.abort())
    ctx.route('**/v1/incidents**', lambda r: r.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'},
                                                       body=json.dumps({'updatedAt': None, 'source': 'test', 'feedOk': True, 'incidents': []})))
    return ctx


def no_overflow(page, label):
    w = page.evaluate('() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)')
    assert w <= 392, f'{label} : débordement horizontal ({w}px)'


setup_data()
threading.Thread(target=lambda: http.server.ThreadingHTTPServer(('127.0.0.1', 8080), Handler).serve_forever(), daemon=True).start()
procs = [
    subprocess.Popen(['node', os.path.join(ROOT, 'scripts/test-cpo.mjs'), '8090'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL),
    subprocess.Popen(['npx', 'tsx', 'src/server.ts'], cwd=os.path.join(ROOT, 'apps/api'), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     env={**os.environ, 'PORT': '8787', 'HOST': '127.0.0.1', 'PAYMENT_PROVIDER': 'mock', 'LOG_LEVEL': 'warn'}),
]
try:
    wait_http(f'{BASE}/app/')
    wait_http('http://127.0.0.1:8090/pay')
    wait_http(f'{API}/v1/config')

    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])

        # ---------- A. QR vérifié, de l'arrivée au reçu ----------
        ctx = new_ctx(b, TEST_POS)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(f'{BASE}/app/?bienvenue=1', wait_until='networkidle')
        page.wait_for_selector('text=Toutes les bornes, une seule appli', timeout=20000)
        shot(page, 'a0-bienvenue-1')
        page.get_by_role('button', name='Suivant').click()
        page.wait_for_selector('text=Aucun compte, aucun mot de passe')
        shot(page, 'a0-bienvenue-2')
        page.get_by_role('button', name='Suivant').click()
        page.wait_for_selector('text=Votre position, pour vous reconnaître')
        shot(page, 'a0-bienvenue-3')
        page.get_by_role('button', name='Autoriser la position').click()
        ok('premier lancement : 3 écrans, permission de position expliquée')

        page.wait_for_selector('text=Vous êtes à', timeout=20000)
        page.wait_for_selector('text=Borne de test (CPO local)')
        shot(page, 'a1-detection')
        ok('détection « Vous êtes à » (< 60 m)')
        t0 = time.time()
        gestures = 0
        page.get_by_role('button', name='Recharger ici').first.click(); gestures += 1
        page.wait_for_selector('text=Choisissez votre point de charge')
        page.wait_for_selector('text=0002')
        no_overflow(page, 'points')
        shot(page, 'a2-points')
        page.get_by_role('button', name='Point se terminant par 0 0 0 1', exact=False).click(); gestures += 1
        page.wait_for_selector('text=Prix avant de payer')
        page.wait_for_selector('text=Énergie : 0,49 €/kWh')
        page.wait_for_selector('text=Occupation après la charge')
        page.wait_for_selector('text=Pré-autorisation')
        no_overflow(page, 'prix')
        shot(page, 'a3-prix')
        page.get_by_text('Payer d’abord, puis brancher').scroll_into_view_if_needed()
        shot(page, 'a3b-methode')
        ok('prix analysé (0,49 €/kWh + occupation après 30 min), estimation et pré-autorisation affichés')
        page.get_by_role('button', name='Scanner le QR code').click(); gestures += 1
        page.wait_for_selector('text=Payer la borne')
        page.get_by_text('Point …0001', exact=True).wait_for()
        # Sur ordinateur, pas d'appareil photo : contenu du QR saisi (même vérification que le scan)
        box = page.get_by_placeholder('ex. FR*ABC*E1234 ou https://…')
        box.fill('https://bit.ly/borne-paiement')
        page.get_by_role('button', name='Vérifier').click()
        page.wait_for_selector('text=paiement bloqué')
        ok('anti-quishing : lien raccourci bloqué')
        box.fill('http://localhost:8090/pay?evse=FR*TST*E0001')
        page.get_by_role('button', name='Vérifier').click()
        page.wait_for_selector('text=Domaine de l’opérateur (base IRVE)')
        shot(page, 'a4-qr-verifie')
        with ctx.expect_page() as pop:
            page.get_by_role('button', name='Payer sur la page Opérateur Test').click(); gestures += 1
        elapsed = time.time() - t0
        ok(f'de « Recharger ici » à la page de paiement : {gestures} gestes (hors saisie du QR), {elapsed:.1f} s')
        assert gestures <= 4
        cpo = pop.value
        cpo.wait_for_load_state()
        cpo.screenshot(path=f'{OUT}/a5-page-operateur.png')
        cpo.get_by_role('button', name='Payer et démarrer la recharge').click()
        cpo.wait_for_selector('text=Paiement accepté')
        cpo.close()
        page.bring_to_front()
        page.wait_for_selector('text=Paiement chez Opérateur Test', timeout=10000)
        shot(page, 'a6-demarrage')
        page.get_by_role('button', name='La charge a démarré').click()
        page.wait_for_selector('text=Coût estimé')
        page.wait_for_selector('text=Occupation facturée à partir de')
        page.wait_for_timeout(1500)
        no_overflow(page, 'suivi')
        shot(page, 'a7-suivi')
        ok('démarrage confirmé en un geste, suivi en direct (%, kWh, coût, heure de fin, alerte d’occupation)')
        page.reload(wait_until='networkidle')
        page.goto(f'{BASE}/app/', wait_until='networkidle')
        page.wait_for_selector('text=Recharge en cours chez Opérateur Test', timeout=15000)
        page.get_by_role('button', name='Recharge en cours chez Opérateur Test · Reprendre').click()
        page.wait_for_selector('text=Coût estimé')
        ok('app rechargée : recharge reprise depuis l’accueil (état persistant)')
        page.get_by_role('button', name='J’ai terminé ma recharge').click()
        page.wait_for_selector('text=Ça a marché ?')
        page.get_by_role('radio', name='Oui').click()
        page.get_by_placeholder('ex. 12,40').fill('9,80')
        shot(page, 'a8-fin')
        page.get_by_role('button', name='Enregistrer le reçu').click()
        page.wait_for_selector('text=Reçu enregistré')
        shot(page, 'a9-recu')
        page.get_by_role('button', name='Voir l’historique').click()
        page.get_by_role('heading', name='Mes recharges', exact=True).wait_for()
        page.get_by_text('9,80 €').first.wait_for()
        no_overflow(page, 'historique')
        shot(page, 'a10-historique')
        with page.expect_download() as dl:
            page.get_by_role('button', name='Exporter en CSV').click()
        path = f'{OUT}/export.csv'
        dl.value.save_as(path)
        csv = open(path, encoding='utf-8-sig').read()
        assert 'Borne de test (CPO local)' in csv and '9,8' in csv and 'FR*TST*E0001' in csv, csv
        ok(f'historique (total du mois) + export CSV ({dl.value.suggested_filename})')
        com = json.load(urllib.request.urlopen(f'{API}/v1/stations/FRTSTP0001/community'))
        assert com['checkins'] == 1 and com['okCount'] == 1 and com['recentPrices'][0]['pricePaid'] == 9.8, com
        ok('retour anonyme reçu par l’API (fiabilité 1/1, prix constaté 9,80 €)')
        page.goto(f'{BASE}/app/recharger?station=FRTSTP0001', wait_until='networkidle')
        page.wait_for_selector('text=Fiabilité : 1 recharge réussie sur 1', timeout=15000)
        shot(page, 'a11-fiabilite-hub')
        ok('fiabilité communautaire affichée dans le parcours')
        assert not errors, errors
        ctx.close()

        # ---------- B. Carte bancaire au lecteur, API coupée (dégradation propre), véhicule ----------
        ctx = new_ctx(b, EXPRESS_POS)
        ctx.route('**/127.0.0.1:8787/**', lambda r: r.abort())
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(f'{BASE}/app/', wait_until='networkidle')
        page.wait_for_selector('text=Vous êtes à', timeout=20000)
        page.wait_for_selector('text=Metropolis - Express - Antony')
        shot(page, 'b1-detection')
        page.get_by_role('button', name='Recharger ici').first.click()
        page.wait_for_selector('text=Votre véhicule ?')
        shot(page, 'b2-vehicule-propose')
        page.get_by_role('button', name='Choisir').click()
        page.get_by_role('heading', name='Votre véhicule', exact=True).wait_for()
        page.get_by_label('Rechercher un modèle').fill('megane')
        page.get_by_role('radio', name='Renault Mégane E-Tech 60 kWh', exact=False).click()
        page.get_by_role('radio', name='30 %').click()
        shot(page, 'b3-vehicule')
        page.get_by_role('button', name='Enregistrer Renault Mégane E-Tech 60 kWh').click()
        page.wait_for_selector('text=Choisissez votre point de charge')
        page.wait_for_selector('text=incompatible')
        shot(page, 'b4-points-filtres')
        ok('véhicule proposé (facultatif) ; points filtrés (CHAdeMO masqué pour une Mégane)')
        page.get_by_role('button', name='Point se terminant par B 1 P 1', exact=False).click()
        page.wait_for_selector('text=Carte bancaire sur la borne')
        page.wait_for_selector('text=Brancher d’abord, puis payer')
        page.wait_for_selector('text=Estimation pour Renault Mégane E-Tech 60 kWh, de 30 % à 80 %')
        shot(page, 'b5-prix-cb')
        page.get_by_text('Brancher d’abord, puis payer').scroll_into_view_if_needed()
        shot(page, 'b5b-methode-cb')
        ok('méthode recommandée : CB au lecteur (IRVE), mode d’emploi DC « brancher d’abord » ; tarif = lien opérateur')
        page.get_by_role('button', name='J’ai payé par carte').click()
        page.wait_for_selector('text=Payez sur le lecteur de la borne')
        page.get_by_role('button', name='La charge a démarré').click()
        page.wait_for_selector('text=Coût estimé')
        page.wait_for_selector('text=Prix inconnu')
        shot(page, 'b6-suivi-cb')
        page.get_by_role('button', name='J’ai terminé ma recharge').click()
        page.get_by_role('button', name='Enregistrer le reçu').click()
        page.wait_for_selector('text=Reçu enregistré')
        ok('« J’ai payé par carte » suivi comme les autres méthodes ; fonctionne sans l’API')
        assert not errors, errors
        ctx.close()

        # ---------- C. Lien profond + échec de démarrage → dépannage ----------
        ctx = new_ctx(b, {'latitude': 48.85, 'longitude': 2.35})  # loin de la borne : chargement via l'index EVSE
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(f'{BASE}/app/recharger?evse=FR*TST*E0002', wait_until='networkidle')
        page.wait_for_selector('text=Prix avant de payer', timeout=20000)
        page.wait_for_selector('text=…0002')
        shot(page, 'c1-lien-profond')
        ok('lien profond /recharger?evse= : borne et point ouverts directement (index EVSE)')
        page.get_by_role('button', name='Scanner le QR code').click()
        page.get_by_placeholder('ex. FR*ABC*E1234 ou https://…').fill('http://localhost:8090/pay?evse=FR*TST*E0002')
        page.get_by_role('button', name='Vérifier').click()
        page.wait_for_selector('text=Domaine de l’opérateur (base IRVE)')
        with ctx.expect_page() as pop:
            page.get_by_role('button', name='Payer sur la page Opérateur Test').click()
        pop.value.close()
        page.wait_for_selector('text=Paiement chez Opérateur Test')
        page.get_by_role('button', name='Ça ne démarre pas').click()
        page.wait_for_selector('text=La charge ne démarre pas')
        page.get_by_role('button', name='Signaler la borne hors service').click()
        page.wait_for_selector('text=signalée hors service', timeout=10000)
        no_overflow(page, 'dépannage')
        shot(page, 'c2-depannage')
        ok('échec de démarrage : dépannage (autre point, autre méthode, appeler, signaler borne_hs → API)')
        page.get_by_role('button', name='Essayer un autre point').click()
        page.wait_for_selector('text=Choisissez votre point de charge')
        shot(page, 'c3-autre-point')
        ok('« Essayer un autre point » ramène au choix du point')
        com = json.load(urllib.request.urlopen(f'{API}/v1/stations/FRTSTP0001/community'))
        # Même appareil (même IP) et même station dans les 6 h : l'API ignore le doublon (anti-abus)
        assert com['checkins'] == 1 and com['lastFailAt'] is None, com
        ok('second retour du même appareil pour la même borne ignoré (anti-doublon)')
        assert not errors, errors
        ctx.close()
        b.close()
finally:
    for pr in procs:
        pr.terminate()

print('\n'.join(log))

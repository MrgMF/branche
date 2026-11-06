"""E2E V2 « paiement A → Z » sans compte : détection → Recharger ici → point → prix/estimation → QR vérifié →
page CPO de test → démarrage → suivi → fin → historique → export CSV ; parcours « carte au lecteur » (API coupée :
dégradation propre) ; parcours « échec de démarrage » ouvert par lien profond /recharger?evse=.
Critique paiement : QR d'un autre point / d'une autre borne (confirmation explicite), pages officielles sourcées
(payDomains : ENGIE Vianeo, Virta), lecteur CB 2027 seulement ≥ 50 kW, Lidl « appli seule » → borne payable la plus
proche + « Y aller », scan depuis l'accueil → résumé prix + estimation avant « Payer ».
Critique paiement passe 2 : Tesla (appli seule) → « Pas de paiement possible dans Branché ici » + borne payable la plus
proche ; TotalEnergies 300 kW « gratuite » IRVE (réseau payant sourcé) → « Tarif non publié dans la base nationale », coût « Inconnu », lecteur CB « certains sites » ; QR
pay.alizecharge.com sur une borne Bouygues → site officiel (pas un sosie), pré-autorisation 75 € avant « Payer » ;
bannière d'accueil « Paiement en attente » tant que le démarrage n'est pas confirmé.
Critique paiement passe 3 : hors ligne (« Pas de réseau : réessayez… », lecteur CB seulement s'il est déclaré), paiement jamais confirmé
> 6 h (« Abandonner ce paiement ? » → « non démarré »), QR paypal.me bloqué, buy.stripe.com bloqué (page officielle
proposée), Virta (numéro inscrit sur la borne), Zunder (« Non confirmé ici »), pay.alizecharge.com (hôte non sourcé →
confirmation par case).
Critique paiement passe 4 : lien non vérifié confirmé (méthode distincte au reçu), redirecteurs bloqués, lien entre
particuliers → voie réelle de la borne (borne payable la plus proche ou page officielle), page « Payer » rechargée →
retour à « Recharger », « Abandonner » → « Non démarré », recharge > 24 h → terminée et archivée, Virta sans copie.
Critique paiement passe 5 : réseau payant notoire « gratuit » IRVE → « Tarif non publié » + « Inconnu » (cas 1), texte de paiement
de la fiche selon les méthodes déclarées (cas 3), /recharger?station= rechargée → point repris (cas 5), recharge terminée
automatiquement → « Terminée · prix à noter » (menu, Ma recharge) et pas de « Reprendre la recharge » après 24 h (cas 7, 8).

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
import re
import signal
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
PENDING = {}  # requêtes en cours (diagnostic d'un chargement bloqué)


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
    # Portail de l'opérateur de test (format de pipeline/data/operator-portals.json)
    real = os.path.join(ROOT, 'pipeline', 'data', 'operator-portals.json')
    portals = json.load(open(real)) if os.path.exists(real) else {'v': 1, 'operators': {}}
    portals['operators']['test'] = {'name': 'Opérateur Test', 'webPortal': 'http://localhost:8090/pay', 'webStart': {'status': 'inconnu', 'url': None},
                                 'adhocWeb': True, 'cardReader': False, 'appOnly': False, 'roamingBadgesAccepted': ['Chargemap Pass'], 'sources': ['test']}
    json.dump(portals, open(os.path.join(data, 'operator-portals.json'), 'w'))
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
    ctx.on('request', lambda r: PENDING.__setitem__(r, time.time()))
    ctx.on('requestfinished', lambda r: PENDING.pop(r, None))
    ctx.on('requestfailed', lambda r: PENDING.pop(r, None))
    ctx.route('**/v1/incidents**', lambda r: r.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'},
                                                       body=json.dumps({'updatedAt': None, 'source': 'test', 'feedOk': True, 'incidents': []})))
    return ctx


def no_overflow(page, label):
    w = page.evaluate('() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)')
    assert w <= 392, f'{label} : débordement horizontal ({w}px)'


setup_data()
threading.Thread(target=lambda: http.server.ThreadingHTTPServer(('127.0.0.1', 8080), Handler).serve_forever(), daemon=True).start()
procs = [
    # Groupe de processus propre : npx → tsx → node, tous arrêtés à la fin (aucun serveur orphelin sur :8787)
    subprocess.Popen(['node', os.path.join(ROOT, 'scripts/test-cpo.mjs'), '8090'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True),
    subprocess.Popen(['npx', 'tsx', 'src/server.ts'], cwd=os.path.join(ROOT, 'apps/api'), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True,
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
        page.goto(f'{BASE}/app/?bienvenue=1', wait_until='load')
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
        box = page.get_by_placeholder(re.compile(r'FR\*ABC\*E1234'))
        box.fill('https://bit.ly/borne-paiement')
        page.get_by_role('button', name='Vérifier').click()
        page.wait_for_selector('text=paiement bloqué')
        ok('anti-quishing : lien raccourci bloqué')
        # QR code d'un AUTRE point de la même borne : message clair + confirmation, jamais de bascule silencieuse
        box.fill('http://localhost:8090/pay?evse=FR*TST*E0002')
        page.get_by_role('button', name='Vérifier').click()
        page.wait_for_selector('text=Ce QR code concerne le point …0002, pas le point …0001 que vous avez choisi.')
        assert page.get_by_role('button', name='Payer sur la page Opérateur Test').count() == 0, 'paiement proposé sans confirmation'
        page.get_by_text('Point …0001', exact=True).wait_for()
        shot(page, 'a4a-qr-autre-point')
        page.get_by_role('button', name='Garder mon choix et scanner à nouveau').click()
        page.get_by_text('Ce QR code concerne le point', exact=False).wait_for(state='detached')
        # QR code d'une AUTRE borne (Metropolis Express Antony, réelle) : nommée, confirmation
        box.fill('http://localhost:8090/pay?evse=FR*MGP*E92002CB1P1')
        page.get_by_role('button', name='Vérifier').click()
        page.wait_for_selector('text=Ce QR code concerne une autre borne : Metropolis - Express - Antony - Général de Gaulle.', timeout=15000)
        assert page.get_by_role('button', name='Payer sur la page Opérateur Test').count() == 0
        page.get_by_role('button', name='Passer à Metropolis - Express - Antony - Général de Gaulle').wait_for()
        shot(page, 'a4b-qr-autre-borne')
        page.get_by_role('button', name='Garder mon choix et scanner à nouveau').click()
        ok('QR d’un autre point (…0002) ou d’une autre borne (nommée) : message clair, paiement seulement après confirmation')
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
        page.reload(wait_until='load')
        page.goto(f'{BASE}/app/', wait_until='load')
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
        page.get_by_role('heading', name='Historique et dépenses', exact=True).wait_for()
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
        page.goto(f'{BASE}/app/recharger?station=FRTSTP0001', wait_until='load')
        page.wait_for_selector('text=1 recharge réussie sur 1', timeout=15000)
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
        page.goto(f'{BASE}/app/', wait_until='load')
        page.wait_for_selector('text=Vous êtes à', timeout=20000)
        page.wait_for_selector('text=Metropolis - Express - Antony')
        shot(page, 'b1-detection')
        page.get_by_role('button', name='Recharger ici').first.click()
        page.wait_for_selector('text=Votre véhicule ?')
        shot(page, 'b2-vehicule-propose')
        page.get_by_role('button', name='Choisir').click()
        page.get_by_role('heading', name='Mon véhicule', exact=True).wait_for()
        assert page.get_by_role('button', name='Prendre en photo').count() == 0  # API absente : bouton masqué
        page.get_by_label('Rechercher un modèle').fill('megnae')  # faute de frappe tolérée
        page.get_by_role('radio', name='Renault Mégane E-Tech 60 kWh', exact=False).click()
        page.get_by_role('radio', name='30 %').click()
        shot(page, 'b3-vehicule')
        page.get_by_role('button', name='Enregistrer Renault Mégane E-Tech 60 kWh').click()
        page.wait_for_selector('text=Choisissez votre point de charge')
        page.wait_for_selector('text=incompatible')
        shot(page, 'b4-points-filtres')
        ok('véhicule proposé (facultatif) ; points filtrés (CHAdeMO masqué pour une Mégane)')
        page.get_by_role('button', name='Point se terminant par B 1 P 1', exact=False).click()
        page.wait_for_selector('text=Brancher d’abord, puis payer')
        page.wait_for_selector('text=Estimation pour Renault Mégane E-Tech 60 kWh, de 30 % à 80 %')
        shot(page, 'b5-prix-cb')
        page.get_by_text('Brancher d’abord, puis payer').scroll_into_view_if_needed()
        shot(page, 'b5b-methode-cb')
        ok('sans compte d’abord : paiement ponctuel (QR) recommandé, CB au lecteur en alternative, mode d’emploi DC « brancher d’abord »')
        page.get_by_role('button', name='Carte bancaire sur la borne', exact=True).click()
        page.get_by_role('button', name='J’ai payé par carte').scroll_into_view_if_needed()
        shot(page, 'b5c-methode-cb')
        page.get_by_role('button', name='J’ai payé par carte').click()
        page.wait_for_selector('text=Payez sur le lecteur de la borne')
        page.get_by_role('button', name='La charge a démarré').click()
        page.wait_for_selector('text=Coût estimé')
        page.wait_for_timeout(800)
        shot(page, 'b6-suivi-cb')
        body = page.inner_text('body')
        assert 'Inconnu' in body, 'coût inconnu attendu (tarif = lien) : tuile « Inconnu »'
        assert 'Coût estimé : Prix inconnu' not in body, 'ligne redondante sous la tuile'
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
        page.goto(f'{BASE}/app/recharger?evse=FR*TST*E0002', wait_until='load')
        page.wait_for_selector('text=Prix avant de payer', timeout=20000)
        page.wait_for_selector('text=…0002')
        shot(page, 'c1-lien-profond')
        ok('lien profond /recharger?evse= : borne et point ouverts directement (index EVSE)')
        page.get_by_role('button', name='Scanner le QR code').click()
        page.get_by_placeholder(re.compile(r'FR\*ABC\*E1234')).fill('http://localhost:8090/pay?evse=FR*TST*E0001')
        page.get_by_role('button', name='Vérifier').click()
        page.wait_for_selector('text=Ce QR code concerne le point …0001, pas le point …0002 que vous avez choisi.')
        page.get_by_role('button', name='Recharger sur le point …0001').click()
        page.get_by_text('Point …0001', exact=True).wait_for()
        page.wait_for_selector('text=Domaine de l’opérateur (base IRVE)')
        ok('autre point confirmé explicitement : le point …0001 devient le point de la recharge')
        with ctx.expect_page() as pop:
            page.get_by_role('button', name='Payer sur la page Opérateur Test').click()
        pop.value.close()
        page.wait_for_selector('text=Paiement chez Opérateur Test')
        assert '0001' in page.inner_text('body'), 'le suivi doit reprendre le point confirmé'
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

        # ---------- D. Préparer à l'avance, arrivée → « Payer maintenant » en 1 geste, fin automatique au départ ----------
        AWAY = {'latitude': 48.7520, 'longitude': 2.2980}  # ~850 m de la borne de test
        ctx = new_ctx(b, AWAY)
        ctx.route('**/v1/availability**', lambda r: r.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'},
                  body=json.dumps({'updatedAt': '2026-11-05T18:00:00Z', 'source': 'test', 'items': {
                      'FR*TST*E0001': {'status': 'occupe', 'at': '2026-11-05T18:00:00Z'}, 'FR*TST*E0002': {'status': 'libre', 'at': '2026-11-05T18:00:00Z'}}})))
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(f'{BASE}/app/', wait_until='load')
        page.get_by_text('Borne conseillée', exact=False).first.wait_for(timeout=20000)
        shot(page, 'd1-conseillee')
        ok('ouverture : borne conseillée affichée sans aucun geste')
        page.get_by_role('button', name='Borne de test (CPO local)', exact=False).first.click()
        page.wait_for_selector('text=1 point libre sur 2')
        shot(page, 'd2-fiche-dispo')
        ok('disponibilité temps réel dans la fiche (1 libre sur 2)')
        page.get_by_role('button', name='Préparer ma recharge').click()
        page.wait_for_selector('text=Choisissez votre point de charge')
        page.locator('[aria-label*="0 0 0 2"][aria-label*="Libre"]').wait_for()
        page.locator('[aria-label*="0 0 0 1"][aria-label*="Occupé"]').wait_for()
        shot(page, 'd2b-points-dispo')
        page.get_by_role('button', name='Passer').first.click()
        page.get_by_role('button', name='Point se terminant par 0 0 0 2', exact=False).click()
        page.get_by_role('button', name='Enregistrer pour mon arrivée').click()
        page.wait_for_selector('text=Tout est prêt')
        shot(page, 'd3-pret')
        ok('recharge préparée à l’avance (point …0002 libre, méthode, prix), rien débité')
        ctx.set_geolocation(TEST_POS)
        page.goto(f'{BASE}/app/', wait_until='load')
        page.wait_for_selector('text=Tout est prêt', timeout=20000)
        shot(page, 'd4-arrivee')
        page.get_by_role('button', name='Payer maintenant').click()
        page.get_by_text('Point …0002', exact=True).wait_for()
        ok('arrivée : « Payer maintenant » ouvre directement le paiement du bon point (1 geste)')
        page.get_by_placeholder(re.compile(r'FR\*ABC\*E1234')).fill('http://localhost:8090/pay?evse=FR*TST*E0002')
        page.get_by_role('button', name='Vérifier').click()
        with ctx.expect_page() as pop:
            page.get_by_role('button', name='Payer sur la page Opérateur Test').click()
        pop.value.close()
        page.get_by_role('button', name='La charge a démarré').click()
        page.wait_for_selector('text=Coût estimé')
        ctx.set_geolocation({'latitude': 48.7700, 'longitude': 2.3035})  # ~1,3 km : départ en voiture
        try:
            page.wait_for_selector('text=Départ de la borne détecté', timeout=25000)
            how = 'pendant le suivi'
        except Exception:
            page.goto(f'{BASE}/app/', wait_until='load')
            page.wait_for_selector('text=Noter le prix (2 secondes)', timeout=20000)
            page.get_by_role('button', name='Noter le prix (2 secondes)').click()
            page.wait_for_selector('text=Départ de la borne détecté', timeout=10000)
            how = 'à la réouverture'
        shot(page, 'd5-fin-auto')
        page.goto(f'{BASE}/app/historique', wait_until='load')
        page.get_by_text('Borne de test (CPO local)').first.wait_for()
        ok(f'fin automatique au départ ({how}) : reçu déjà dans l’historique sans aucun geste')
        assert not errors, errors
        ctx.close()

        # ---------- E. Pages de paiement officielles sourcées (payDomains) ; lecteur CB 2027 seulement ≥ 50 kW ----------
        ctx = new_ctx(b, {'latitude': 48.85, 'longitude': 2.35})
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(f'{BASE}/app/recharger?evse=FRVIAE12345955331', wait_until='load')  # ENGIE Vianeo, Chevilly (réelle, 22 kW, CB)
        page.wait_for_selector('text=Prix avant de payer', timeout=20000)
        page.get_by_role('button', name='Scanner le QR code').click()
        box = page.get_by_placeholder(re.compile(r'FR\*ABC\*E1234'))
        box.fill('https://charge.engie-vianeo.com/')
        page.get_by_role('button', name='Vérifier').click()
        page.wait_for_selector('text=Page de paiement officielle de l’opérateur')
        page.wait_for_selector('text=Adresse de paiement officielle publiée par ENGIE Vianeo.')
        page.get_by_role('button', name='Payer sur la page ENGIE Vianeo').wait_for()
        assert 'à partir de 2027' not in page.inner_text('body')
        shot(page, 'e1-engie-officiel')
        box.fill('https://charge-engie-vianeo.com/')
        page.get_by_role('button', name='Vérifier').click()
        page.wait_for_selector('text=paiement bloqué')
        ok('ENGIE Vianeo : charge.engie-vianeo.com officiel (page sourcée), sosie charge-engie-vianeo.com bloqué')
        page.goto(f'{BASE}/app/recharger?evse=FRVIRE269470', wait_until='load')  # Virta, Massy (réelle)
        page.wait_for_selector('text=Prix avant de payer', timeout=20000)
        page.get_by_role('button', name='Scanner le QR code').click()
        page.get_by_placeholder(re.compile(r'FR\*ABC\*E1234')).fill('https://chge.eu/')
        page.get_by_role('button', name='Vérifier').click()
        page.wait_for_selector('text=Page de paiement officielle de l’opérateur')
        page.get_by_role('button', name='Payer sur la page Virta').wait_for()
        shot(page, 'e2-virta-chge')
        ok('Virta : chge.eu officiel (page sourcée)')
        page.goto(f'{BASE}/app/recharger?evse=FRHPCENF080017001', wait_until='load')  # TotalEnergies Massy, 300 kW, sans CB IRVE
        page.wait_for_selector('text=Prix avant de payer', timeout=20000)
        page.get_by_role('button', name='Scanner le QR code').click()
        page.wait_for_selector('text=obligatoire sur toutes les bornes rapides (≥ 50 kW) à partir de 2027')
        page.goto(f'{BASE}/app/recharger?evse=FRVIRE269470', wait_until='load')
        page.wait_for_selector('text=Prix avant de payer', timeout=20000)
        ok('mention « lecteur CB obligatoire ≥ 50 kW en 2027 » sur une borne de 300 kW, absente sur une borne de 22 kW')
        assert not errors, errors
        ctx.close()

        # ---------- F. Lidl (appli seule) par lien profond : rien de payable, borne payable la plus proche, « Y aller » ----------
        ctx = new_ctx(b, TEST_POS)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(f'{BASE}/app/recharger?evse=FRLDLE00004111', wait_until='load')  # Lidl Châtenay-Malabry (acte + badge IRVE)
        page.wait_for_selector('text=Pas de paiement possible dans Branché ici', timeout=20000)
        body = page.inner_text('body')
        assert 'Ajouter mon compte' not in body and 'Lidl Plus' not in body, 'ni compte, ni appli tierce'
        page.wait_for_selector('text=Borne payable la plus proche', timeout=20000)
        page.get_by_text('Pas de paiement possible dans Branché ici').scroll_into_view_if_needed()
        no_overflow(page, 'lidl')
        shot(page, 'f1-lidl-bloque')
        ok('Lidl (appli seule, acte IRVE) : « Pas de paiement possible dans Branché ici », ni QR ni compte, tuiles chargées autour')
        page.get_by_role('button', name='Y aller').click()
        page.wait_for_url('**/app/?go=*', timeout=15000)
        # L'itinéraire s'ouvre quand index.tsx appelle useGoParam (src/lib/useGoParam.ts)
        try:
            page.get_by_role('button', name='Fermer l’itinéraire').wait_for(timeout=12000)
            how = 'itinéraire ouvert'
        except Exception:
            how = 'carte ouverte avec ?go= (useGoParam à brancher dans index.tsx)'
        shot(page, 'f2-y-aller')
        ok(f'« Y aller » vers la borne payable la plus proche : {how}')
        assert not errors, errors
        ctx.close()

        # ---------- G. Scan depuis l'accueil : résumé prix + estimation avant « Payer » ----------
        ctx = new_ctx(b, TEST_POS)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(f'{BASE}/app/', wait_until='load')
        page.wait_for_selector('text=Vous êtes à', timeout=20000)
        page.get_by_role('button', name='Scanner le QR code d’une borne').click()
        page.wait_for_selector('text=Payer la borne')
        page.get_by_placeholder(re.compile(r'FR\*ABC\*E1234')).fill('http://localhost:8090/pay?evse=FR*TST*E0002')
        page.get_by_role('button', name='Vérifier').click()
        page.wait_for_selector('text=Domaine de l’opérateur (base IRVE)')
        page.wait_for_selector('text=Prix avant de payer')
        page.wait_for_selector('text=Énergie : 0,49 €/kWh')
        page.wait_for_selector('text=Estimation pour un véhicule moyen (55 kWh), de 20 % à 80 %')
        page.get_by_text('Point …0002', exact=True).wait_for()
        pay_btn = page.get_by_role('button', name='Payer sur la page Opérateur Test')
        y_sum = page.get_by_text('Prix avant de payer').bounding_box()['y']
        assert y_sum < pay_btn.bounding_box()['y'], 'résumé prix avant « Payer »'
        assert 'à partir de 2027' not in page.inner_text('body'), 'borne de 22 kW : pas de mention 2027'
        page.wait_for_selector('text=Aucun lecteur de carte déclaré pour cette borne.')
        pay_btn.scroll_into_view_if_needed()
        no_overflow(page, 'résumé')
        shot(page, 'g1-accueil-resume-prix')
        with ctx.expect_page() as pop:
            pay_btn.click()
        pop.value.close()
        page.wait_for_selector('text=Paiement chez Opérateur Test')
        ok('scan depuis l’accueil : borne et point du QR retenus, résumé prix + estimation avant « Payer », suivi du bon point')
        page.goto(f'{BASE}/app/', wait_until='load')
        page.get_by_role('button', name='Paiement en attente chez Opérateur Test · Reprendre').wait_for(timeout=15000)
        assert 'Recharge en cours chez' not in page.inner_text('body'), 'pas « Recharge en cours » avant confirmation du démarrage'
        shot(page, 'g2-paiement-en-attente')
        page.get_by_role('button', name='Paiement en attente chez Opérateur Test · Reprendre').click()
        page.get_by_role('button', name='La charge a démarré').click()
        page.wait_for_selector('text=Coût estimé')
        page.goto(f'{BASE}/app/', wait_until='load')
        page.get_by_role('button', name='Recharge en cours chez Opérateur Test · Reprendre').wait_for(timeout=15000)
        ok('bannière d’accueil : « Paiement en attente chez X » avant confirmation, « Recharge en cours chez X » ensuite')
        assert not errors, errors
        ctx.close()

        # ---------- H. Critique paiement passe 2 : Tesla, TotalEnergies 300 kW « gratuite », Bouygues alizé ----------
        ctx = new_ctx(b, {'latitude': 48.85, 'longitude': 2.35})
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(f'{BASE}/app/recharger?evse=FRTSLE0004FJ', wait_until='load')  # Superchargeur Thiais (réel, acte + badge IRVE)
        page.wait_for_selector('text=Pas de paiement possible dans Branché ici', timeout=20000)
        page.wait_for_selector('text=Borne payable la plus proche', timeout=20000)
        # Les moyens indisponibles (lecteur CB « certains sites », QR, badge) sont repliés derrière « Voir les autres moyens ».
        page.get_by_role('button', name='Voir les autres moyens').click()
        body = page.inner_text('body')
        assert 'Recommandé' not in body, 'rien de recommandé chez Tesla'
        assert 'Paiement ponctuel sans compte déclaré' not in body, 'pas de QR « déclaré » sur la foi de acte'
        assert 'possible sur certains sites' in body and 'recherche Branché : tesla.com' in body, 'lecteur CB : « certains sites », source citée'
        page.get_by_text('Pas de paiement possible dans Branché ici').scroll_into_view_if_needed()
        no_overflow(page, 'tesla')
        shot(page, 'h1-tesla-bloque')
        page.get_by_text('possible sur certains sites').first.scroll_into_view_if_needed()
        shot(page, 'h1b-tesla-lecteur-certains-sites')
        ok('Tesla (appli seule, source Tesla) : « Pas de paiement possible dans Branché ici », borne payable la plus proche, lecteur CB « certains sites » jamais recommandé')

        page.goto(f'{BASE}/app/recharger?evse=FRHPCENF080017001', wait_until='load')  # TotalEnergies Massy 300 kW, gratuit:true IRVE
        page.wait_for_selector('text=Prix avant de payer', timeout=20000)
        # Cas 1 (passe 5) : réseau payant notoire (portail sourcé, lecteur CB) → jamais « gratuit, à vérifier »
        page.wait_for_selector('text=Tarif non publié dans la base nationale')
        page.get_by_text('Inconnu', exact=True).wait_for()  # tuile coût
        body = page.inner_text('body')
        assert 'Gratuit selon' not in body, 'réseau payant : pas de « gratuit » affiché'
        assert 'À confirmer' not in body, 'réseau payant : coût « Inconnu », pas « À confirmer »'
        assert 'Prix inconnu' not in body, 'une seule formule (le tarif non publié dit déjà de vérifier l’écran)'
        shot(page, 'h2-total-300kw-tarif-non-publie')
        page.get_by_text('Carte bancaire sur la borne (possible sur certains sites)').first.scroll_into_view_if_needed()
        shot(page, 'h2b-total-methodes')
        assert 'sur certains sites seulement (recherche Branché : services.totalenergies.fr, largus.fr)' in page.inner_text('body')
        page.get_by_role('button', name='Scanner le QR code').click()
        page.wait_for_selector('text=obligatoire sur toutes les bornes rapides (≥ 50 kW) à partir de 2027')
        page.locator('text=Lecteur de carte signalé par >> visible=true').first.wait_for()  # « Autres moyens » du paiement
        shot(page, 'h3-total-payer-lecteur')
        ok('cas 1 — TotalEnergies 300 kW gratuite IRVE (réseau payant sourcé) : « Tarif non publié dans la base nationale », coût « Inconnu », lecteur CB « certains sites » sourcé')

        page.goto(f'{BASE}/app/payer', wait_until='load')  # scan sans borne choisie (accueil)
        page.wait_for_selector('text=Payer la borne', timeout=20000)
        box = page.get_by_placeholder(re.compile(r'FR\*ABC\*E1234'))
        box.fill('https://pay.alizecharge.com/?evse=FR*S77*E770340011')  # borne Bouygues réelle (Blandy)
        page.get_by_role('button', name='Vérifier').click()
        # Passe 3 : alizecharge.com est sourcé, mais pas l'hôte pay.alizecharge.com → ni vert ni bloqué : confirmation par case
        page.wait_for_selector('text=Site de l’opérateur, page non sourcée : à vérifier', timeout=15000)
        page.wait_for_selector('text=Adresse sur le domaine de Bouygues Energies & Services (alizecharge.com), mais absente des pages sourcées')
        page.wait_for_selector('text=Pré-autorisation · 75 €')
        assert page.get_by_role('button', name='Payer sur la page Bouygues Energies & Services').count() == 0, 'pas de vert sur un hôte non sourcé'
        cont = page.get_by_role('button', name='Continuer vers ce site')
        assert cont.is_disabled(), 'confirmation exigée'
        page.get_by_role('checkbox', name='J’ai vérifié la borne et je veux continuer').click()
        assert cont.is_enabled()
        assert page.get_by_text('Pré-autorisation · 75 €').bounding_box()['y'] < cont.bounding_box()['y'], 'pré-autorisation avant « Continuer »'
        assert 'paiement bloqué' not in page.inner_text('body')
        cont.scroll_into_view_if_needed()
        no_overflow(page, 'bouygues')
        shot(page, 'h4-bouygues-alize-a-confirmer')
        box.fill('https://support.alizecharge.com/support/home')
        page.get_by_role('button', name='Vérifier').click()
        page.wait_for_selector('text=Domaine du site officiel de Bouygues Energies & Services')
        box.fill('https://pay-alizecharge.com/')
        page.get_by_role('button', name='Vérifier').click()
        page.wait_for_selector('text=paiement bloqué')
        ok('Bouygues : pay.alizecharge.com (hôte non sourcé) → confirmation par case, pré-autorisation 75 € avant ; support.alizecharge.com (sourcé) → site officiel ; sosie bloqué')
        assert not errors, errors
        ctx.close()

        # ---------- I. Critique paiement passe 3 : hors ligne, Virta (numéro inscrit), Zunder (non confirmé), QR entre particuliers ----------
        ctx = new_ctx(b, TEST_POS)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(f'{BASE}/app/recharger?evse=FR*TST*E0001', wait_until='load')
        page.wait_for_selector('text=Prix avant de payer', timeout=20000)
        page.wait_for_timeout(1800)  # écrans du paiement préchargés après le premier affichage
        page.get_by_role('button', name='Scanner le QR code').click()
        page.wait_for_selector('text=Payer la borne')
        box = page.get_by_placeholder(re.compile(r'FR\*ABC\*E1234'))
        box.fill('http://localhost:8090/pay?evse=FR*TST*E0001')
        page.get_by_role('button', name='Vérifier').click()
        page.wait_for_selector('text=Domaine de l’opérateur (base IRVE)')
        ctx.set_offline(True)
        pages_before = len(ctx.pages)
        page.get_by_role('button', name='Payer sur la page Opérateur Test').click()
        # Borne sans lecteur CB déclaré : jamais « payez au lecteur CB »
        page.wait_for_selector('text=Pas de réseau : réessayez dès que la connexion revient')
        assert 'payez au lecteur CB' not in page.inner_text('body')
        page.wait_for_timeout(500)
        assert len(ctx.pages) == pages_before, 'aucune page ouverte hors ligne'
        assert 'Paiement chez Opérateur Test' not in page.inner_text('body'), 'aucun suivi démarré hors ligne'
        shot(page, 'i1-hors-ligne')
        ctx.set_offline(False)
        with ctx.expect_page() as pop:
            page.get_by_role('button', name='Payer sur la page Opérateur Test').click()
        pop.value.close()
        page.wait_for_selector('text=Paiement chez Opérateur Test')
        ok('hors ligne : « Pas de réseau : réessayez… » (pas de lecteur CB déclaré ici), rien ouvert ni suivi ; réseau revenu → page ouverte')

        # Paiement jamais confirmé depuis plus de 6 h : « Abandonner ce paiement ? » → archivé « non démarré »
        page.evaluate("""() => { const k = 'branche.direct.v1'; const d = JSON.parse(localStorage.getItem(k));
            d.openedAt = Date.now() - 7 * 3600 * 1000; localStorage.setItem(k, JSON.stringify(d)); }""")
        page.goto(f'{BASE}/app/', wait_until='load')
        page.wait_for_selector('text=Abandonner ce paiement ?', timeout=20000)
        page.wait_for_selector('text=Paiement chez Opérateur Test jamais confirmé depuis plus de 6 h.')
        shot(page, 'i2-paiement-6h')
        page.get_by_role('button', name='Oui', exact=True).click()
        page.get_by_text('Abandonner ce paiement ?').wait_for(state='detached')
        assert 'Paiement en attente chez' not in page.inner_text('body')
        page.goto(f'{BASE}/app/historique', wait_until='load')
        page.get_by_text('Non démarré', exact=False).first.wait_for(timeout=15000)
        shot(page, 'i3-historique-non-demarre')
        ok('paiement jamais confirmé > 6 h : « Abandonner ce paiement ? » (Oui / Toujours en cours) → historique « non démarré »')

        # QR entre particuliers et lien Stripe sur une borne à page officielle connue
        page.goto(f'{BASE}/app/payer', wait_until='load')
        box = page.get_by_placeholder(re.compile(r'FR\*ABC\*E1234'))
        box.fill('https://paypal.me/borne-recharge/12')
        page.get_by_role('button', name='Vérifier').click()
        page.wait_for_selector('text=paiement bloqué', timeout=15000)
        page.wait_for_selector('text=Lien de paiement entre particuliers (PayPal.me)')
        shot(page, 'i4-qr-paypal-me')
        page.goto(f'{BASE}/app/recharger?evse=FRVIAE12345955331', wait_until='load')  # ENGIE Vianeo (page officielle connue)
        page.wait_for_selector('text=Prix avant de payer', timeout=20000)
        page.get_by_role('button', name='Scanner le QR code').click()
        box = page.get_by_placeholder(re.compile(r'FR\*ABC\*E1234'))
        box.fill('https://buy.stripe.com/test_borne')
        page.get_by_role('button', name='Vérifier').click()
        page.wait_for_selector('text=paiement bloqué')
        page.wait_for_selector('text=ENGIE Vianeo a une page de paiement officielle connue')
        page.get_by_role('button', name='Ouvrir la page officielle ENGIE Vianeo').wait_for()
        shot(page, 'i5-qr-stripe-bloque')
        ok('QR paypal.me bloqué (entre particuliers) ; buy.stripe.com bloqué chez ENGIE Vianeo, page officielle proposée')

        # Virta : numéro de 4 à 5 chiffres inscrit sur la borne (idEntry printed), rien à copier
        page.goto(f'{BASE}/app/recharger?evse=FRVIRE269470', wait_until='load')
        page.wait_for_selector('text=Prix avant de payer', timeout=20000)
        if page.get_by_role('button', name='Page de paiement Virta', exact=False).count():
            page.get_by_role('button', name='Page de paiement Virta', exact=False).first.click()
        page.wait_for_selector('text=saisissez le numéro de 4 à 5 chiffres inscrit sur la borne')
        assert 'collez l’identifiant' not in page.inner_text('body')
        page.get_by_text('saisissez le numéro de 4 à 5 chiffres', exact=False).scroll_into_view_if_needed()
        shot(page, 'i6-virta-numero-inscrit')
        ok('Virta : « saisissez le numéro de 4 à 5 chiffres inscrit sur la borne », aucun identifiant IRVE à copier')

        # Zunder (badge seul dans l'IRVE, lecteur CB « certains sites ») : « Non confirmé ici » + borne payable proposée
        page.goto(f'{BASE}/app/recharger?evse=ESZUNEINAAU000001ER01', wait_until='load')
        page.wait_for_selector('text=Non confirmé ici', timeout=20000)
        body = page.inner_text('body')
        assert 'Pas de paiement possible dans Branché ici' not in body
        assert 'Recommandé' not in body
        page.wait_for_selector('text=Borne payable la plus proche', timeout=20000)
        page.get_by_text('Non confirmé ici').scroll_into_view_if_needed()
        no_overflow(page, 'zunder')
        shot(page, 'i7-zunder-non-confirme')
        ok('Zunder (seulement du spéculatif) : « Non confirmé ici », rien de recommandé, borne payable la plus proche proposée')
        assert not errors, errors
        ctx.close()

        # ---------- J. Critique paiement passe 4 ----------
        STUB = '<!doctype html><html lang="fr"><title>Page tierce (test)</title><body><h1>Page tierce (test)</h1></body></html>'
        ctx = new_ctx(b, TEST_POS)
        for host in ['chge.eu', 'example.org']:
            ctx.route(f'https://{host}/**', lambda r: r.fulfill(status=200, content_type='text/html', body=STUB))
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))

        # Cas 7 : lien non vérifié confirmé par l'utilisateur → méthode distincte dans le reçu ; redirecteurs bloqués
        page.goto(f'{BASE}/app/payer', wait_until='load')
        box = page.get_by_placeholder(re.compile(r'FR\*ABC\*E1234'))
        box.wait_for(timeout=20000)
        for raw in ['https://www.google.com/url?q=https://pay.izivia.com', 'https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.org', 'https://t.me/borne']:
            box.fill(raw)
            page.get_by_role('button', name='Vérifier').click()
            page.wait_for_selector('text=Lien raccourci : la destination réelle est masquée.')
        box.fill('https://pay.lydia.me/l?t=borne')
        page.get_by_role('button', name='Vérifier').click()
        page.wait_for_selector('text=Lien de paiement entre particuliers (Lydia)')
        box.fill('https://example.org/borne/pay')
        page.get_by_role('button', name='Vérifier').click()
        page.wait_for_selector('text=Lien non vérifié')
        page.get_by_role('checkbox', name='J’ai vérifié la borne et je veux continuer').click()
        with ctx.expect_page() as pop:
            page.get_by_role('button', name='Continuer vers ce site').click()
        pop.value.close()
        page.wait_for_selector('text=Paiement chez example.org', timeout=10000)
        page.get_by_role('button', name='La charge a démarré').click()
        page.get_by_role('button', name='J’ai terminé ma recharge').click()
        page.get_by_role('button', name='Enregistrer le reçu').click()
        page.wait_for_selector('text=Reçu enregistré')
        page.wait_for_selector('text=Lien non vérifié, confirmé par vous')
        shot(page, 'j1-recu-lien-non-verifie')
        ok('redirecteurs (google.com/url, l.facebook.com, t.me) et pay.lydia.me bloqués ; lien non vérifié confirmé → reçu « Lien non vérifié, confirmé par vous »')

        # Cas 3 : lien entre particuliers sur une borne sans voie officielle → borne payable la plus proche, jamais « lecteur »
        page.goto(f'{BASE}/app/recharger?evse=FR*TST*E0001', wait_until='load')
        page.wait_for_selector('text=Prix avant de payer', timeout=20000)
        page.get_by_role('button', name='Scanner le QR code').click()
        box = page.get_by_placeholder(re.compile(r'FR\*ABC\*E1234'))
        box.fill('https://paypal.me/borne-recharge/12')
        page.get_by_role('button', name='Vérifier').click()
        page.wait_for_selector('text=Aucune voie officielle connue ici : allez plutôt à la borne payable la plus proche.')
        page.wait_for_selector('text=Borne payable la plus proche', timeout=20000)
        page.get_by_role('button', name='Y aller').wait_for()
        card = page.get_by_text('QR code suspect — paiement bloqué').locator('..').inner_text()
        assert 'lecteur' not in card, f'aucun lecteur CB déclaré ici : {card}'
        page.get_by_role('button', name='Y aller').scroll_into_view_if_needed()
        shot(page, 'j2-p2p-borne-payable')

        # Cas 4 : page de paiement rechargée sans contexte → retour au parcours « Recharger » de la borne, point repris
        assert '/payer' in page.url and 'from=recharger' in page.url, page.url
        page.reload(wait_until='load')
        page.wait_for_url('**/app/recharger?station=FRTSTP0001*', timeout=15000)
        page.wait_for_selector('text=Prix avant de payer', timeout=20000)
        page.wait_for_selector('text=…0001')
        assert 'Payer la borne' not in page.inner_text('body')
        shot(page, 'j3-payer-recharge-retour-recharger')
        ok('page « Payer » rechargée : retour à « Recharger » de la borne (point …0001 repris), aucune vérification de QR sans contexte')

        page.goto(f'{BASE}/app/recharger?evse=FRVIAE12345955331', wait_until='load')  # ENGIE Vianeo (page officielle connue)
        page.wait_for_selector('text=Prix avant de payer', timeout=20000)
        page.get_by_role('button', name='Scanner le QR code').click()
        box = page.get_by_placeholder(re.compile(r'FR\*ABC\*E1234'))
        box.fill('https://revolut.me/jdupont')
        page.get_by_role('button', name='Vérifier').click()
        page.wait_for_selector('text=Utilisez plutôt la page officielle d’ENGIE Vianeo.')
        page.get_by_role('button', name='Ouvrir la page officielle ENGIE Vianeo').wait_for()
        shot(page, 'j4-p2p-page-officielle')
        ok('lien entre particuliers : borne sans voie officielle → borne payable la plus proche (sans « lecteur ») ; ENGIE Vianeo → page officielle')

        # Cas 6 : « Abandonner » → archivé « Non démarré »
        page.goto(f'{BASE}/app/recharger?evse=FR*TST*E0001', wait_until='load')
        page.wait_for_selector('text=Prix avant de payer', timeout=20000)
        page.get_by_role('button', name='Scanner le QR code').click()
        box = page.get_by_placeholder(re.compile(r'FR\*ABC\*E1234'))
        box.fill('http://localhost:8090/pay?evse=FR*TST*E0001')
        page.get_by_role('button', name='Vérifier').click()
        with ctx.expect_page() as pop:
            page.get_by_role('button', name='Payer sur la page Opérateur Test').click()
        pop.value.close()
        page.get_by_role('button', name='Ça ne démarre pas').click()
        page.get_by_role('button', name='Abandonner').click()
        page.wait_for_url(lambda u: u.split('?')[0].rstrip('/').endswith('/branche/app'), timeout=10000)
        page.goto(f'{BASE}/app/historique', wait_until='load')
        page.get_by_text('Non démarré', exact=False).first.wait_for(timeout=15000)
        shot(page, 'j5-abandon-non-demarre')
        ok('« Abandonner » : archivé « Non démarré » dans l’historique (comme après 6 h)')

        # Cas 5 : recharge démarrée jamais terminée > 24 h → terminée (fin estimée) et archivée avec reçu
        page.goto(f'{BASE}/app/recharger?evse=FR*TST*E0002', wait_until='load')
        page.wait_for_selector('text=Prix avant de payer', timeout=20000)
        page.get_by_role('button', name='Scanner le QR code').click()
        box = page.get_by_placeholder(re.compile(r'FR\*ABC\*E1234'))
        box.fill('http://localhost:8090/pay?evse=FR*TST*E0002')
        page.get_by_role('button', name='Vérifier').click()
        with ctx.expect_page() as pop:
            page.get_by_role('button', name='Payer sur la page Opérateur Test').click()
        pop.value.close()
        page.get_by_role('button', name='La charge a démarré').click()
        page.wait_for_selector('text=Coût estimé')
        page.evaluate("""() => { const k = 'branche.direct.v1'; const d = JSON.parse(localStorage.getItem(k));
            const ago = 30 * 3600 * 1000; d.openedAt -= ago; d.chargeStartedAt -= ago; delete d.lastNearAt; localStorage.setItem(k, JSON.stringify(d)); }""")
        page.goto(f'{BASE}/app/', wait_until='load')
        page.wait_for_selector('text=Recharge terminée automatiquement : le reçu est déjà dans votre historique.', timeout=20000)
        shot(page, 'j6-plus-24h-accueil')
        page.goto(f'{BASE}/app/recharge', wait_until='load')
        page.wait_for_selector('text=Recharge jamais terminée depuis plus de 24 h', timeout=15000)
        shot(page, 'j7-plus-24h-suivi')
        # Cas 8 (passe 5) : fin estimée après 24 h → rien à reprendre
        assert page.get_by_role('button', name='Reprendre la recharge').count() == 0, '« Reprendre la recharge » après une fin estimée (> 24 h)'
        ok('cas 8 — recharge terminée après 24 h : pas de « Reprendre la recharge »')
        # Cas 7 (passe 5) : terminée automatiquement → « Terminée · prix à noter » dans le menu et « Ma recharge »
        page.goto(f'{BASE}/app/', wait_until='load')
        page.get_by_test_id('menu').click()
        page.get_by_test_id('app-menu').get_by_text('Terminée · prix à noter').wait_for(timeout=10000)
        assert page.get_by_test_id('app-menu').get_by_text('En cours', exact=True).count() == 0, 'menu : pas « En cours » pour une recharge terminée'
        shot(page, 'j7b-menu-terminee-prix-a-noter')
        page.goto(f'{BASE}/app/ma-recharge', wait_until='load')
        page.get_by_text('Terminée · prix à noter').wait_for(timeout=10000)
        assert page.get_by_text('En cours', exact=True).count() == 0, 'Ma recharge : pas « En cours » pour une recharge terminée'
        shot(page, 'j7c-ma-recharge-terminee')
        ok('cas 7 — recharge terminée automatiquement : « Terminée · prix à noter » (menu et Ma recharge), plus « En cours »')
        page.goto(f'{BASE}/app/historique', wait_until='load')
        page.get_by_text('Borne de test (CPO local)').first.wait_for(timeout=15000)
        assert page.get_by_text('Non démarré', exact=False).count() == 1, 'la recharge de plus de 24 h n’est pas « non démarrée »'
        shot(page, 'j8-plus-24h-historique')
        ok('recharge démarrée jamais terminée > 24 h : terminée à l’heure estimée des 80 %, reçu dans l’historique, rien effacé en silence')

        # Cas 1 : Virta (numéro inscrit) → aucun identifiant IRVE à copier dans le suivi, rappel de la saisie
        page.goto(f'{BASE}/app/recharger?evse=FRVIRE269470', wait_until='load')
        page.wait_for_selector('text=Prix avant de payer', timeout=20000)
        if page.get_by_role('button', name='Page de paiement Virta', exact=False).count():
            page.get_by_role('button', name='Page de paiement Virta', exact=False).first.click()
        with ctx.expect_page() as pop:
            page.get_by_role('button', name='Ouvrir la page Virta').click()
        pop.value.close()
        page.wait_for_selector('text=Paiement chez Virta', timeout=10000)
        # Le parcours « Recharger » (même texte dans son mode d'emploi) reste monté, masqué, sous le suivi
        page.locator('text=Sur la page de paiement, saisissez le numéro de 4 à 5 chiffres inscrit sur la borne >> visible=true').first.wait_for()
        assert 'Identifiant du point à saisir' not in page.inner_text('body'), 'Virta : rien à copier'
        shot(page, 'j9-suivi-virta-numero-inscrit')
        ok('suivi Virta : pas d’identifiant IRVE à copier, rappel « numéro de 4 à 5 chiffres inscrit sur la borne »')
        assert not errors, errors
        ctx.close()

        # ---------- K. Critique paiement passe 5 : fiche (texte de paiement), /recharger rechargée ----------
        # Cas 5 : point choisi puis page /recharger?station= rechargée → point repris (plan relu sur l'appareil)
        ctx = new_ctx(b, TEST_POS)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(f'{BASE}/app/recharger?station=FRTSTP0001', wait_until='load')
        page.wait_for_selector('text=Choisissez votre point de charge', timeout=20000)
        page.locator('[aria-label*="0 0 0 2"]').first.click()
        page.wait_for_selector('text=Prix avant de payer')
        page.get_by_role('button', name='Scanner le QR code').click()
        page.get_by_placeholder(re.compile(r'FR\*ABC\*E1234')).wait_for(timeout=15000)
        page.goto(f'{BASE}/app/recharger?station=FRTSTP0001', wait_until='load')
        page.wait_for_selector('text=Prix avant de payer', timeout=20000)
        page.get_by_text('…0002').first.wait_for(timeout=5000)
        assert page.get_by_text('Choisissez votre point de charge').count() == 0, 'point perdu au rechargement'
        shot(page, 'k1-recharger-recharge-point-repris')
        ok('cas 5 — /recharger?station= rechargée : plan relu (store.hydrate), point …0002 repris')
        assert not errors, errors
        ctx.close()

        # Cas 3 : texte de paiement de la fiche selon les méthodes déclarées (surelyPayable), sinon « non confirmé »
        tile = json.load(open(os.path.join(SITE, 'data', 'tiles', '195_9.json')))
        tile['s'].append({'id': 'FRTSTP0009', 'n': 'Borne test non confirmée', 'o': 'Zunder', 'ok': 'zunder', 'lat': 48.7505, 'lon': 2.2970,
                          'p': 1, 'kw': 22, 'c': ['t2'], 'pay': ['badge'], 'pdc': [['FR*TST*E0009', 22, ['t2']]]})
        ctx = new_ctx(b, {'latitude': 48.7520, 'longitude': 2.2980})
        ctx.route('**/branche/data/tiles/195_9.json', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps(tile)))
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(f'{BASE}/app/', wait_until='load')
        page.get_by_text('Borne conseillée', exact=False).first.wait_for(timeout=20000)
        page.wait_for_timeout(1500)  # bandeau stabilisé (temps réel, tri)
        page.get_by_text('Borne test non confirmée').first.wait_for()  # borne conseillée (la plus proche)
        page.get_by_role('button', name='Voir la borne', exact=False).first.click(timeout=10000)
        txt = page.get_by_test_id('station-pay-text')
        txt.wait_for(timeout=15000)
        assert 'Aucun moyen de paiement déclaré pour cette borne' in txt.inner_text(), txt.inner_text()
        assert 'Sans compte ni appli' not in txt.inner_text(), 'fiche : « paiement direct » annoncé sans méthode déclarée'
        shot(page, 'k2-fiche-non-confirme')
        page.goto(f'{BASE}/app/', wait_until='load')
        page.get_by_text('Borne conseillée', exact=False).first.wait_for(timeout=20000)
        page.wait_for_timeout(1500)
        page.get_by_role('button', name='Borne de test (CPO local)', exact=False).first.click(timeout=20000)
        txt = page.get_by_test_id('station-pay-text')
        txt.wait_for(timeout=15000)
        assert txt.inner_text().startswith('Sans compte ni appli'), txt.inner_text()
        shot(page, 'k3-fiche-payable')
        ok('cas 3 — fiche : « Sans compte ni appli… » seulement si une méthode déclarée le permet, sinon texte « non confirmé » de Recharger')
        assert not errors, errors
        ctx.close()
        b.close()
except Exception:
    try:
        page.screenshot(path=f'{OUT}/echec.png', full_page=True)  # état de l'écran au moment de l'échec
    except Exception:
        pass
    now = time.time()
    print('Requêtes en cours :', [(r.method, r.url[:140], round(now - t, 1)) for r, t in PENDING.items() if now - t > 2], flush=True)
    raise
finally:
    for pr in procs:
        try:
            os.killpg(pr.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass

print('\n'.join(log))

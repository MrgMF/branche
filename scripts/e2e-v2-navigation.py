"""E2E V2 navigation « niveau Waze » : recherche → 3 trajets → choix → guidage → sortie de trajet → recalcul
→ bascule vers un trajet plus rapide → arrivée à la borne → « Recharger ici » ; puis VE (batterie faible),
fournisseur en panne et absence de GPS.

Prérequis : site servi sous /branche (app exportée avec API_URL=<api>), API réelle sur <api> (config, signalements).
Les fournisseurs (TomTom/Valhalla/Photon) sont injoignables dans le bac à sable : POST /v1/route, POST /v1/search
et GET /v1/incidents sont simulés par Playwright avec des réponses au format du contrat v2.
Le GPS est simulé pas à pas (context.set_geolocation) le long du tracé.
Usage : python3 scripts/e2e-v2-navigation.py http://127.0.0.1:8081/branche <dossier_captures>
"""
import json
import re
import math
import sys

from playwright.sync_api import sync_playwright, expect

BASE = sys.argv[1].rstrip('/')
OUT = sys.argv[2]
START = (48.7536, 2.2975)  # Antony (lat, lon)
# Borne réelle de la base IRVE (tuile 195_9) : L'Haÿ-les-Roses, 300 kW
DEST = (48.78393, 2.34575)
STUB_STYLE = {"version": 8, "glyphs": "https://example.invalid/{fontstack}/{range}.pbf", "sources": {},
              "layers": [{"id": "bg", "type": "background", "paint": {"background-color": "#E6ECEA"}}]}
CORS = {'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS'}
VEHICLE = {"id": "renault-5-52", "name": "Renault 5 E-Tech 52 kWh", "batteryKWh": 52, "consumptionKWhPer100": 15, "maxDcKW": 100,
           "maxAcKW": 11, "plugs": ["ccs", "t2"], "socPercent": 40, "socUpdatedAt": 0}
log = []
state = {'mode': 'normal', 'calls': [], 'faster_served': False}


def hav(a, b):
    r = math.pi / 180
    h = math.sin((b[1] - a[1]) * r / 2) ** 2 + math.cos(a[1] * r) * math.cos(b[1] * r) * math.sin((b[0] - a[0]) * r / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


def densify(wps, step=25):
    """wps en (lat, lon) → géométrie [lon, lat] tous les ~25 m, indices des points de passage."""
    pts, idx = [[wps[0][1], wps[0][0]]], [0]
    for (la1, lo1), (la2, lo2) in zip(wps, wps[1:]):
        n = max(1, int(hav([lo1, la1], [lo2, la2]) / step))
        for k in range(1, n + 1):
            pts.append([round(lo1 + (lo2 - lo1) * k / n, 6), round(la1 + (la2 - la1) * k / n, 6)])
        idx.append(len(pts) - 1)
    return pts, idx


def cum(pts):
    c = [0.0]
    for i in range(1, len(pts)):
        c.append(c[-1] + hav(pts[i - 1], pts[i]))
    return c


def make_route(rid, wps, duration, maneuvers, toll=False, traffic=None, limits=None, lanes_at=None):
    geo, idx = densify(wps)
    c = cum(geo)
    steps = []
    for k, (wp, man) in enumerate(zip(idx, maneuvers)):
        m = dict(man)
        m.update({'lon': geo[wp][0], 'lat': geo[wp][1], 'pointIndex': wp, 'offsetM': round(c[wp]),
                  'distanceM': round(c[idx[k + 1]] - c[wp]) if k + 1 < len(idx) else 0})
        if lanes_at is not None and k == lanes_at:
            m['lanes'] = [{"directions": ["left"], "active": True}, {"directions": ["straight"], "active": False}, {"directions": ["straight", "right"], "active": False}]
        steps.append(m)
    r = {"id": rid, "durationS": duration, "trafficDelayS": 0, "distanceM": round(c[-1]), "hasTolls": toll, "hasMotorways": False,
         "geometry": geo, "steps": steps, "trafficSections": []}
    if traffic:
        a, b = int(len(geo) * traffic[0]), int(len(geo) * traffic[1])
        r['trafficSections'] = [{"startIndex": a, "endIndex": b, "delayS": 140, "magnitude": 3}]
        r['trafficDelayS'] = 140
    if limits:
        r['speedLimits'] = [{"startIndex": 0, "endIndex": idx[limits], "kmh": 50}, {"startIndex": idx[limits], "endIndex": len(geo) - 1, "kmh": 70}]
    return r


def mk(text, man, street=None, **kw):
    d = {"instruction": text, "maneuver": man}
    if street:
        d['street'] = street
    d.update(kw)
    return d


def main_route(frm, to, rid='r0', duration=600):
    rb = (48.772, 2.325)
    return make_route(rid, [frm, (48.765, 2.300), rb, (48.779, 2.338), to], duration, [
        mk('Partez sur Rue Velpeau', 'depart', 'Rue Velpeau'),
        mk('Tournez à droite sur Avenue Aristide Briand', 'turn-right', 'Avenue Aristide Briand', angle=90),
        mk('Au rond-point, prenez la 2e sortie sur Rue de Bicêtre', 'roundabout', 'Rue de Bicêtre', exit=2, angle=10),
        mk('Restez à gauche vers L’Haÿ-les-Roses centre', 'keep-left', 'Avenue Larroumès', towards='L’Haÿ-les-Roses centre'),
        mk('Vous êtes arrivé à destination', 'arrive')], traffic=(0.62, 0.72), limits=2, lanes_at=3)


def alt_routes(frm, to):
    a1 = make_route('r1', [frm, (48.750, 2.330), to], 960, [mk('Partez sur Rue Velpeau', 'depart', 'Rue Velpeau'),
                    mk('Serrez à gauche sur D920', 'slight-left', 'D920'), mk('Vous êtes arrivé', 'arrive')])
    a2 = make_route('r2', [frm, (48.792, 2.300), to], 1080, [mk('Partez', 'depart'), mk('Prenez la sortie 4 à droite vers Paris', 'exit-right', 'A86', exitNumber='4', towards='Paris'),
                    mk('Vous êtes arrivé', 'arrive')], toll=True)
    return [a1, a2]


def body_for(routes, provider='tomtom'):
    b = dict(routes[0])
    b.pop('id')
    b.update({"provider": provider, "traffic": True, "alternativesConsidered": len(routes), "attribution": "© TomTom", "routes": routes,
              "options": {"avoidTolls": False, "avoidMotorways": False}})
    return b


def fake_route(route):
    req = route.request
    if req.method == 'OPTIONS':
        return route.fulfill(status=204, headers=CORS)
    q = json.loads(req.post_data)
    state['calls'].append(q)
    if state['mode'] == 'down':
        return route.fulfill(status=502, headers=CORS, content_type='application/json',
                             body=json.dumps({"error": {"code": "route_provider_error", "message": "Le service d’itinéraire est indisponible, réessayez dans quelques instants."}}))
    frm = (q['from']['lat'], q['from']['lon'])
    to = (q['to']['lat'], q['to']['lon'])
    opts = q.get('options') or {}
    if q.get('via'):
        v = (q['via'][0]['lat'], q['via'][0]['lon'])
        r = make_route('r0', [frm, v, to], 720, [mk('Partez', 'depart'), mk('Vous avez atteint votre étape', 'waypoint'), mk('Vous êtes arrivé', 'arrive')])
        routes = [r]
    elif state['mode'] == 'faster':
        # Recalcul périodique : un trajet bien plus rapide est apparu (l'actuel est encore proposé, plus lent).
        fast = make_route('r0', [frm, (48.7765, 2.3335), to], 150, [mk('Partez', 'depart'), mk('Tournez à gauche sur Rue des Tournelles', 'turn-left', 'Rue des Tournelles', angle=-90),
                          mk('Vous êtes arrivé', 'arrive')])
        same = make_route('r1', [frm, (48.779, 2.338), to], 480, [mk('Partez', 'depart'), mk('Restez à gauche', 'keep-left'), mk('Vous êtes arrivé', 'arrive')])
        routes = [fast, same]
        state['faster_served'] = True
    elif hav([frm[1], frm[0]], [START[1], START[0]]) > 60:
        # Recalcul depuis une position hors trajet : retour vers le rond-point puis le trajet initial
        routes = [main_route(frm, to)]
        routes[0]['steps'][1] = dict(routes[0]['steps'][1], instruction='Tournez à gauche sur Rue Mounié', maneuver='turn-left', street='Rue Mounié')
    else:
        routes = [main_route(frm, to)] + alt_routes(frm, to)
        if opts.get('avoidTolls'):
            routes = [r for r in routes if not r['hasTolls']]
    route.fulfill(status=200, content_type='application/json', headers=CORS, body=json.dumps(body_for(routes)))


def fake_search(route):
    if route.request.method == 'OPTIONS':
        return route.fulfill(status=204, headers=CORS)
    q = json.loads(route.request.post_data)
    state['search'] = q
    res = [{"label": "Station L'Haÿ-les-Roses", "sublabel": "Avenue Larroumès, 94240 L'Haÿ-les-Roses", "lat": DEST[0], "lon": DEST[1], "kind": "poi"},
           {"label": "L'Haÿ-les-Roses", "sublabel": "94240 Île-de-France", "lat": 48.7797, "lon": 2.3378, "kind": "city"},
           {"label": "Rue de L'Haÿ", "sublabel": "94230 Cachan", "lat": 48.7924, "lon": 2.3326, "kind": "street"}]
    route.fulfill(status=200, content_type='application/json', headers=CORS,
                  body=json.dumps({"provider": "photon", "attribution": "© contributeurs OpenStreetMap, Photon (komoot)", "results": res}))


def fake_incidents(route):
    route.fulfill(status=200, content_type='application/json', headers=CORS, body=json.dumps({
        "updatedAt": "2026-11-05T18:40:00Z", "source": "Bison Futé", "feedOk": True,
        "incidents": [{"id": "bf-1", "type": "travaux", "title": "Travaux", "description": "Voie de droite neutralisée.", "lon": 2.3332, "lat": 48.7752,
                       "severity": 2, "source": "bison-fute"}]}))


INIT = """
window.__e2e = { wake: 0, share: [] };
try { Object.defineProperty(navigator, 'wakeLock', { value: { request: async () => { window.__e2e.wake++; return { released: false, release: async () => {} }; } } }); } catch (e) {}
navigator.share = async (d) => { window.__e2e.share.push(d.text); };
"""


def setup(ctx, vehicle):
    ctx.add_init_script(INIT + ("localStorage.setItem('branche.vehicle.v1', %s);" % json.dumps(json.dumps(vehicle)) if vehicle else ''))
    ctx.route('**/tiles.openfreemap.org/**', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps(STUB_STYLE)))
    ctx.route('**/example.invalid/**', lambda r: r.abort())
    ctx.route('**/fonts.gstatic.com/**', lambda r: r.abort())
    ctx.route('**/v1/route', fake_route)
    ctx.route('**/v1/search', fake_search)
    ctx.route('**/v1/incidents**', fake_incidents)


def voice(page):
    return page.evaluate('window.__brancheVoice || []')


def goto(ctx, page, lat, lon, wait=600):
    ctx.set_geolocation({'latitude': lat, 'longitude': lon, 'accuracy': 8})
    page.wait_for_timeout(wait)


def drive(ctx, page, geo, start_i, end_i, every=1, wait=350):
    for i in range(start_i, end_i, every):
        goto(ctx, page, geo[i][1], geo[i][0], wait)


def shot(page, name):
    page.screenshot(path=f'{OUT}/{name}.png')


def search_and_preview(page):
    page.goto(f'{BASE}/app/', wait_until='load')
    page.wait_for_selector('text=Bornes les plus proches', timeout=20000)
    page.wait_for_timeout(1200)
    box = page.get_by_label('Rechercher une adresse ou un lieu')
    box.click()
    box.fill('hay les roses')
    page.wait_for_selector("text=Station L'Haÿ-les-Roses", timeout=8000)
    return box


with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--use-fake-ui-for-media-stream'])

    # ================================================================== Parcours principal
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, locale='fr-FR', timezone_id='Europe/Paris',
                        geolocation={'latitude': START[0], 'longitude': START[1], 'accuracy': 8}, permissions=['geolocation'])
    setup(ctx, VEHICLE)
    page = ctx.new_page()
    page.on('pageerror', lambda e: log.append(f'ERREUR page : {e}'))
    page.clock.install()

    # ---------------------------------------------------------------- Carte : commandes, point bleu, marqueurs
    page.goto(f'{BASE}/app/', wait_until='load')
    page.wait_for_selector('text=Bornes les plus proches', timeout=20000)
    page.wait_for_timeout(2500)
    mapf = page.frames[1]
    z0 = mapf.evaluate('window.__map.getZoom()')
    page.get_by_role('button', name='Zoomer', exact=True).click()
    page.wait_for_timeout(700)
    z1 = mapf.evaluate('window.__map.getZoom()')
    assert z1 > z0 + 0.9, (z0, z1)
    page.get_by_role('button', name='Dézoomer').click()
    page.wait_for_timeout(700)
    mapf.evaluate('window.__map.setBearing(40)')
    page.wait_for_timeout(300)
    page.get_by_role('button', name='Remettre le nord en haut').click()
    page.wait_for_timeout(800)
    assert abs(mapf.evaluate('window.__map.getBearing()')) < 1
    me = mapf.evaluate("window.__map.getSource('me').serialize().data")
    assert me['features'] and abs(me['features'][0]['geometry']['coordinates'][1] - START[0]) < 1e-4, me
    page.get_by_role('button', name='Ma position').click()
    page.wait_for_timeout(900)
    expect(page.get_by_test_id('locate')).to_have_attribute('aria-label', re.compile('suivi activé'))
    page.get_by_test_id('locate').click()
    page.wait_for_timeout(600)
    expect(page.get_by_test_id('locate')).to_have_attribute('aria-label', re.compile('orientée selon votre direction'))
    page.get_by_test_id('locate').click()
    page.wait_for_timeout(600)
    mapf.evaluate('window.__map.setZoom(15)')
    page.wait_for_timeout(1200)
    shot(page, 'n0-carte-commandes-point-bleu')
    wheel_ok = mapf.evaluate('window.__map.scrollZoom.isEnabled() && window.__map.doubleClickZoom.isEnabled() && window.__map.touchZoomRotate.isEnabled()')
    assert wheel_ok
    log.append(f'carte : zoom +/− ({z0:.1f} → {z1:.1f}), boussole remet le nord, point bleu à la position, « Ma position » suivi puis cap, molette/double-tap/pinch actifs : OK')

    box = page.get_by_label('Rechercher une adresse ou un lieu')
    box.click()
    box.fill('hay les roses')
    page.wait_for_selector("text=Station L'Haÿ-les-Roses", timeout=8000)
    assert 'q' in state['search'] and state['search']['q'] == 'hay les roses'
    shot(page, 'n1-recherche')
    page.get_by_role('button', name="Station L'Haÿ-les-Roses, Avenue Larroumès, 94240 L'Haÿ-les-Roses").click()
    page.wait_for_selector('text=Le plus rapide', timeout=10000)
    page.wait_for_timeout(1500)
    radios = page.get_by_role('radio')
    expect(radios).to_have_count(3)
    expect(page.get_by_text('+6 min')).to_be_visible()
    expect(page.get_by_text('Péage', exact=True)).to_be_visible()
    expect(page.get_by_text(re.compile(r'^Batterie 3\d %$')).first).to_be_visible()
    shot(page, 'n2-apercu-3-trajets')
    log.append('recherche → aperçu 3 trajets (écart +6 min, péage, batterie à l’arrivée) : OK')

    # Choix d'une alternative puis retour au plus rapide
    radios.nth(1).click()
    page.wait_for_timeout(500)
    sel = [radios.nth(i).evaluate("e => e.getAttribute('aria-checked') || e.getAttribute('aria-selected')") for i in range(3)]
    assert sel[1] == 'true' and sel[0] != 'true', sel
    shot(page, 'n3-alternative-choisie')
    radios.nth(0).click()
    page.wait_for_timeout(300)
    # Option éviter les péages → requête avec options, trajet à péage retiré
    page.get_by_role('switch', name='Éviter les péages').click()
    page.wait_for_timeout(1500)
    assert state['calls'][-1]['options'] == {'avoidTolls': True, 'avoidMotorways': False}, state['calls'][-1]
    expect(page.get_by_role('radio')).to_have_count(2)
    log.append('choix d’un trajet + option éviter les péages (options envoyées, 2 trajets) : OK')

    route0 = main_route(START, DEST)
    geo = route0['geometry']
    rb_i = route0['steps'][2]['pointIndex']

    # ---------------------------------------------------------------- Guidage
    page.get_by_role('button', name='Démarrer').click()
    page.wait_for_timeout(1500)
    assert page.evaluate('window.__e2e.wake') >= 1, 'Wake Lock non demandé'
    # Avance rapide jusqu'à ~600 m du rond-point, puis à 54 km/h (15 m/s réels) au-delà de la limite de 50
    drive(ctx, page, geo, 1, rb_i - 24, every=6, wait=250)
    for k in range(rb_i - 22, rb_i - 9):
        geo_k = geo[k]
        f = 0.6  # 15 m par pas (points tous les ~25 m)
        ctx.set_geolocation({'latitude': geo_k[1], 'longitude': geo_k[0], 'accuracy': 5})
        page.wait_for_timeout(1000)
    page.wait_for_timeout(500)
    icon = page.get_by_label('Manœuvre : rond-point, sortie 2')
    expect(icon).to_be_visible()
    expect(page.get_by_test_id('speed-limit')).to_have_text('50')
    spd = page.get_by_test_id('speed').inner_text()
    said = [v['text'] for v in voice(page)]
    assert any('au rond-point, prenez la 2e sortie' in t for t in said), said
    shot(page, 'n4-guidage-rond-point-sortie-2')
    log.append(f'guidage : icône rond-point sortie 2, limitation 50, vitesse affichée {spd.split()[0]} km/h, annonce « {[t for t in said if "rond-point" in t][0]} » : OK')

    # Voix coupée (persistante)
    page.get_by_role('button', name='Couper la voix').click()
    page.wait_for_timeout(300)
    expect(page.get_by_role('button', name='Réactiver la voix')).to_be_visible()
    assert page.evaluate("localStorage.getItem('branche.nav.voice.v1')") == '"off"' or page.evaluate("localStorage.getItem('branche.nav.voice.v1')") == 'off'
    n_before = len(voice(page))
    drive(ctx, page, geo, rb_i - 8, rb_i + 2, every=2, wait=500)
    after = voice(page)[n_before:]
    assert after and all(v['muted'] for v in after), after
    shot(page, 'n5-voix-coupee')
    log.append(f'voix coupée : {len(after)} annonce(s) suivante(s) non dites (journal muted), préférence enregistrée : OK')

    # Partage de l'heure d'arrivée
    page.get_by_role('button', name='Partager mon heure d’arrivée').click()
    page.wait_for_timeout(400)
    shared = page.evaluate('window.__e2e.share')
    assert shared and 'J’arrive à' in shared[0] and 'vers' in shared[0], shared
    log.append(f'partage ETA : « {shared[0]} » : OK')

    # Signalement en un geste pendant le guidage (API réelle)
    page.get_by_role('button', name='Signaler').click()
    page.wait_for_timeout(300)
    shot(page, 'n6-signaler')
    page.get_by_role('button', name='Bouchon').click()
    page.wait_for_selector('text=Bouchon signalé, merci.', timeout=5000)
    log.append('signalement pendant le guidage (POST /v1/reports réel) : OK')

    # ---------------------------------------------------------------- Sortie de trajet → recalcul
    n_calls = len(state['calls'])
    here = geo[rb_i + 2]
    for dlat in (0.0016, 0.0022, 0.0028):  # ~180 à 300 m au nord du tracé
        goto(ctx, page, here[1] + dlat, here[0] - 0.002, 900)
    page.wait_for_selector('text=Nouvel itinéraire calculé', timeout=8000)
    assert len(state['calls']) == n_calls + 1, 'un seul recalcul attendu'
    shot(page, 'n7-recalcul')
    log.append('sortie de trajet → un recalcul, toast « Nouvel itinéraire calculé » : OK')

    # ---------------------------------------------------------------- Trajet plus rapide (vérification toutes les 2 min)
    page.get_by_role('button', name='Réactiver la voix').click()
    state['mode'] = 'faster'
    reroute_geo = main_route((here[1] + 0.0028, here[0] - 0.002), DEST)['geometry']
    goto(ctx, page, reroute_geo[3][1], reroute_geo[3][0], 500)
    page.clock.fast_forward('02:05')
    page.wait_for_timeout(500)
    goto(ctx, page, reroute_geo[4][1], reroute_geo[4][0], 300)
    page.wait_for_selector('text=Trajet plus rapide', timeout=8000)
    said = [v['text'] for v in voice(page)]
    assert any('Trajet plus rapide trouvé' in t for t in said), said
    assert state['faster_served']
    shot(page, 'n8-trajet-plus-rapide')
    log.append(f'bascule vers un trajet plus rapide annoncée : « {[t for t in said if "plus rapide" in t][-1]} » : OK')

    # ---------------------------------------------------------------- Arrivée à la borne → Recharger ici
    state['mode'] = 'normal'
    cur = (reroute_geo[4][1], reroute_geo[4][0])
    fast_geo = make_route('x', [cur, (48.7765, 2.3335), DEST], 150, [mk('', 'depart'), mk('', 'turn-left'), mk('', 'arrive')])['geometry']
    drive(ctx, page, fast_geo, 1, len(fast_geo), every=8, wait=250)
    goto(ctx, page, DEST[0], DEST[1], 1200)
    page.wait_for_selector('text=Vous êtes arrivé', timeout=8000)
    shot(page, 'n9-arrivee-borne')
    page.get_by_role('button', name='Recharger ici').click()
    page.wait_for_timeout(1500)
    assert '/recharger' in page.url or '/payer' in page.url, page.url
    shot(page, 'n10-recharger-ici')
    log.append(f'arrivée à la borne → « Recharger ici » → {page.url.split("/app")[-1]} : OK')
    ctx.close()

    # ================================================================== VE : batterie faible → bornes rapides sur le trajet
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, locale='fr-FR', timezone_id='Europe/Paris',
                        geolocation={'latitude': START[0], 'longitude': START[1], 'accuracy': 8}, permissions=['geolocation'])
    setup(ctx, dict(VEHICLE, socPercent=10))
    page = ctx.new_page()
    page.on('pageerror', lambda e: log.append(f'ERREUR page : {e}'))
    search_and_preview(page)
    page.get_by_role('button', name="L'Haÿ-les-Roses, 94240 Île-de-France").click()
    page.wait_for_selector('text=Batterie estimée à l’arrivée', timeout=10000)
    page.wait_for_timeout(1500)
    shot(page, 'n11-batterie-faible')
    add = page.get_by_role('button', name='Ajouter l’étape')
    if add.count():
        add.first.click()
        page.wait_for_selector('text=Étape recharge', timeout=8000)
        assert state['calls'][-1].get('via'), state['calls'][-1]
        page.wait_for_timeout(800)
        shot(page, 'n12-etape-borne')
        log.append('VE : batterie < 10 % → bornes rapides compatibles proposées → étape ajoutée (via envoyé) : OK')
    else:
        log.append('VE : batterie < 10 % signalée, aucune borne rapide compatible à < 2 km du trajet simulé')
    ctx.close()

    # ================================================================== Robustesse : fournisseur en panne
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, locale='fr-FR',
                        geolocation={'latitude': START[0], 'longitude': START[1], 'accuracy': 8}, permissions=['geolocation'])
    setup(ctx, None)
    state['mode'] = 'down'
    page = ctx.new_page()
    search_and_preview(page)
    page.get_by_role('button', name="L'Haÿ-les-Roses, 94240 Île-de-France").click()
    page.wait_for_selector('text=Le service d’itinéraire est indisponible', timeout=10000)
    expect(page.get_by_role('button', name='Waze').first).to_be_visible()
    expect(page.get_by_role('button', name='Google Maps').first).to_be_visible()
    shot(page, 'n13-fournisseur-en-panne')
    log.append('fournisseur en panne → message + Waze / Google Maps : OK')
    ctx.close()
    state['mode'] = 'normal'

    # ================================================================== Robustesse : pas de GPS
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, locale='fr-FR')
    setup(ctx, None)
    page = ctx.new_page()
    page.goto(f'{BASE}/app/', wait_until='load')
    page.wait_for_timeout(2500)
    box = page.get_by_label('Rechercher une adresse ou un lieu')
    box.click()
    box.fill('hay les roses')
    page.wait_for_selector("text=Station L'Haÿ-les-Roses", timeout=8000)
    page.get_by_role('button', name="L'Haÿ-les-Roses, 94240 Île-de-France").click()
    page.wait_for_selector('text=Position inconnue', timeout=8000)
    shot(page, 'n14-sans-gps')
    page.get_by_role('button', name='Fermer l’itinéraire').click()
    page.wait_for_timeout(400)
    page.get_by_role('button', name='Ma position').click()
    page.wait_for_selector('text=Localisation refusée', timeout=5000)
    shot(page, 'n15-localisation-refusee')
    log.append('pas de GPS → « Position inconnue : activez la localisation… » + liens Waze / Google : OK')
    ctx.close()
    b.close()

print('\n'.join(log))

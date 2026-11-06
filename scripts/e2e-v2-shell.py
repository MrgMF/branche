"""E2E V2 « coquille d'app » : menu principal depuis la carte → chaque écran (titre, état vide, retour bouton / Échap /
navigateur), réglages (langue en/de persistée, unités, péages par défaut, réinitialisation confirmée dans l'app,
présentation revue), locale navigateur en-US → app en anglais ; captures 320×640, 390×844, 1280×800, débordements
et cibles tactiles.

Prérequis : site servi sous /branche (scripts/serve-site.py 8080) avec une app exportée (DATA_URL=…:8080/branche/data).
Usage : python3 scripts/e2e-v2-shell.py http://127.0.0.1:8080/branche <dossier_captures>
"""
import json
import os
import sys

from playwright.sync_api import sync_playwright, expect

BASE = sys.argv[1].rstrip('/')
OUT = sys.argv[2]
os.makedirs(OUT, exist_ok=True)
ANTONY = {'latitude': 48.7536, 'longitude': 2.2975, 'accuracy': 10}
STUB_STYLE = {"version": 8, "glyphs": "https://example.invalid/{fontstack}/{range}.pbf", "sources": {},
              "layers": [{"id": "bg", "type": "background", "paint": {"background-color": "#E6ECEA"}}]}
log = []


def ok(msg):
    log.append(f'OK  {msg}')
    print(f'OK  {msg}', flush=True)


def ctx_for(b, locale, w=390, h=844):
    ctx = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2, geolocation=ANTONY, permissions=['geolocation'],
                        locale=locale, timezone_id='Europe/Paris')
    ctx.route('**/tiles.openfreemap.org/**', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps(STUB_STYLE)))
    ctx.route('**/example.invalid/**', lambda r: r.abort())
    ctx.route('**/fonts.gstatic.com/**', lambda r: r.abort())
    return ctx


def shot(page, name):
    page.wait_for_timeout(350)
    page.screenshot(path=f'{OUT}/{name}.png')


def no_overflow(page, label):
    w = page.evaluate('() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)')
    vw = page.viewport_size['width']
    assert w <= vw + 1, f'{label} : débordement horizontal ({w}px > {vw}px)'


SMALL_TARGETS = """() => [...document.querySelectorAll('[role=button],[role=link],[role=switch],[role=radio],[role=checkbox],a,button,input')]
  .filter((e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && r.bottom > 0 && r.top < innerHeight && !e.closest('[aria-hidden=true]') && e.tagName !== 'IFRAME'; })
  .filter((e) => { const r = e.getBoundingClientRect(); return r.height < 43.5 || r.width < 43.5; })
  .map((e) => (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 40))"""


def targets_ok(page, label):
    small = page.evaluate(SMALL_TARGETS)
    assert not small, f'{label} : cibles < 44 px : {small}'


def heading(page, name):
    page.get_by_role('heading', name=name, exact=True).first.wait_for(timeout=15000)


def open_menu(page):
    page.get_by_test_id('menu').click()
    page.get_by_test_id('app-menu').wait_for()


with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    dialogs = []

    # ---------- A. Français : menu → chaque écran, retours ----------
    ctx = ctx_for(b, 'fr-FR')
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('dialog', lambda d: (dialogs.append(d.message), d.dismiss()))
    page.goto(f'{BASE}/app/', wait_until='load')
    page.get_by_text('Bornes les plus proches').wait_for(timeout=20000)
    assert page.evaluate('document.documentElement.lang') == 'fr-FR'
    shot(page, 'a1-carte-fr')
    no_overflow(page, 'carte')
    open_menu(page)
    for label in ['Carte', 'Ma recharge', 'Historique et dépenses', 'Mon véhicule', 'Mes comptes et badges', 'Réglages', 'À propos et mentions']:
        page.get_by_test_id('app-menu').get_by_text(label, exact=True).wait_for()
    targets_ok(page, 'menu')
    shot(page, 'a2-menu-fr')
    page.keyboard.press('Escape')
    expect(page.get_by_test_id('app-menu')).to_have_count(0)
    ok('menu ouvert depuis la carte : 7 entrées, cibles ≥ 44 px, Échap ferme')

    screens = [
        ('charge', 'Ma recharge', 'Aucune recharge en cours', 'button'),
        ('history', 'Historique et dépenses', 'Aucune recharge pour l’instant', 'escape'),
        ('vehicle', 'Mon véhicule', 'Choisissez un modèle', 'history'),
        ('accounts', 'Mes comptes et badges', 'Comptes opérateurs', 'button'),
        ('settings', 'Réglages', 'Langue', 'escape'),
        ('about', 'À propos et mentions', 'la version française fait foi', 'button'),
    ]
    for key, title, marker, how in screens:
        open_menu(page)
        page.get_by_test_id(f'menu-{key}').click()
        heading(page, title)
        page.get_by_text(marker, exact=False).first.wait_for()
        no_overflow(page, title)
        shot(page, f'a3-{key}-fr')
        if how == 'button':
            page.get_by_test_id('back').last.click()
        elif how == 'escape':
            page.keyboard.press('Escape')
        else:
            page.go_back()
        page.get_by_text('Bornes les plus proches').wait_for(timeout=10000)
        ok(f'menu → « {title} » (titre, contenu ou état vide) → retour par {"bouton" if how == "button" else "Échap" if how == "escape" else "le navigateur"}')

    # ---------- B. Réglages : langue, unités, péages, réinitialisation, présentation ----------
    page.goto(f'{BASE}/app/reglages', wait_until='load')
    heading(page, 'Réglages')
    targets_ok(page, 'réglages')
    page.get_by_test_id('pos-granted').wait_for()
    page.get_by_text('Autorisée', exact=True).wait_for()
    ok('réglages : section « Position » (autorisée)')
    page.get_by_test_id('lang-en').click()
    heading(page, 'Settings')
    page.get_by_text('Distance units').wait_for()
    shot(page, 'b1-reglages-en')
    page.get_by_test_id('units-mi').click()
    page.get_by_test_id('set-tolls').click()
    page.get_by_test_id('back').last.click()
    page.get_by_text('Nearest chargers').wait_for(timeout=10000)
    page.get_by_text(' mi', exact=False).first.wait_for()
    assert page.evaluate('document.documentElement.lang').startswith('en')
    shot(page, 'b2-carte-en-miles')
    open_menu(page)
    page.get_by_test_id('app-menu').get_by_text('History and spending', exact=True).wait_for()
    shot(page, 'b3-menu-en')
    page.keyboard.press('Escape')
    ok('langue → English : écran, menu et carte traduits immédiatement ; unités en miles')

    page.reload(wait_until='load')
    page.get_by_text('Nearest chargers').wait_for(timeout=20000)
    stored = json.loads(page.evaluate("localStorage.getItem('branche.settings.v1')"))
    assert stored == {'lang': 'en', 'units': 'mi', 'avoidTolls': True, 'avoidMotorways': False}, stored
    ok(f'réglages persistés après rechargement : {stored}')

    page.goto(f'{BASE}/app/reglages', wait_until='load')
    page.get_by_test_id('lang-de').click()
    heading(page, 'Einstellungen')
    page.get_by_test_id('units-km').click()
    page.get_by_text('Sprachführung').wait_for()
    shot(page, 'b4-reglages-de')
    page.goto(f'{BASE}/app/historique', wait_until='load')
    heading(page, 'Verlauf und Ausgaben')
    page.get_by_text('Noch keine Ladevorgänge').wait_for()
    shot(page, 'b5-historique-de')
    page.goto(f'{BASE}/app/ma-recharge', wait_until='load')
    heading(page, 'Mein Ladevorgang')
    page.get_by_text('Kein laufender Ladevorgang').first.wait_for()
    shot(page, 'b6-ma-recharge-de')
    ok('langue → Deutsch : réglages, historique (état vide) et « Ma recharge » en allemand')

    # Réinitialisation : confirmation dans l'app, jamais une alerte du navigateur
    page.evaluate("""localStorage.setItem('branche.history.v1', JSON.stringify([{id:'x1',startedAt:Date.now()-3600e3,endedAt:Date.now()-1800e3,
      stationId:'s',stationName:'Test',operatorName:'Op',method:'reader',kWh:10,kWhEstimated:true,pricePaid:5,estimatedCost:5,ok:true}]));
      localStorage.setItem('branche.vehicle.v1', JSON.stringify({id:'dacia-spring',name:'Dacia Spring',batteryKWh:26.8,consumptionKWhPer100:14,maxDcKW:30,maxAcKW:7,plugs:['ccs','t2'],socPercent:40,socUpdatedAt:0}));""")
    page.goto(f'{BASE}/app/reglages', wait_until='load')
    page.get_by_test_id('reset').click()
    page.get_by_text('Alles von diesem Telefon löschen?', exact=False).wait_for()
    shot(page, 'b7-reset-confirm-de')
    page.get_by_role('button', name='Alles löschen').click()
    page.get_by_text('Lokale Daten gelöscht.').wait_for()
    left = page.evaluate("[localStorage.getItem('branche.history.v1'), localStorage.getItem('branche.vehicle.v1')]")
    assert left[1] is None and (left[0] in (None, '[]')), left
    assert not dialogs, dialogs
    ok('réinitialisation : confirmation dans l’app (aucune alerte navigateur), historique et véhicule effacés')

    page.get_by_role('button', name='Einführung erneut ansehen').click()
    page.get_by_text('Alle Ladesäulen, eine App').wait_for()
    shot(page, 'b8-presentation-de')
    page.get_by_role('button', name='Überspringen').click()
    heading(page, 'Einstellungen')
    ok('« Revoir la présentation » : présentation par-dessus l’app, puis retour aux réglages')

    page.get_by_test_id('lang-auto').click()
    page.get_by_text('Automatique (Français)').wait_for()
    ok('langue « Automatique » : suit la langue du navigateur (fr-FR)')
    assert not errors, errors
    ctx.close()

    # ---------- C. Navigateur en anglais (en-US) : app en anglais d'office ----------
    for (w, h) in [(320, 640), (390, 844), (1280, 800)]:
        ctx = ctx_for(b, 'en-US', w, h)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(f'{BASE}/app/', wait_until='load')
        page.get_by_text('Nearest chargers').wait_for(timeout=20000)
        page.get_by_placeholder('Where to? Address, place…').wait_for()
        no_overflow(page, f'carte en {w}')
        shot(page, f'c1-carte-en-{w}')
        open_menu(page)
        no_overflow(page, f'menu en {w}')
        targets_ok(page, f'menu en {w}')
        shot(page, f'c2-menu-en-{w}')
        page.get_by_test_id('menu-settings').click()
        heading(page, 'Settings')
        page.get_by_text('Automatic (English)').wait_for()
        no_overflow(page, f'réglages en {w}')
        targets_ok(page, f'réglages en {w}')
        shot(page, f'c3-reglages-en-{w}')
        for path, title in [('historique', 'History and spending'), ('comptes', 'My accounts and cards'), ('about', 'About and legal'), ('vehicule', 'My vehicle'), ('ma-recharge', 'My charge'), ('payer', 'Pay the charger')]:
            page.goto(f'{BASE}/app/{path}', wait_until='load')
            heading(page, title)
            no_overflow(page, f'{path} en {w}')
            if w != 390:
                continue
            shot(page, f'c4-{path}-en-{w}')
        assert not errors, errors
        ctx.close()
    ok('locale navigateur en-US → app en anglais (carte, recherche, menu, réglages, 6 écrans) ; aucun débordement en 320×640, 390×844, 1280×800')
    b.close()

print('\n'.join(log))

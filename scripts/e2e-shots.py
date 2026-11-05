"""Parcours E2E du site assemblé (Playwright + Chrome) avec captures 390x844.

Usage : python3 scripts/e2e-shots.py <base_url> <dossier_captures>
Le fond de carte OpenFreeMap est remplacé par un style vide si le réseau le bloque (bac à sable).
"""
import json
import sys

from playwright.sync_api import sync_playwright

BASE = sys.argv[1].rstrip('/')
OUT = sys.argv[2]
POS = {'latitude': 48.7536, 'longitude': 2.2975}  # Antony
STUB_STYLE = {"version": 8, "glyphs": "https://example.invalid/{fontstack}/{range}.pbf",
              "sources": {}, "layers": [{"id": "bg", "type": "background", "paint": {"background-color": "#E6ECEA"}}]}

errors = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2,
                        geolocation=POS, permissions=['geolocation'], locale='fr-FR')
    ctx.route('**/tiles.openfreemap.org/**', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps(STUB_STYLE)))
    ctx.route('**/fonts.gstatic.com/**', lambda r: r.abort())
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
    page.on('console', lambda m: m.type == 'error' and errors.append(f'console: {m.text}'))

    page.goto(f'{BASE}/app/', wait_until='networkidle')
    page.wait_for_selector('text=Bornes les plus proches', timeout=20000)
    page.wait_for_timeout(2500)
    page.screenshot(path=f'{OUT}/1-carte.png')
    items = page.locator('[role=button][aria-label*=" km"], [role=button][aria-label*=" m,"]')
    print('bornes listées :', items.count())

    items.first.click()
    page.wait_for_selector('text=Prix opérateur', timeout=10000)
    page.wait_for_timeout(1200)
    page.screenshot(path=f'{OUT}/2-fiche.png')
    page.screenshot(path=f'{OUT}/2-fiche-full.png', full_page=True)

    charge = page.get_by_role('button', name='Charger ici avec Branché')
    if charge.count():
        charge.click()
        page.wait_for_selector('text=Autoriser', timeout=15000)
        page.screenshot(path=f'{OUT}/3-paiement.png')
        page.get_by_role('button', name='Autoriser').first.click()
        page.wait_for_selector('text=En charge', timeout=20000)
        page.wait_for_timeout(6000)
        page.screenshot(path=f'{OUT}/4-session.png')
        page.get_by_role('button', name='Arrêter la charge').click()
        page.wait_for_selector('text=Reçu', timeout=15000)
        page.screenshot(path=f'{OUT}/5-recu.png', full_page=True)
        print('parcours paiement : OK')
    else:
        print('paiement in-app indisponible (API absente)')

    page.goto(f'{BASE}/app/about', wait_until='networkidle')
    page.wait_for_timeout(1000)
    page.screenshot(path=f'{OUT}/6-apropos.png')
    b.close()

print('\n'.join(errors) if errors else 'aucune erreur JS')

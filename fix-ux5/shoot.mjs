import pkg from '/home/claude/.npm-global/lib/node_modules/playwright/index.js';
const { chromium } = pkg;

const OUT = '/home/claude/branche/fix-ux5';
const widths = [320, 390, 1280];
const routes = [
  ['vehicule', '/vehicule'],
  ['comptes', '/comptes'],
];

const browser = await chromium.launch();
for (const [name, path] of routes) {
  for (const w of widths) {
    const page = await browser.newPage({ viewport: { width: w, height: 760 }, deviceScaleFactor: 1 });
    await page.goto('http://localhost:8383' + path, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/${name}-${w}.png` });
    console.log('shot', name, w);
    await page.close();
  }
}
await browser.close();

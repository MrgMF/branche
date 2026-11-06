import pkg from '/home/claude/.npm-global/lib/node_modules/playwright/index.js';
const { chromium } = pkg;
const OUT = '/home/claude/branche/fix-ux5';
const browser = await chromium.launch();
// Pick a model so the SOC block + Save(enabled) show, then scroll to bottom of the scroll view.
for (const w of [320, 390]) {
  const page = await browser.newPage({ viewport: { width: w, height: 760 } });
  await page.goto('http://localhost:8383/vehicule', { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1200);
  // tap first model
  await page.locator('text=Renault').first().click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(400);
  // scroll the inner scrollview fully down
  await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('div'));
    for (const el of els) { if (el.scrollHeight > el.clientHeight + 40) el.scrollTop = el.scrollHeight; }
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/vehicule-soc-${w}.png` });
  console.log('soc', w);
  await page.close();
}
await browser.close();

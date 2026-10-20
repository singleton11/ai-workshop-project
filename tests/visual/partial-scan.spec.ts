/// <reference lib="dom" />
// PR #7: a scan that stops partway keeps the skills it already read.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { argosScreenshot } from '@argos-ci/playwright';
import { expect, test, type Page } from '@playwright/test';

const DIR = import.meta.dirname;
const DROP = `${DIR}/results/drop-after`;
const URL = 'https://github.com/anthropics/skills';

/** From the next repository scan on, the connection drops after `n` files; no `n`, no drop. */
function drop(n?: number) {
  mkdirSync(`${DIR}/results`, { recursive: true });
  if (n === undefined) rmSync(DROP, { force: true });
  else writeFileSync(DROP, String(n));
}

/** The caption bar the demo shows; part of every screenshot. */
async function caption(page: Page, text: string) {
  await page.evaluate((text) => {
    let bar = document.getElementById('demo-caption');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'demo-caption';
      Object.assign(bar.style, {
        position: 'fixed', left: '50%', bottom: '28px', transform: 'translateX(-50%)', zIndex: '99999',
        background: 'rgba(17,24,39,.92)', color: '#fff', font: '600 20px/1.35 "DejaVu Sans", sans-serif',
        padding: '12px 22px', borderRadius: '12px', maxWidth: '1100px', textAlign: 'center', pointerEvents: 'none',
      });
      document.body.append(bar);
    }
    bar.textContent = text;
  }, text);
}

async function scan(page: Page) {
  await page.locator('#scan-url').fill(URL);
  await page.locator('#scan-button').click();
  await expect(page.locator('.spinner')).toHaveCount(0, { timeout: 30_000 });
}

/** A key moment: the screenshot Argos compares with the baseline. */
const shot = (page: Page, name: string) => argosScreenshot(page, name, { root: `${DIR}/screenshots` });

test.use({ bypassCSP: true }); // the page's CSP forbids the caption's inline styles
test.afterEach(() => drop());

test('a scan that stops partway keeps what it read', async ({ page }) => {
  await page.goto('/');
  await caption(page, 'Skill Atlas: a scan that stops partway keeps the skills it already read');
  await shot(page, 'partial-scan-1-start');

  drop(6);
  await caption(page, 'Simulated flaky network: the connection drops after 6 SKILL.md files');
  await scan(page);
  await expect(page.locator('#repositories .alert-error')).toBeVisible();
  await caption(page, 'The 6 skills read before the drop stay in the catalog, with the error next to them');
  await shot(page, 'partial-scan-2-dropped');

  drop();
  await scan(page);
  await expect(page.locator('#repositories .alert-error')).toHaveCount(0);
  await caption(page, 'Network back: scanned again, all 19 skills; the “Scan incomplete” notice is gone');
  await shot(page, 'partial-scan-3-complete');

  drop(3);
  await scan(page);
  await expect(page.locator('#scan-error')).toBeVisible();
  await caption(page, 'A rescan that drops again leaves the 19 skills already in the catalog as they were');
  await shot(page, 'partial-scan-4-rescan-dropped');
});

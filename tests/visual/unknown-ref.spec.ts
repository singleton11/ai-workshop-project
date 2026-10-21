/// <reference lib="dom" />
// Issue #25: an unknown ref is named for the user, under the input, not with GitHub's API error.
import { argosScreenshot } from '@argos-ci/playwright';
import { expect, test, type Page } from '@playwright/test';

const DIR = import.meta.dirname;
const URL = 'https://github.com/anthropics/skills/tree/no-such-ref';

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

const shot = (page: Page, name: string) => argosScreenshot(page, name, { root: `${DIR}/screenshots`, fullPage: true });

test.use({ bypassCSP: true }); // the page's CSP forbids the caption's inline styles

test('an unknown ref: the message names the ref and the repository, under the input', async ({ page }) => {
  await page.goto('/');
  await page.locator('#scan-url').fill(URL);
  await page.locator('#scan-button').click();
  await expect(page.locator('.spinner')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator('#scan-error')).toBeVisible();
  await expect(page.locator('#scan-error')).toHaveText('Branch, tag or commit not found: no-such-ref in https://github.com/anthropics/skills');
  await expect(page.locator('.card')).toHaveCount(0);
  await caption(page, 'An unknown branch, tag or commit: a message for the user, not GitHub’s API error');
  await shot(page, 'unknown-ref-1-error');
});

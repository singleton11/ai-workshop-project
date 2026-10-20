/// <reference lib="dom" />
// Issue #13: each skill shows the day its SKILL.md last changed, on its card and when it is open.
import { argosScreenshot } from '@argos-ci/playwright';
import { expect, test, type Page } from '@playwright/test';

const DIR = import.meta.dirname;
const URL = 'https://github.com/anthropics/skills';

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

/** A key moment: the screenshot Argos compares with the baseline; `fullPage: false` for a long skill body. */
const shot = (page: Page, name: string, fullPage = true) => argosScreenshot(page, name, { root: `${DIR}/screenshots`, fullPage });

test.use({ bypassCSP: true }); // the page's CSP forbids the caption's inline styles

test('each skill shows when it was last updated', async ({ page }) => {
  await page.goto('/');
  await page.locator('#scan-url').fill(URL);
  await page.locator('#scan-button').click();
  await expect(page.locator('.spinner')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator('.card')).toHaveCount(19);
  await expect(page.locator('.card-date')).toHaveCount(19);
  await expect(page.locator('[data-skill="anthropics/skills:skills/claude-api/SKILL.md"] .card-date')).toHaveText('Updated 2026-10-09');
  await caption(page, 'Each card says when its SKILL.md last changed: the last commit that touched it');
  await shot(page, 'last-updated-1-cards');

  await page.locator('[data-skill="anthropics/skills:skills/pdf/SKILL.md"]').click();
  await expect(page.locator('#skill-view [data-updated]')).toHaveText('2026-02-04');
  await expect(page.locator('#skill-view [data-updated] time')).toHaveAttribute('datetime', '2026-02-04T02:09:36Z');
  await caption(page, 'An open skill shows it next to its commit: Updated 2026-02-04');
  await shot(page, 'last-updated-2-skill', false);
});

/// <reference lib="dom" />
// Issue #16: a nicer skills list; in the web catalog, the cards.
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

test('the catalog cards: name and date on one line, three lines of description, the path in a chip', async ({ page }) => {
  await page.goto('/');
  await page.locator('#scan-url').fill(URL);
  await page.locator('#scan-button').click();
  await expect(page.locator('.spinner')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator('.card')).toHaveCount(19);
  const academy = page.locator('[data-skill="anthropics/skills:skills/academy-guide/SKILL.md"]');
  await expect(academy.locator('.card-head .card-date')).toHaveText('Updated 2026-08-18');
  // The long first sentence is cut to three lines; all of it is on hover.
  await expect(academy.locator('.card-text')).toHaveAttribute('title', /^Stop and check this skill .* learning hub\.$/);
  expect(await academy.locator('.card-text').evaluate((text) => text.scrollHeight > text.clientHeight)).toBe(true);
  await caption(page, 'Cards: the name and its date on one line, the sentence cut to three lines, the path in a chip');
  await shot(page, 'nicer-list-1-cards');

  // A name too long to share its line: the date goes under it. In the dark theme, too.
  await page.locator('#filter').fill('builder');
  await expect(page.locator('.card')).toHaveCount(2);
  await page.emulateMedia({ colorScheme: 'dark' });
  const builder = page.locator('[data-skill="anthropics/skills:skills/web-artifacts-builder/SKILL.md"]');
  await expect(builder.locator('.card-title')).toHaveText('web-artifacts-builder');
  await caption(page, 'A long name keeps its line; its date goes under it. Dark theme as well');
  await shot(page, 'nicer-list-2-long-name-dark');
});

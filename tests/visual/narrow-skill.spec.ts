/// <reference lib="dom" />
// Issue #23: on a phone, a skill whose body has a table or a code block fits the screen; only the
// table or the code block scrolls sideways, not the page.
import { argosScreenshot } from '@argos-ci/playwright';
import { expect, test, type Page } from '@playwright/test';

const DIR = import.meta.dirname;
const URL = 'https://github.com/anthropics/skills';

/** The caption bar the demo shows; part of every screenshot. Narrow: the screen is a phone's. */
async function caption(page: Page, text: string) {
  await page.evaluate((text) => {
    let bar = document.getElementById('demo-caption');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'demo-caption';
      Object.assign(bar.style, {
        position: 'fixed', left: '12px', right: '12px', bottom: '16px', zIndex: '99999',
        background: 'rgba(17,24,39,.92)', color: '#fff', font: '600 15px/1.35 "DejaVu Sans", sans-serif',
        padding: '10px 14px', borderRadius: '10px', textAlign: 'center', pointerEvents: 'none',
      });
      document.body.append(bar);
    }
    bar.textContent = text;
  }, text);
}

/** A key moment: the screenshot Argos compares with the baseline, then held so the video's caption can be read. */
async function shot(page: Page, name: string) {
  await argosScreenshot(page, name, { root: `${DIR}/screenshots`, fullPage: false });
  await page.waitForTimeout(2500);
}

/** How wide the page is, and how wide the screen. */
const widths = (page: Page) =>
  page.evaluate(() => ({ page: document.documentElement.scrollWidth, screen: document.documentElement.clientWidth }));

test.use({
  bypassCSP: true, // the page's CSP forbids the caption's inline styles
  viewport: { width: 375, height: 667 },
  video: { mode: 'on', size: { width: 375, height: 667 } },
});

test('a skill with a table and code blocks fits a phone screen; only they scroll sideways', async ({ page }) => {
  await page.goto('/');
  await page.locator('#scan-url').fill(URL);
  await page.locator('#scan-button').click();
  await expect(page.locator('.spinner')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator('.card')).toHaveCount(19);
  expect(await widths(page)).toEqual({ page: 375, screen: 375 });

  // docx: code blocks wider than the screen.
  await page.locator('[data-skill="anthropics/skills:skills/docx/SKILL.md"]').click();
  await expect(page.locator('.skill-head h1')).toHaveText('docx');
  expect(await widths(page)).toEqual({ page: 375, screen: 375 });
  for (const box of [page.locator('article.panel.prose'), page.locator('aside.panel')]) {
    const { x, width } = (await box.boundingBox())!;
    expect(x + width).toBeLessThanOrEqual(375);
  }
  await caption(page, 'docx on a phone: the page fits the screen');
  await shot(page, 'narrow-skill-1-docx');

  const pre = page.locator('.prose pre').filter({ hasText: 'pdftoppm -jpeg' });
  await pre.scrollIntoViewIfNeeded();
  expect(await pre.evaluate((box) => box.scrollWidth - box.clientWidth)).toBeGreaterThan(100);
  await caption(page, 'A long code block scrolls sideways in its own box');
  await shot(page, 'narrow-skill-2-docx-code');

  // claude-api: the widest body in the repository, and a long description.
  await page.getByRole('button', { name: 'Back to the catalog' }).click();
  await page.locator('[data-skill="anthropics/skills:skills/claude-api/SKILL.md"]').click();
  await expect(page.locator('.skill-head h1')).toHaveText('claude-api');
  expect(await widths(page)).toEqual({ page: 375, screen: 375 });
  await caption(page, 'claude-api: its long description wraps');
  await shot(page, 'narrow-skill-3-claude-api');

  const table = page.locator('.prose table').filter({ hasText: 'Harness & deployment' });
  expect(await table.evaluate((box) => box.scrollWidth - box.clientWidth)).toBeGreaterThan(100);
  await table.evaluate((box) => { box.scrollIntoView({ block: 'start' }); box.scrollLeft = box.scrollWidth; });
  expect(await table.evaluate((box) => box.scrollLeft)).toBeGreaterThan(100);
  expect(await widths(page)).toEqual({ page: 375, screen: 375 });
  await caption(page, 'A wide table scrolls sideways in its own box; the page does not');
  await shot(page, 'narrow-skill-4-claude-api-table');
});

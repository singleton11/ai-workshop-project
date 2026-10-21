/// <reference lib="dom" />
// Issue #17: Group by topic, a small model's topics for the catalog's skills (claude.json, replayed).
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

/** A key moment: the screenshot Argos compares with the baseline, then held so the video's caption can be read. */
async function shot(page: Page, name: string) {
  await argosScreenshot(page, name, { root: `${DIR}/screenshots`, fullPage: false });
  await page.waitForTimeout(2500);
}

test.use({ bypassCSP: true }); // the page's CSP forbids the caption's inline styles

test('the catalog, grouped by topic', async ({ page }) => {
  await page.goto('/');
  await page.locator('#scan-url').fill(URL);
  await page.locator('#scan-button').click();
  await expect(page.locator('.spinner')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator('.card')).toHaveCount(19);
  await expect(page.locator('#group')).toHaveText('Group by topic');
  await caption(page, '19 skills, by repository. Group by topic asks claude -p with a small model (Haiku)');
  await shot(page, 'clustering-1-catalog');

  await page.locator('#group').click();
  await expect(page.locator('#group')).toHaveText('Grouping by topic…');
  await caption(page, 'The server asks the model: every skill’s name, description and body');
  await expect(page.locator('.topic')).toHaveCount(6, { timeout: 30_000 });
  await expect(page.locator('.topic-name')).toHaveText(['File Formats', 'Web Development', 'Branding & Styling', 'Visual Design', 'Writing & Documentation', 'Development Tools']);
  await expect(page.locator('[data-topic="File Formats"] .card-title')).toHaveText(['docx', 'pdf', 'pptx', 'xlsx']);
  await expect(page.locator('.card')).toHaveCount(19);
  await caption(page, '6 topics, the largest first; each card names its repository');
  await shot(page, 'clustering-2-topics');

  await page.locator('#filter').fill('design');
  await expect(page.locator('.card')).toHaveCount(4);
  await caption(page, 'The filter still narrows the cards, in every topic');
  await shot(page, 'clustering-3-filter');

  await page.locator('#filter').fill('');
  await page.locator('#group').click();
  await expect(page.locator('.topic')).toHaveCount(0);
  await expect(page.locator('[data-repository="anthropics/skills"]')).toBeVisible();
  await caption(page, 'Show by repository goes back; the topics are not stored');
  await shot(page, 'clustering-4-back');
});

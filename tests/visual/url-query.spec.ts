/// <reference lib="dom" />
// Issue #36: a repository URL copied from GitHub's address bar, with `?tab=…` or `#…`, is that repository.
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

const shot = (page: Page, name: string) => argosScreenshot(page, name, { root: `${DIR}/screenshots`, fullPage: true });

async function scan(page: Page, url: string) {
  await page.locator('#scan-url').fill(url);
  await page.locator('#scan-button').click();
  await expect(page.locator('.spinner')).toHaveCount(0, { timeout: 30_000 });
}

test.use({ bypassCSP: true }); // the page's CSP forbids the caption's inline styles

test('a URL copied from GitHub, with ?tab=… or #…: the same repository, its skills in the catalog', async ({ page }) => {
  await page.goto('/');
  await scan(page, `${URL}?tab=readme-ov-file`);
  await expect(page.locator('#scan-error')).toBeHidden();
  await expect(page.locator('.repository-name')).toHaveText(['anthropics/skills']);
  await expect(page.locator('.card')).toHaveCount(19);
  await expect(page).toHaveURL(`/?repo=${encodeURIComponent(URL)}`);
  await caption(page, 'Pasted with ?tab=readme-ov-file, as GitHub’s address bar shows it: the repository, 19 skills');
  await shot(page, 'url-query-1-tab');

  await scan(page, `${URL}#readme`);
  await expect(page.locator('#scan-error')).toBeHidden();
  await expect(page.locator('.repository-name')).toHaveText(['anthropics/skills']);
  await expect(page.locator('.card')).toHaveCount(19);
  await caption(page, 'With #readme: the same repository again, so it replaces the entry instead of adding one');
  await shot(page, 'url-query-2-fragment');
});

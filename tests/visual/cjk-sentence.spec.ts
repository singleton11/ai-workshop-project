/// <reference lib="dom" />
// Issue #27: the first sentence of a Japanese description ends at 。, with no space after it.
import { argosScreenshot } from '@argos-ci/playwright';
import { expect, test, type Page } from '@playwright/test';

const DIR = import.meta.dirname;
const URL = 'https://github.com/Keiji-Miyake/kanon-ag/tree/bb73035a46ca92da3b81b9bcadff5e7722fec1f0';

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

test('a card shows the first sentence of a Japanese description: up to 。, the rest left out', async ({ page }) => {
  await page.goto('/');
  await page.locator('#scan-url').fill(URL);
  await page.locator('#scan-button').click();
  await expect(page.locator('.spinner')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator('.card')).toHaveCount(17);
  const architect = page.locator('[data-skill="Keiji-Miyake/kanon-ag:skills/architect/SKILL.md"]');
  await expect(architect.locator('.card-text')).toHaveText('要件定義とシステム設計の専門家。');
  await expect(architect.locator('.card-text')).toHaveAttribute('title', '要件定義とシステム設計の専門家。');
  await caption(page, 'Japanese descriptions: each card shows the first sentence, up to 。');
  await shot(page, 'cjk-sentence-1-cards');

  // Mermaid is only in architect's second sentence: the filter still reads the whole description.
  await page.locator('#filter').fill('Mermaid');
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(architect.locator('.card-text')).toHaveText('要件定義とシステム設計の専門家。');
  await caption(page, 'Filter "Mermaid", a word of its second sentence: the card still shows only the first');
  await shot(page, 'cjk-sentence-2-filter');
});

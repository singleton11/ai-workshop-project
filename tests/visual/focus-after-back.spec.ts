/// <reference lib="dom" />
// Issue #24: with the keyboard only, Back to the catalog puts the focus on the card that was opened.
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

test('with the keyboard: opening a card focuses the skill, Back focuses the card again', async ({ page }) => {
  await page.goto('/');
  await page.locator('#scan-url').fill(URL);
  await page.locator('#scan-button').click();
  await expect(page.locator('.spinner')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator('.card')).toHaveCount(19);

  // From the top of the page, Tab to the first card.
  await page.locator('[data-home]').focus();
  const academy = page.locator('[data-skill="anthropics/skills:skills/academy-guide/SKILL.md"]');
  for (let i = 0; i < 20 && !(await academy.evaluate((card) => card === document.activeElement)); i++) await page.keyboard.press('Tab');
  await expect(academy).toBeFocused();
  await caption(page, 'Keyboard only: Tab to the first card, academy-guide');
  await shot(page, 'focus-after-back-1-card');

  await page.keyboard.press('Enter');
  await expect(page.locator('#skill-view .skill-head h1')).toHaveText('academy-guide');
  await expect(page.locator('#skill-view .skill-head h1')).toBeFocused();
  await caption(page, 'Enter opens it: the focus is on the skill\'s name, so a screen reader reads it');
  await shot(page, 'focus-after-back-2-skill', false);

  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#skill-view .back')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#catalog-view')).toBeVisible();
  await expect(academy).toBeFocused();
  await caption(page, '← Back to the catalog: the card that was opened has the focus again');
  await shot(page, 'focus-after-back-3-back');

  await page.keyboard.press('Tab');
  await expect(page.locator('.card').nth(1)).toBeFocused();
  await caption(page, 'The next Tab goes on to the next card, not to the top of the page');
  await shot(page, 'focus-after-back-4-next-tab');
});

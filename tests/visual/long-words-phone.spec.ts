// Issue #37 on a phone: a long URL in a description, or a long name, wraps in the skill's header
// instead of making the page wider than the screen.
import { expect, test } from '@playwright/test';
import { caption, DOCS_FETCH, expectNoSidewaysScroll, LONG_NAME, open, scan, shot } from './long-words.ts';

const PHONE = { width: 375, height: 667 };

test.use({ bypassCSP: true, viewport: PHONE, video: { mode: 'on', size: PHONE } }); // bypassCSP: the caption's inline styles

test('a long URL or name wraps instead of widening the page', async ({ page }) => {
  await scan(page);
  await expectNoSidewaysScroll(page);

  await open(page, DOCS_FETCH);
  await expect(page.locator('.skill-head .lead')).toContainText('https://docs.example.com/reference/v2/');
  await caption(page, 'The docs URL wraps: the page stays 375 px wide');
  await shot(page, 'long-words-3-url-phone', false);

  await page.locator('button.back').click();
  await open(page, LONG_NAME);
  await caption(page, 'So does a 160-character name');
  await shot(page, 'long-words-4-long-name-phone', false);
});

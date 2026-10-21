// Issue #37: a word too long for the screen (a name with no space, a docs URL in a description)
// wraps on its card and in the skill's header; the page never scrolls sideways. On a desktop.
import { test } from '@playwright/test';
import { caption, expectFits, expectLines, expectNoSidewaysScroll, LONG_NAME, open, scan, shot } from './long-words.ts';

test.use({ bypassCSP: true }); // the page's CSP forbids the caption's inline styles

test('a long word wraps on the cards and in the header', async ({ page }) => {
  await scan(page);
  await expectNoSidewaysScroll(page);
  // Cut to three lines, but the word wraps at the card's edge instead of being clipped mid-letter.
  await expectFits(page, '.card-text');
  await expectLines(page, '.card-text', 3);
  await caption(page, 'A word with no space wraps at the card’s edge, cut to three lines, not clipped mid-letter');
  await shot(page, 'long-words-1-cards');

  await open(page, LONG_NAME);
  await caption(page, 'A 160-character name and description wrap in the header: the page stays 1280 px wide');
  await shot(page, 'long-words-2-long-name');
});

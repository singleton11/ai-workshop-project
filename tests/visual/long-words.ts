/// <reference lib="dom" />
// The steps of the issue #37 demo, shared by long-words.spec.ts (desktop) and long-words-phone.spec.ts.
import { argosScreenshot } from '@argos-ci/playwright';
import { expect, type Page } from '@playwright/test';

const DIR = import.meta.dirname;
const URL = 'https://github.com/example/long-words'; // made up: tests/visual/long-words.mjs
export const DOCS_FETCH = '[data-skill="example/long-words:skills/docs-fetch/SKILL.md"]';
export const LONG_NAME = '[data-skill="example/long-words:skills/long-name/SKILL.md"]';

/** The caption bar the demo shows; part of every screenshot. Narrower on a phone. */
export async function caption(page: Page, text: string) {
  await page.evaluate((text) => {
    let bar = document.getElementById('demo-caption');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'demo-caption';
      const phone = window.innerWidth < 600;
      Object.assign(bar.style, {
        position: 'fixed', left: '50%', bottom: phone ? '16px' : '28px', transform: 'translateX(-50%)', zIndex: '99999',
        background: 'rgba(17,24,39,.92)', color: '#fff', font: `600 ${phone ? 15 : 20}px/1.35 "DejaVu Sans", sans-serif`,
        padding: phone ? '8px 12px' : '12px 22px', borderRadius: '12px', width: 'max-content',
        maxWidth: 'min(1100px, calc(100vw - 32px))', textAlign: 'center', pointerEvents: 'none',
      });
      document.body.append(bar);
    }
    bar.textContent = text;
  }, text);
}

/** A key moment: the screenshot Argos compares with the baseline. */
export const shot = (page: Page, name: string, fullPage = true) => argosScreenshot(page, name, { root: `${DIR}/screenshots`, fullPage });

/** The page is as wide as the window: nothing runs off the right edge. */
export async function expectNoSidewaysScroll(page: Page) {
  const width = await page.evaluate(() => window.innerWidth);
  expect(await page.evaluate(() => document.documentElement.scrollWidth), 'the page is wider than the window').toBe(width);
}

/** The element's text fits its box: nothing clipped or running out sideways. */
export async function expectFits(page: Page, selector: string) {
  for (const element of await page.locator(selector).all()) {
    const { scrollWidth, clientWidth } = await element.evaluate((e) => ({ scrollWidth: e.scrollWidth, clientWidth: e.clientWidth }));
    expect(scrollWidth, `${selector} wider than its box`).toBeLessThanOrEqual(clientWidth);
  }
}

/** Each element shows at most `lines` lines of its text: those after the cut are hidden too. */
export async function expectLines(page: Page, selector: string, lines: number) {
  for (const element of await page.locator(selector).all()) {
    const shown = await element.evaluate((e) => {
      const box = e.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(e);
      return new Set([...range.getClientRects()].filter((line) => line.top < box.bottom - 1).map((line) => Math.round(line.top))).size;
    });
    expect(shown, `${selector} shows more than ${lines} lines`).toBeLessThanOrEqual(lines);
  }
}

export async function scan(page: Page) {
  await page.goto('/');
  await page.locator('#scan-url').fill(URL);
  await page.locator('#scan-button').click();
  await expect(page.locator('.spinner')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator('.card')).toHaveCount(3);
}

/** Opens a card: its whole name and description in the header, within the window. */
export async function open(page: Page, card: string) {
  const name = (await page.locator(`${card} .card-title`).textContent()) ?? '';
  await page.locator(card).click();
  await expect(page.locator('.skill-head h1')).toHaveText(name);
  await expectNoSidewaysScroll(page);
  await expectFits(page, '.skill-head h1');
  await expectFits(page, '.skill-head .lead');
}

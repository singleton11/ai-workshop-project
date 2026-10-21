// One adversarial probe of the web catalog, headless: runs a steps file against a page and keeps
// everything a bug report needs. Usage:
//   node probe.mjs <url> <steps.mjs> <out-dir>   (a new, empty directory per attempt)
// steps.mjs: `export default async ({ page, shot, note }) => { … }`
//   shot(name)  → <out-dir>/<name>.png
//   note(text)  → a line in <out-dir>/log.txt (what you did, what you saw)
// Always written, passing or failing: log.txt (with console errors, page errors, failed and 4xx/5xx
// requests), aria.txt (the page's accessibility tree at the end), final.png and video.webm.
import { mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const [url, stepsFile, outArg] = process.argv.slice(2);
if (!url || !stepsFile || !outArg) {
  console.error('usage: node probe.mjs <url> <steps.mjs> <out-dir>');
  process.exit(2);
}
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
if (readdirSync(out).length > 0) {
  // Each attempt keeps its own evidence: never overwrite an earlier run's log, captures or video.
  console.error(`probe.mjs: ${out} is not empty; use a new directory (e.g. attempt-2)`);
  process.exit(2);
}

const log = [];
const note = (text) => { log.push(text); console.log(text); };
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 }, locale: 'en-US', timezoneId: 'UTC',
  recordVideo: { dir: out, size: { width: 1280, height: 800 } },
});
const page = await context.newPage();
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') note(`console.${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => note(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => note(`requestfailed: ${r.method()} ${r.url()} ${r.failure()?.errorText}`));
page.on('response', (r) => { if (r.status() >= 400) note(`http ${r.status()}: ${r.request().method()} ${r.url()}`); });
const shot = (name) => page.screenshot({ path: `${out}/${name}.png`, fullPage: true });

let failed;
try {
  await page.goto(url);
  const { default: steps } = await import(pathToFileURL(resolve(stepsFile)).href);
  await steps({ page, shot, note });
} catch (e) {
  failed = e;
  note(`probe error: ${e.stack ?? e}`);
} finally {
  await shot('final').catch(() => {});
  writeFileSync(`${out}/aria.txt`, await page.locator('body').ariaSnapshot().catch((e) => String(e)));
  const video = page.video();
  await context.close();
  if (video) renameSync(await video.path(), `${out}/video.webm`);
  await browser.close();
  writeFileSync(`${out}/log.txt`, log.join('\n') + '\n');
}
process.exit(failed ? 1 : 0);

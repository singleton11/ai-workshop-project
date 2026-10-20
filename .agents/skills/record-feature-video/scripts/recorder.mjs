// Records the web catalog in headless Chromium: `skill-atlas serve` with flaky.mjs, a page that
// records video, and a caption bar and a cursor drawn into the page (a headless video has no mouse).
// Needs REPO, the skill-atlas checkout; Chromium from `npx playwright-core install chromium`, or
// CHROMIUM_PATH.
import { spawn } from 'node:child_process';
import { readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const DIR = import.meta.dirname;
const REPO = process.env.REPO;
if (!REPO) throw new Error('Set REPO to the skill-atlas checkout to serve');

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** From the next repository scan on, the connection drops after `n` files; no `n`, no drop. */
export function drop(file, n) {
  if (n === undefined) rmSync(file, { force: true });
  else writeFileSync(file, String(n));
}

/** `skill-atlas serve` with flaky.mjs, from `cwd`; `env` is added to this process's (DROP_FILE, LATENCY_MS, REPLAY…). */
export async function startServer({ cwd = REPO, port = Number(process.env.PORT ?? 4188), env = {} } = {}) {
  const server = spawn(process.execPath, ['--import', `${DIR}/flaky.mjs`, 'src/cli.ts', 'serve', '--port', String(port)], {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const stop = () => server.kill();
  // A failed take would otherwise hang on the server it started.
  for (const event of ['uncaughtException', 'unhandledRejection']) {
    process.on(event, (error) => (console.error(error), stop(), process.exit(1)));
  }
  const url = `http://localhost:${port}/`;
  for (let attempt = 0; ; attempt++) {
    try {
      await fetch(url);
      return { url, stop };
    } catch {
      if (attempt === 50) throw new Error(`No server at ${url}`);
      await sleep(200);
    }
  }
}

/** Drawn into every page: the caption bar and the cursor. */
function overlay() {
  const install = () => {
    const caption = document.createElement('div');
    caption.id = 'demo-caption';
    Object.assign(caption.style, {
      position: 'fixed', left: '50%', bottom: '28px', transform: 'translateX(-50%)', zIndex: 99999,
      background: 'rgba(17,24,39,.92)', color: '#fff', font: '600 20px/1.35 system-ui, "DejaVu Sans", sans-serif',
      padding: '12px 22px', borderRadius: '12px', boxShadow: '0 8px 30px rgba(0,0,0,.35)', maxWidth: '1100px',
      textAlign: 'center', transition: 'opacity .3s', opacity: 0, pointerEvents: 'none',
    });
    const cursor = document.createElement('div');
    cursor.id = 'demo-cursor';
    Object.assign(cursor.style, {
      position: 'fixed', left: '50%', top: '50%', width: '22px', height: '22px', zIndex: 100000,
      borderRadius: '50%', background: 'rgba(239,68,68,.35)', border: '2px solid rgba(239,68,68,.95)',
      transform: 'translate(-50%,-50%)', transition: 'left .6s ease, top .6s ease, box-shadow .15s', pointerEvents: 'none',
    });
    document.body.append(caption, cursor);
  };
  if (document.body) install();
  else document.addEventListener('DOMContentLoaded', install);
}

/** A recording browser page and what a take does with it; `close()` saves the video to `out`. */
export async function openRecorder({ width = 1280, height = 800, out = `${DIR}/web.webm` } = {}) {
  const videos = `${DIR}/.videos`;
  rmSync(videos, { recursive: true, force: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    bypassCSP: true, // the page's CSP forbids inline styles; the overlay has them
    recordVideo: { dir: videos, size: { width, height } },
  });
  await context.addInitScript(overlay);
  const page = await context.newPage();

  /** Shows `html` in the caption bar (empty: hides it), then waits `hold` ms. */
  async function caption(html, hold = 0) {
    await page.evaluate((html) => {
      const bar = document.getElementById('demo-caption');
      bar.innerHTML = html;
      bar.style.opacity = html ? 1 : 0;
    }, html);
    await sleep(hold);
  }

  /** Moves the cursor to the element's center, or just left of it, where it covers no text. */
  async function moveTo(locator, { left = false } = {}) {
    const box = await locator.boundingBox();
    if (!box) throw new Error(`Not visible: ${locator}`);
    const x = left ? box.x - 16 : box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.evaluate(([x, y]) => Object.assign(document.getElementById('demo-cursor').style, { left: `${x}px`, top: `${y}px` }), [x, y]);
    await sleep(700);
  }

  async function click(locator) {
    await moveTo(locator);
    const pulse = (shadow) => page.evaluate((shadow) => (document.getElementById('demo-cursor').style.boxShadow = shadow), shadow);
    await pulse('0 0 0 10px rgba(239,68,68,.25)');
    await locator.click();
    await sleep(150);
    await pulse('none');
  }

  async function type(locator, text) {
    await click(locator);
    await locator.fill('');
    await locator.pressSequentially(text, { delay: 35 });
    await sleep(300);
  }

  /** Types a URL into the scan box, presses Scan, and waits until no scan is running. */
  async function scan(url) {
    await type(page.locator('#scan-url'), url);
    await click(page.locator('#scan-button'));
    await page.waitForFunction(() => !document.querySelector('.spinner'), null, { timeout: 120_000 });
  }

  /** A screenshot to check the take with: <DIR>/<name>.png. */
  async function shot(name) {
    await page.screenshot({ path: `${DIR}/${name}.png` });
  }

  async function close() {
    await context.close();
    await browser.close();
    const [file] = readdirSync(videos);
    renameSync(`${videos}/${file}`, out);
    rmSync(videos, { recursive: true, force: true });
    return out;
  }

  return { page, caption, moveTo, click, type, scan, shot, close };
}

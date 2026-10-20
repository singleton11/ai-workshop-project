// Records the Skill Atlas catalog page scanning a large organization (JetBrains) on live GitHub,
// with a token, from one checkout's real server code.
// Usage: node record-ui.mts <checkout> <out-dir> <before|after>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import ffmpeg from 'ffmpeg-static';

const [checkout, out, mode] = process.argv.slice(2);
const { createWebServer, listen } = await import(join(checkout, 'src/web/server.ts'));
const { openGitHub, openGitHubOwner } = await import(join(checkout, 'src/core/github.ts'));
const { DEFAULT_RULES } = await import(join(checkout, 'src/core/rules.ts'));

const token = process.env.GITHUB_TOKEN;
const server = createWebServer({
  open: (url: string, signal: AbortSignal) => openGitHub(url, { fetch, token, signal }),
  // As src/cli.ts does it; main's openGitHubOwner has no third argument and ignores it.
  openOwner: (url: string, signal: AbortSignal, listing?: unknown) => openGitHubOwner(url, { fetch, token, signal }, listing),
  rules: { load: async () => ({ path: '<default rules>', text: DEFAULT_RULES }), peek: async () => ({}) },
  note: () => {},
});
const base = await listen(server, 0);

const browser = await chromium.launch({ executablePath: '/tmp/chrome-headless-shell-linux64/chrome-headless-shell' });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 }, bypassCSP: true });
await page.goto(base);

const frames = join(out, `frames-${mode}`);
mkdirSync(frames, { recursive: true });
const shots: { file: string; at: number }[] = [];
let recording = true;
const t0 = Date.now();
let clock = '';
const loop = (async () => {
  while (recording) {
    const file = join(frames, `${String(shots.length).padStart(5, '0')}.png`);
    await page.screenshot({ path: file });
    shots.push({ file, at: Date.now() });
    await new Promise((r) => setTimeout(r, 100));
  }
})();

async function caption(text: string) {
  clock = text;
  await page.evaluate((text) => {
    let bar = document.getElementById('demo-caption');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'demo-caption';
      Object.assign(bar.style, {
        position: 'fixed', left: '0', right: '0', bottom: '0', zIndex: '9999', padding: '12px 20px',
        background: 'rgba(20,20,30,.88)', color: '#fff', font: '600 16px system-ui, sans-serif', whiteSpace: 'pre',
      });
      document.body.append(bar);
    }
    bar.textContent = text;
  }, text);
}
const label = mode === 'before' ? 'BEFORE (main)' : 'AFTER (this PR)';
// A running clock in the caption, so the wait is visible.
let started = 0;
const ticker = setInterval(() => {
  if (started) caption(`${label}: scanning github.com/JetBrains (GITHUB_TOKEN set)   elapsed: ${((Date.now() - started) / 1000).toFixed(1)} s`);
}, 200);

await caption(`${label}: scanning github.com/JetBrains, a large organization, on live GitHub`);
await page.waitForTimeout(1500);
await page.type('#scan-url', 'https://github.com/JetBrains', { delay: 25 });
await page.click('#scan-button');
started = Date.now();
// Until the first repository with skills is on the page, and a few seconds of the scan after it.
await page.waitForSelector('[data-organization] .repository', { timeout: 120_000 });
const first = ((Date.now() - started) / 1000).toFixed(1);
await page.waitForTimeout(4000);
clearInterval(ticker);
await caption(`${label}: the first repository showed after ${first} s; ${mode === 'before' ? 'until then, only "Scanning…"' : 'until then, how far listing had got, with a bar'}`);
await page.waitForTimeout(3500);
recording = false;
await loop;
await browser.close();
server.close();
console.log(mode, 'first repository after', first, 's;', shots.length, 'frames', ((Date.now() - t0) / 1000).toFixed(0), 's');

const list = shots.map((shot, i) => `file '${shot.file}'\nduration ${(((shots[i + 1]?.at ?? shot.at + 1000) - shot.at) / 1000).toFixed(3)}`).join('\n');
writeFileSync(join(out, `frames-${mode}.txt`), `${list}\nfile '${shots.at(-1)!.file}'\n`);
const concat = ['-f', 'concat', '-safe', '0', '-i', join(out, `frames-${mode}.txt`)];
execFileSync(ffmpeg!, ['-y', '-loglevel', 'error', ...concat, '-vf', 'fps=10,format=yuv420p', '-c:v', 'libx264', '-movflags', '+faststart', join(out, `ui-${mode}.mp4`)]);
execFileSync(ffmpeg!, ['-y', '-loglevel', 'error', ...concat,
  '-vf', 'fps=5,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer', join(out, `ui-${mode}.gif`)]);

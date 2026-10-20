// Records the Skill Atlas catalog page against live GitHub, with one injected fault: every
// `bugfix-workflow/SKILL.md` raw read answers 500 while `fault.on` is true.
// Usage: node demo.ts <checkout> <out-dir> <before|after>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const [checkout, out, mode] = process.argv.slice(2);
const { createWebServer, listen } = await import(join(checkout, 'src/web/server.ts'));
const { openGitHub } = await import(join(checkout, 'src/core/github.ts'));
const { DEFAULT_RULES } = await import(join(checkout, 'src/core/rules.ts'));

const fault = { on: true };
const token = process.env.GITHUB_TOKEN;
const faulty = async (url: string, init?: RequestInit) => {
  if (fault.on && url.startsWith('https://raw.githubusercontent.com/') && url.endsWith('/bugfix-workflow/SKILL.md')) {
    return new Response('injected fault', { status: 500 });
  }
  return fetch(url, init);
};
const server = createWebServer({
  open: (url: string) => openGitHub(url, { fetch: faulty, token }),
  rules: { load: async () => ({ path: '<default rules>', text: DEFAULT_RULES }), peek: async () => ({}) },
  note: () => {},
});
const base = await listen(server, 0);

const browser = await chromium.launch({ executablePath: '/tmp/chrome-headless-shell-linux64/chrome-headless-shell' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, bypassCSP: true });
await page.goto(base);

// Frames: a screenshot every ~120 ms, each shown for as long as it was current.
const frames = join(out, `frames-${mode}`);
mkdirSync(frames, { recursive: true });
const shots: { file: string; at: number }[] = [];
let recording = true;
const loop = (async () => {
  while (recording) {
    const file = join(frames, `${String(shots.length).padStart(5, '0')}.png`);
    await page.screenshot({ path: file });
    shots.push({ file, at: Date.now() });
    await new Promise((r) => setTimeout(r, 120));
  }
})();

async function caption(text: string) {
  await page.evaluate((text) => {
    let bar = document.getElementById('demo-caption');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'demo-caption';
      Object.assign(bar.style, {
        position: 'fixed', left: '0', right: '0', bottom: '0', zIndex: '9999', padding: '12px 20px',
        background: 'rgba(20,20,30,.88)', color: '#fff', font: '600 16px system-ui, sans-serif',
      });
      document.body.append(bar);
    }
    bar.textContent = text;
  }, text);
}
const wait = (ms: number) => page.waitForTimeout(ms);
async function scan(url: string) {
  await page.fill('#scan-url', '');
  await page.type('#scan-url', url, { delay: 25 });
  await page.click('#scan-button');
  await page.waitForFunction(() => !document.querySelector('[aria-busy]') && !(document.getElementById('scan-button') as HTMLButtonElement).disabled, null, { timeout: 60_000 });
}

const URL = 'https://github.com/JetBrains/MPS';
await caption(`${mode === 'before' ? 'BEFORE (main)' : 'AFTER (this PR)'}: scanning JetBrains/MPS; GitHub fails on one SKILL.md (bugfix-workflow, injected 500)`);
await wait(1500);
await scan(URL);
await wait(800);
const count = await page.textContent('#count').catch(() => '');
await caption(mode === 'before'
  ? `BEFORE: the whole scan is lost: an error, and an empty catalog`
  : `AFTER: the ${count} read before the error are kept, with "Scan incomplete" on the repository`);
await wait(3500);
if (mode === 'after') {
  await page.mouse.wheel(0, 500);
  await wait(1500);
  await page.mouse.wheel(0, -500);
  await caption('AFTER: GitHub answers again; Scan again → the complete result replaces the partial one');
  fault.on = false;
  await wait(1500);
  await scan(URL);
  await caption(`AFTER: ${await page.textContent('#count')}, no error`);
  await wait(3000);
  await caption('AFTER: GitHub fails again; Scan again → the skills already in the catalog are kept');
  fault.on = true;
  await wait(1500);
  await scan(URL);
  await caption(`AFTER: the error is under the input; the catalog still has ${await page.textContent('#count')}`);
  await wait(4000);
}

recording = false;
await loop;
await browser.close();
server.close();

// An ffmpeg concat list: each frame lasts until the next.
const list = shots.map((shot, i) => `file '${shot.file}'\nduration ${(((shots[i + 1]?.at ?? shot.at + 1000) - shot.at) / 1000).toFixed(3)}`).join('\n');
writeFileSync(join(out, `frames-${mode}.txt`), `${list}\nfile '${shots.at(-1)!.file}'\n`);
const video = join(out, `ui-${mode}.mp4`);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(out, `frames-${mode}.txt`),
  '-vf', 'fps=10,format=yuv420p', '-c:v', 'libx264', '-movflags', '+faststart', video]);
console.log(video, shots.length, 'frames');

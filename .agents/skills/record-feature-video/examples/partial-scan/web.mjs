// The web part of the PR #7 video: a scan that stops partway keeps what it read; scanning again
// gets the rest; a rescan that stops partway leaves the catalog as it was.
// In the work dir: REPO=<checkout> node web.mjs → web.webm, shot-*.png.
import { drop, openRecorder, sleep, startServer } from './recorder.mjs';

const URL = 'https://github.com/anthropics/skills';
const DROP = `${import.meta.dirname}/drop-after`;

drop(DROP, 6);
const server = await startServer({ env: { DROP_FILE: DROP, LATENCY_MS: '350' } });
const take = await openRecorder();
const { page } = take;
try {
  await page.goto(server.url);
  await take.caption('Skill Atlas: a scan that stops partway keeps the skills it already read', 2800);

  await take.caption('Simulated flaky network: the connection drops after 6 <code>SKILL.md</code> files');
  await take.scan(URL);
  await take.caption('The 6 skills read before the drop stay in the catalog, with the error next to them');
  await take.moveTo(page.locator('#repositories .alert-error').first(), { left: true });
  await take.shot('shot-1');
  await sleep(4000);
  await page.mouse.wheel(0, 380);
  await sleep(2500);
  await page.mouse.wheel(0, -380);

  drop(DROP);
  await take.caption('Network back: scan again for the rest', 1200);
  await take.scan(URL);
  await take.caption('All 19 skills; the “Scan incomplete” notice is gone');
  await take.moveTo(page.locator('#repositories .badge').first());
  await take.shot('shot-2');
  await sleep(3500);

  drop(DROP, 3);
  await take.caption('Rescan an existing repository and the connection drops again…');
  await take.scan(URL);
  await take.caption('…the 19 skills already in the catalog are left as they were');
  await take.moveTo(page.locator('#scan-error'), { left: true });
  await take.shot('shot-3');
  await sleep(4500);
  await take.caption('', 600);
} finally {
  console.log(await take.close());
  server.stop();
  drop(DROP);
}

// spec/web.md: the server and the page, with GitHub answering from the recording below. The page
// runs in jsdom, as served: index.html, then app.js.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { after, before, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createBrowserBackend } from '../src/browser.ts';
import { openGitHub } from '../src/core/github.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { createWebServer, listen } from '../src/web/server.ts';
import { atlas, CLI, DEFAULTS, FIXTURE } from './helpers.ts';

const COMMIT = '1111111111111111111111111111111111111111';
const TAGGED = '2222222222222222222222222222222222222222';
const OTHER = '3333333333333333333333333333333333333333';
const FLAKY = '4444444444444444444444444444444444444444';

const REVIEW = `---
name: review
description: Review pull requests the way this team does. Use before every merge.
allowed-tools: Read, Grep
metadata:
  owner: platform
---
# Review

<script>alert('raw html')</script>

See [the guide](docs/guide.md), [an anchor](#steps), [bad](javascript:alert(1)) and [mail](mailto:a@example.com).
From the root: [the spec](/docs/spec.md) and ![logo](/assets/logo.png).

![diagram](img/flow.png)
`;

/** A tree answer: these files, all regular. */
function tree(paths: string[]) {
  return { status: 200, body: { truncated: false, tree: paths.map((path) => ({ path, mode: '100644', type: 'blob', sha: path })) } };
}

const raw = (repo: string, commit: string, path: string, body: string) => ({
  [`https://raw.githubusercontent.com/${repo}/${commit}/${path}`]: { status: 200, body },
});

/** acme/tools: three skills, one with a copy, one malformed; at main and at tag v1. acme/other: one. */
const RECORDING: Recording = {
  'https://api.github.com/repos/acme/tools': { status: 200, body: { full_name: 'acme/tools', default_branch: 'main' } },
  'https://api.github.com/repos/acme/tools/commits/main': { status: 200, body: { sha: COMMIT } },
  [`https://api.github.com/repos/acme/tools/git/trees/${COMMIT}?recursive=1`]: tree([
    '.claude/skills/review/SKILL.md',
    '.github/skills/review/SKILL.md',
    '.claude/skills/broken/SKILL.md',
    'skills/deploy/SKILL.md',
    'README.md',
  ]),
  ...raw('acme/tools', COMMIT, '.claude/skills/review/SKILL.md', REVIEW),
  ...raw('acme/tools', COMMIT, '.github/skills/review/SKILL.md', REVIEW),
  ...raw('acme/tools', COMMIT, '.claude/skills/broken/SKILL.md', '---\nname: [broken\n---\nBody.\n'),
  ...raw('acme/tools', COMMIT, 'skills/deploy/SKILL.md', '---\nname: deploy\ndescription: Ship to production. Carefully.\n---\n'),
  'https://api.github.com/repos/acme/tools/commits/v1': { status: 200, body: { sha: TAGGED } },
  [`https://api.github.com/repos/acme/tools/git/trees/${TAGGED}?recursive=1`]: tree(['skills/deploy/SKILL.md']),
  ...raw('acme/tools', TAGGED, 'skills/deploy/SKILL.md', '---\nname: deploy\ndescription: The old deploy.\n---\n'),
  'https://api.github.com/repos/acme/other': { status: 200, body: { full_name: 'acme/other', default_branch: 'trunk' } },
  'https://api.github.com/repos/acme/other/commits/trunk': { status: 200, body: { sha: OTHER } },
  [`https://api.github.com/repos/acme/other/git/trees/${OTHER}?recursive=1`]: tree(['.claude/skills/triage/SKILL.md']),
  ...raw('acme/other', OTHER, '.claude/skills/triage/SKILL.md', '---\nname: triage\ndescription: Sort new issues.\n---\nSteps.\n'),
  'https://api.github.com/repos/acme/missing': { status: 404, body: { message: 'Not Found' } },
  // acme/flaky: GitHub fails on one of its two skills; at tag v2, on its only one.
  'https://api.github.com/repos/acme/flaky': { status: 200, body: { full_name: 'acme/flaky', default_branch: 'main' } },
  'https://api.github.com/repos/acme/flaky/commits/main': { status: 200, body: { sha: FLAKY } },
  [`https://api.github.com/repos/acme/flaky/git/trees/${FLAKY}?recursive=1`]: tree(['skills/alpha/SKILL.md', 'skills/beta/SKILL.md']),
  ...raw('acme/flaky', FLAKY, 'skills/alpha/SKILL.md', '---\nname: alpha\ndescription: Read before the error.\n---\n'),
  [`https://raw.githubusercontent.com/acme/flaky/${FLAKY}/skills/beta/SKILL.md`]: { status: 500, body: 'oops' },
};

let base = '';
const server = createWebServer({
  open: (url) => openGitHub(url, { fetch: replay(RECORDING) }),
  rules: DEFAULTS,
  note: () => {},
});
before(async () => {
  base = await listen(server, 0);
});
after(() => server.close());

async function api(url: string) {
  const response = await fetch(`${base}api/scan?url=${encodeURIComponent(url)}`);
  return { status: response.status, body: await response.json() };
}

// The server

test('the page and its files, with a policy that allows no inline script', async () => {
  for (const [path, type] of [['', 'text/html'], ['app.js', 'text/javascript'], ['style.css', 'text/css']]) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type') ?? '', new RegExp(`^${type}`));
    assert.match(response.headers.get('content-security-policy') ?? '', /script-src 'self';/);
  }
  assert.equal((await fetch(`${base}../package.json`)).status, 404);
  assert.equal((await fetch(`${base}src/web/server.ts`)).status, 404);
});

test('only for the page itself: another host name is refused', async () => {
  const response = await new Promise<number>((resolve, reject) => {
    const request = new URL(base);
    import('node:http').then(({ get }) =>
      get({ host: '127.0.0.1', port: request.port, path: '/', headers: { Host: 'evil.example' } }, (answer) => resolve(answer.statusCode ?? 0)).on('error', reject),
    );
  });
  assert.equal(response, 403);
});

test('GET /api/scan: the skills, sorted, each with its link, summary, copies, properties and body', async () => {
  const { status, body } = await api('https://github.com/acme/tools');
  assert.equal(status, 200);
  assert.equal(body.source, 'https://github.com/acme/tools');
  assert.equal(body.repository.commit, COMMIT);
  assert.deepEqual(body.skills.map((skill: { name: string }) => skill.name), ['broken', 'deploy', 'review']);
  const review = body.skills[2];
  assert.equal(review.id, 'acme/tools:.claude/skills/review/SKILL.md');
  assert.equal(review.summary, 'Review pull requests the way this team does.');
  assert.equal(review.description, 'Review pull requests the way this team does. Use before every merge.');
  assert.equal(review.link, `https://github.com/acme/tools/blob/${COMMIT}/.claude/skills/review/SKILL.md`);
  assert.deepEqual(review.copies, ['.github/skills/review/SKILL.md']);
  assert.deepEqual(review.properties, { 'allowed-tools': 'Read, Grep', metadata: { owner: 'platform' } });
  assert.match(review.html, /<h1>Review<\/h1>/);
  assert.deepEqual(body.warnings, ['.claude/skills/broken/SKILL.md: malformed front matter: Flow sequence in block collection must be sufficiently indented and end with a ] at line 2, column 14; using the directory name']);
});

test('the body is made safe: raw HTML is text, unsafe links are dropped, relative and root-relative ones go to GitHub', async () => {
  const { body } = await api('github.com/acme/tools');
  const html: string = body.skills[2].html;
  const page = `https://github.com/acme/tools/blob/${COMMIT}/.claude/skills/review`;
  assert.doesNotMatch(html, /<script/);
  assert.match(html, /&#60;script&#62;alert\(&#39;raw html&#39;\)&#60;\/script&#62;/);
  assert.doesNotMatch(html, /javascript:/);
  assert.match(html, /, bad and /);
  assert.match(html, new RegExp(`<a href="${page}/docs/guide.md" target="_blank" rel="noopener noreferrer">the guide</a>`));
  assert.match(html, new RegExp(`<a href="${page}/SKILL.md#steps"`));
  assert.match(html, /<a href="mailto:a@example.com"/);
  assert.match(html, new RegExp(`<a href="https://github.com/acme/tools/blob/${COMMIT}/docs/spec.md"`));
  assert.match(html, new RegExp(`<img src="https://raw.githubusercontent.com/acme/tools/${COMMIT}/assets/logo.png" alt="logo"`));
  assert.match(html, new RegExp(`<img src="https://raw.githubusercontent.com/acme/tools/${COMMIT}/.claude/skills/review/img/flow.png" alt="diagram"`));
});

test('…/tree/<ref>: that ref, and a source of its own', async () => {
  const { status, body } = await api('https://github.com/acme/tools/tree/v1');
  assert.equal(status, 200);
  assert.equal(body.source, 'https://github.com/acme/tools/tree/v1');
  assert.equal(body.ref, 'v1');
  assert.deepEqual(body.skills.map((skill: { description: string }) => skill.description), ['The old deploy.']);
});

test('a missing or bad URL, or a local directory → 400; what the CLI explains → 422, with its message', async () => {
  assert.deepEqual(await api(''), { status: 400, body: { error: 'Paste a GitHub repository URL' } });
  assert.deepEqual(await api(FIXTURE), { status: 400, body: { error: `Not a GitHub repository URL: ${FIXTURE}` } });
  assert.deepEqual(await api('https://gitlab.com/a/b'), { status: 400, body: { error: 'Not a GitHub repository URL: https://gitlab.com/a/b' } });
  assert.deepEqual(await api('github.com/acme/missing'), { status: 422, body: { error: 'Repository not found: https://github.com/acme/missing' } });
});

test('a scan that stopped partway → 200, the skills read before it, and the error', async () => {
  const { status, body } = await api('https://github.com/acme/flaky');
  assert.equal(status, 200);
  assert.deepEqual(body.skills.map((skill: { name: string }) => skill.name), ['alpha']);
  assert.deepEqual(body.warnings, []);
  assert.equal(body.error, `GitHub answered 500 for https://raw.githubusercontent.com/acme/flaky/${FLAKY}/skills/beta/SKILL.md`);
  assert.equal('error' in (await api('https://github.com/acme/tools')).body, false);
});

test('a broken rules file → 422 and nothing is fetched', async (t) => {
  const fetched: string[] = [];
  const broken = createWebServer({
    open: (url) => openGitHub(url, { fetch: (url) => (fetched.push(url), replay(RECORDING)(url)) }),
    rules: { load: async () => ({ path: '/rules.yaml', text: 'version: 2\n' }), peek: async () => ({}) },
    note: () => {},
  });
  const address = await listen(broken, 0);
  t.after(() => broken.close());
  const response = await fetch(`${address}api/scan?url=github.com/acme/tools`);
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /^\/rules\.yaml:1: /);
  assert.deepEqual(fetched, []);
});

// The command

test('serve: in the help; a port in use → a clear message, exit code 1; not in the browser', async () => {
  assert.match((await atlas(['help'])).stdout, /serve \[--port <n>\]/);
  assert.equal((await atlas(['serve', '--port', 'x'])).stderr, 'Usage: skill-atlas serve [--port <n>]');
  const browser = createBrowserBackend({ fetch: async () => new Response('', { status: 404 }) });
  assert.equal(await browser.run('skill-atlas serve'), 'serve runs only from the command line');

  const busy = createServer();
  await new Promise<void>((resolve) => busy.listen(0, '127.0.0.1', resolve));
  const port = (busy.address() as { port: number }).port;
  try {
    const child = spawn(process.execPath, [CLI, 'serve', '--port', String(port)], { env: { ...process.env, SKILL_ATLAS_RULES: '/dev/null' } });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    const code = await new Promise((resolve) => child.on('exit', resolve));
    assert.equal(code, 1);
    assert.equal(stderr.trim(), `Port ${port} is in use; try serve --port <n>`);
  } finally {
    busy.close();
  }
});

test('serve: prints its address and answers there', async () => {
  const child = spawn(process.execPath, [CLI, 'serve', '--port', '0'], { env: { ...process.env, SKILL_ATLAS_RULES: '/dev/null' } });
  try {
    const line = await new Promise<string>((resolve) => child.stdout.once('data', (chunk) => resolve(String(chunk))));
    const address = /^Skill Atlas: (http:\/\/localhost:\d+\/)$/m.exec(line)?.[1];
    assert.ok(address, line);
    assert.equal((await fetch(address)).status, 200);
  } finally {
    child.kill();
  }
});

// The page

const APP = await readFile(new URL('../src/web/public/app.js', import.meta.url), 'utf8');

/** The page at `?<search>#<hash>`, as served, with its fetch going to the test server, or to `server`. */
async function page(address = '', server = base) {
  const html = await (await fetch(server)).text();
  const dom = new JSDOM(html, { url: `${server}${address}`, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.fetch = ((url: string) => fetch(new URL(url, server))) as typeof window.fetch;
  window.scrollTo = () => {};
  window.eval(APP);
  const document = window.document;
  const $ = (selector: string) => document.querySelector<HTMLElement>(selector);
  const all = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)];
  return {
    window,
    $,
    all,
    text: (selector: string) => $(selector)?.textContent?.trim() ?? '',
    texts: (selector: string) => all(selector).map((element) => element.textContent?.trim() ?? ''),
    params: () => new window.URL(window.location.href).searchParams.getAll('repo'),
    async scan(url: string) {
      ($('#scan-url') as HTMLInputElement).value = url;
      ($('#scan-form') as HTMLFormElement).requestSubmit();
      await until(() => !document.querySelector('[aria-busy]') && !($('#scan-button') as HTMLButtonElement).disabled);
    },
    filter(text: string) {
      const input = $('#filter') as HTMLInputElement;
      input.value = text;
      input.dispatchEvent(new window.Event('input'));
    },
  };
}

async function until(condition: () => boolean) {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(condition(), 'timed out');
}

test('the page: an empty catalog first', async () => {
  const { $, text } = await page();
  assert.equal($('#empty')?.hidden, false);
  assert.equal($('#toolbar')?.hidden, true);
  assert.equal(text('#repositories'), '');
});

test('the page: a pasted URL fills the catalog with a card per skill, sorted, and goes into the address', async () => {
  const p = await page();
  await p.scan('https://github.com/acme/tools');
  assert.equal(p.$('#empty')?.hidden, true);
  assert.equal(p.text('.repository-name'), 'acme/tools');
  assert.deepEqual(p.texts('.repository .badge'), ['3 skills', COMMIT.slice(0, 7)]);
  assert.deepEqual(p.texts('.card-title'), ['broken', 'deploy', 'review']);
  assert.deepEqual(p.texts('.card-text'), ['No description.', 'Ship to production.', 'Review pull requests the way this team does.']);
  assert.deepEqual(p.texts('.card-path'), ['.claude/skills/broken/SKILL.md', 'skills/deploy/SKILL.md', '.claude/skills/review/SKILL.md']);
  assert.equal(p.text('#count'), '3 skills');
  assert.deepEqual(p.params(), ['https://github.com/acme/tools']);
  assert.equal((p.$('#scan-url') as HTMLInputElement).value, '');
});

test('the page: warnings with their repository', async () => {
  const p = await page();
  await p.scan('github.com/acme/tools');
  assert.equal(p.text('[data-repository="acme/tools"] .alert-warn summary'), '1 warning');
  assert.match(p.text('[data-repository="acme/tools"] .alert-warn li'), /^\.claude\/skills\/broken\/SKILL\.md: malformed front matter/);
});

test('the page: more repositories, grouped; the same one again replaces it; each can be removed', async () => {
  const p = await page();
  await p.scan('github.com/acme/tools');
  await p.scan('https://github.com/acme/other');
  await p.scan('https://github.com/acme/tools/tree/v1');
  assert.deepEqual(p.texts('.repository-name'), ['acme/tools', 'acme/other', 'acme/tools']);
  assert.equal(p.text('#count'), '5 skills');
  await p.scan('https://github.com/acme/tools/'); // another way to write the first one
  assert.deepEqual(p.texts('.repository-name'), ['acme/tools', 'acme/other', 'acme/tools']);
  assert.deepEqual(p.params(), ['https://github.com/acme/tools', 'https://github.com/acme/other', 'https://github.com/acme/tools/tree/v1']);

  (p.$('[data-repository="acme/other"] .button-ghost') as HTMLButtonElement).click();
  assert.deepEqual(p.texts('.repository-name'), ['acme/tools', 'acme/tools']);
  assert.deepEqual(p.params(), ['https://github.com/acme/tools', 'https://github.com/acme/tools/tree/v1']);
});

test('the page: the filter narrows by name, description or path, in any letter case', async () => {
  const p = await page();
  await p.scan('github.com/acme/tools');
  await p.scan('github.com/acme/other');
  p.filter('DEPLOY');
  assert.deepEqual(p.texts('.card-title'), ['deploy']);
  assert.equal(p.text('#count'), '1 of 4 skills');
  assert.equal(p.text('[data-repository="acme/other"] p'), 'No skill matches the filter.');
  p.filter('team does');
  assert.deepEqual(p.texts('.card-title'), ['review']);
  p.filter('.claude/skills/');
  assert.deepEqual(p.texts('.card-title'), ['broken', 'review', 'triage']);
  p.filter('');
  assert.equal(p.all('.card').length, 4);
});

test('the page: an error under the input, and the catalog as it was', async () => {
  const p = await page();
  await p.scan('github.com/acme/tools');
  for (const [url, message] of [
    ['github.com/acme/missing', 'Repository not found: https://github.com/acme/missing'],
    ['./fixture', 'Not a GitHub repository URL: ./fixture'],
  ]) {
    await p.scan(url);
    assert.equal(p.$('#scan-error')?.hidden, false);
    assert.equal(p.text('#scan-error'), message);
    assert.deepEqual(p.texts('.repository-name'), ['acme/tools']);
    assert.deepEqual(p.params(), ['https://github.com/acme/tools']);
  }
  await p.scan('github.com/acme/other');
  assert.equal(p.$('#scan-error')?.hidden, true);
});

test('the page: a scan that stopped partway adds the skills read before it, with the error', async () => {
  const p = await page();
  await p.scan('github.com/acme/flaky');
  assert.equal(p.$('#scan-error')?.hidden, true);
  assert.deepEqual(p.texts('.card-title'), ['alpha']);
  assert.equal(
    p.text('[data-repository="acme/flaky"] .alert-error'),
    `Scan incomplete: GitHub answered 500 for https://raw.githubusercontent.com/acme/flaky/${FLAKY}/skills/beta/SKILL.md. These are the skills read before it; scan again for the rest.`,
  );
  assert.deepEqual(p.params(), ['https://github.com/acme/flaky']);
});

test('the page: a repository already in the catalog keeps its skills when a new scan of it stops partway', async () => {
  // The first scan is complete; GitHub fails on the second.
  let failing = false;
  const failed: Recording = { ...RECORDING, [`https://raw.githubusercontent.com/acme/tools/${COMMIT}/skills/deploy/SKILL.md`]: { status: 500, body: 'oops' } };
  const flaky = createWebServer({
    open: (url) => openGitHub(url, { fetch: replay(failing ? failed : RECORDING) }),
    rules: DEFAULTS,
    note: () => {},
  });
  const address = await listen(flaky, 0);
  try {
    const p = await page('', address);
    await p.scan('github.com/acme/tools');
    assert.deepEqual(p.texts('.card-title'), ['broken', 'deploy', 'review']);
    failing = true;
    await p.scan('https://github.com/acme/tools');
    assert.equal(p.$('#scan-error')?.hidden, false);
    assert.equal(
      p.text('#scan-error'),
      `Scan incomplete: GitHub answered 500 for https://raw.githubusercontent.com/acme/tools/${COMMIT}/skills/deploy/SKILL.md; acme/tools is left as it was`,
    );
    assert.deepEqual(p.texts('.card-title'), ['broken', 'deploy', 'review']);
    assert.equal(p.all('.repository .alert-error').length, 0);
    assert.deepEqual(p.params(), ['https://github.com/acme/tools']);
  } finally {
    flaky.close();
  }
});

test('the page: a card opens its skill, with everything the SKILL.md says; Back returns to the catalog', async () => {
  const p = await page();
  await p.scan('github.com/acme/tools');
  p.$('[data-skill="acme/tools:.claude/skills/review/SKILL.md"]')?.click();
  await until(() => p.$('#skill-view')?.hidden === false);
  assert.equal(p.$('#catalog-view')?.hidden, true);
  assert.equal(p.text('#skill-view h1'), 'review');
  assert.equal(p.text('#skill-view .lead'), 'Review pull requests the way this team does. Use before every merge.');
  assert.equal(p.$('#skill-view [data-link]')?.getAttribute('href'), `https://github.com/acme/tools/blob/${COMMIT}/.claude/skills/review/SKILL.md`);
  const meta = Object.fromEntries(p.all('.meta dt').map((dt) => [dt.textContent, dt.nextElementSibling?.textContent?.trim()]));
  assert.equal(meta.Repository, 'acme/tools');
  assert.equal(meta.Path, '.claude/skills/review/SKILL.md');
  assert.equal(meta['Also in'], '.github/skills/review/SKILL.md');
  assert.equal(meta['allowed-tools'], 'Read, Grep');
  assert.deepEqual(JSON.parse(meta.metadata ?? ''), { owner: 'platform' });
  assert.equal(p.text('.prose h1'), 'Review');
  assert.equal(p.all('.prose script').length, 0);
  assert.match(p.text('.prose'), /<script>alert\('raw html'\)<\/script>/);

  (p.$('#skill-view .back') as HTMLButtonElement).click();
  await until(() => p.$('#catalog-view')?.hidden === false);
  assert.equal(p.$('#skill-view')?.hidden, true);
  assert.equal(p.all('.card').length, 3);
});

test('the page: nothing is stored; a reload of the address scans again and opens the skill', async () => {
  const id = encodeURIComponent('acme/other:.claude/skills/triage/SKILL.md');
  const p = await page(`?repo=${encodeURIComponent('https://github.com/acme/tools')}&repo=github.com/acme/other#${id}`);
  await until(() => p.text('#skill-view h1') === 'triage');
  assert.equal(p.text('.prose'), 'Steps.');
  (p.$('#skill-view .back') as HTMLButtonElement).click();
  await until(() => p.all('.repository-name').length === 2 && !p.$('[aria-busy]'));
  assert.deepEqual(p.texts('.repository-name'), ['acme/tools', 'acme/other']);
  assert.equal(p.window.location.hash, '');

  const unknown = await page(`?repo=github.com/acme/other#${encodeURIComponent('acme/other:nope')}`);
  await until(() => unknown.text('#skill-view .empty-title') !== '');
  assert.equal(unknown.text('#skill-view .empty-title'), 'acme/other:nope is not in the catalog');
});

// spec/web.md: the server and the page, with GitHub answering from the recording below. The page
// runs in jsdom, as served: index.html, then app.js.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { after, before, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createBrowserBackend } from '../src/browser.ts';
import { openGitHub, openGitHubOwner, type Fetch } from '../src/core/github.ts';
import { replay, type Recorded, type Recording } from '../src/core/replay.ts';
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
  // acme, the organization: tools and other, a fork never opened, an empty one and one gone.
  'https://api.github.com/users/acme': { status: 200, body: { login: 'acme', type: 'Organization' } },
  'https://api.github.com/orgs/acme/repos?type=all&per_page=100&page=1': {
    status: 200,
    body: [
      { full_name: 'acme/tools', default_branch: 'main', fork: false, archived: false },
      { full_name: 'acme/fork', default_branch: 'main', fork: true, archived: false },
      { full_name: 'acme/empty', default_branch: 'main', fork: false, archived: false },
      { full_name: 'acme/other', default_branch: 'trunk', fork: false, archived: false },
      { full_name: 'acme/lost', default_branch: 'main', fork: false, archived: false },
    ],
  },
  'https://api.github.com/repos/acme/empty/commits/main': { status: 409, body: { message: 'Git Repository is empty.' } },
  'https://api.github.com/repos/acme/lost/commits/main': { status: 404, body: { message: 'Not Found' } },
  'https://api.github.com/users/nobody': { status: 404, body: { message: 'Not Found' } },
};

let base = '';
const server = createWebServer({
  open: (url) => openGitHub(url, { fetch: replay(RECORDING) }),
  openOwner: (url) => openGitHubOwner(url, { fetch: replay(RECORDING) }),
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
  assert.deepEqual(await api(''), { status: 400, body: { error: 'Paste a GitHub repository or organization URL' } });
  assert.deepEqual(await api(FIXTURE), { status: 400, body: { error: `Not a GitHub repository or organization URL: ${FIXTURE}` } });
  assert.deepEqual(await api('https://gitlab.com/a/b'), { status: 400, body: { error: 'Not a GitHub repository or organization URL: https://gitlab.com/a/b' } });
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

test('GET /api/scan for an organization: its repositories with skills, each as for one, and the other warnings', async () => {
  const { status, body } = await api('https://github.com/acme/');
  assert.equal(status, 200);
  assert.equal(body.source, 'https://github.com/acme');
  assert.deepEqual(body.owner, { id: 'acme', url: 'https://github.com/acme' });
  assert.equal(body.listed, 4);
  assert.deepEqual(body.repositories.map((repository: { source: string }) => repository.source), ['https://github.com/acme/other', 'https://github.com/acme/tools']);
  // The same answer as the repository on its own.
  assert.deepEqual(body.repositories[1], (await api('https://github.com/acme/tools')).body);
  assert.deepEqual(body.warnings, ['acme/lost: Not found in acme/lost: main; skipped']);
  assert.deepEqual(await api('github.com/nobody'), { status: 422, body: { error: 'Organization or user not found: https://github.com/nobody' } });
});

/**
 * A server whose GitHub holds these requests back until each is released, then answers it from the
 * recording, or with `answers`. A request is aborted, held back or not, as fetch's would be;
 * `fetched` is every one asked for.
 */
async function holding(held: string[], answers: Recording = {}) {
  const releases = new Map<string, () => void>();
  const waits = new Map(held.map((url) => [url, new Promise<void>((resolve) => releases.set(url, resolve))]));
  const fetched: string[] = [];
  const github: Fetch = async (url, init) => {
    fetched.push(url);
    const { signal } = init ?? {};
    await Promise.race([
      waits.get(url),
      new Promise((_, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true })),
    ]);
    signal?.throwIfAborted();
    return replay({ ...RECORDING, ...answers })(url, init);
  };
  const server = createWebServer({
    open: (url, signal) => openGitHub(url, { fetch: github, signal }),
    openOwner: (url, signal) => openGitHubOwner(url, { fetch: github, signal }),
    rules: DEFAULTS,
    note: () => {},
  });
  const address = await listen(server, 0);
  return {
    address,
    fetched,
    release: (url: string) => releases.get(url)?.(),
    close: () => {
      for (const release of releases.values()) release();
      server.closeAllConnections();
      server.close();
    },
  };
}

const RATE_LIMITED: Recorded = { status: 403, body: { message: 'API rate limit exceeded for 127.0.0.1.' } };

/** `GET /api/scan`, a line at a time, as the page asks for an organization. */
async function lines(address: string, url: string) {
  const response = await fetch(`${address}api/scan?url=${encodeURIComponent(url)}`, { headers: { Accept: 'application/x-ndjson, application/json' } });
  return { status: response.status, type: response.headers.get('content-type'), text: await response.text() };
}

test('GET /api/scan for an organization, a line at a time: the owner, each repository\'s skills as they are read and the repository as it is done, then the warnings', async (t) => {
  // acme/other is held back: acme/tools is done first, yet acme/other keeps its place in the list.
  const server = await holding(['https://api.github.com/repos/acme/other/commits/trunk']);
  t.after(server.close);
  const answer = lines(server.address, 'https://github.com/acme/');
  const { body: whole } = await api('https://github.com/acme');
  setTimeout(() => server.release('https://api.github.com/repos/acme/other/commits/trunk'), 50);
  const { status, type, text } = await answer;
  assert.equal(status, 200);
  assert.equal(type, 'application/x-ndjson; charset=utf-8');
  const messages = text.trimEnd().split('\n').map((line) => JSON.parse(line));
  // The repositories to scan: the listed ones; the fork is not one of them.
  assert.deepEqual(messages[0], { type: 'organization', source: 'https://github.com/acme', owner: whole.owner, listed: 4, scanning: 4 });
  // empty, lost, other, tools: each is heard of once, with its answer only if it has skills.
  const repositories = messages.filter((message) => message.type === 'repository');
  assert.equal(repositories.length, 4);
  assert.deepEqual(messages.slice(1, -1).filter((message) => message.type !== 'skill'), repositories);
  assert.deepEqual(repositories.map((message) => message.index).sort(), [0, 1, 2, 3]);
  assert.equal(repositories.at(-1).repository.source, 'https://github.com/acme/other');
  const withSkills = repositories.filter((message) => message.repository).sort((a, b) => a.index - b.index);
  // The same answers as the whole organization's at once.
  assert.deepEqual(withSkills.map((message) => message.repository), whole.repositories);
  assert.deepEqual(messages.at(-1), { type: 'done', warnings: whole.warnings });
  // Before its repository, each skill of it, as it is in the answer but for the copies, read later.
  for (const { index, repository } of withSkills) {
    const done = messages.findIndex((message) => message.type === 'repository' && message.index === index);
    const skills = messages.slice(1, done).filter((message) => message.type === 'skill' && message.index === index);
    assert.deepEqual(skills.map(({ source, ref, repository }) => ({ source, ref, repository })), skills.map(() => ({ source: repository.source, ref: '', repository: repository.repository })));
    assert.deepEqual(
      skills.map((message) => message.skill).sort((a, b) => (a.id < b.id ? -1 : 1)),
      repository.skills.map((skill: { copies: string[] }) => ({ ...skill, copies: [] })).sort((a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : 1)),
    );
  }
});

test('GET /api/scan for a repository, a line at a time: the repository, each skill as it is read, then the whole answer', async (t) => {
  // The copy of review is held back: deploy, broken and review are read, and certain, before it.
  const held = `https://raw.githubusercontent.com/acme/tools/${COMMIT}/.github/skills/review/SKILL.md`;
  const server = await holding([held]);
  t.after(server.close);
  const answer = lines(server.address, 'https://github.com/acme/tools');
  const { body: whole } = await api('https://github.com/acme/tools');
  setTimeout(() => server.release(held), 50);
  const { status, type, text } = await answer;
  assert.equal(status, 200);
  assert.equal(type, 'application/x-ndjson; charset=utf-8');
  const messages = text.trimEnd().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(messages[0], { type: 'opened', source: whole.source, ref: '', repository: whole.repository });
  // The shortest path first: a skill is heard of once every path that could be its main one is read.
  const skills = messages.slice(1, -1);
  assert.deepEqual(skills.map((message) => message.skill.path), ['skills/deploy/SKILL.md', '.claude/skills/broken/SKILL.md', '.claude/skills/review/SKILL.md']);
  const byPath = new Map(whole.skills.map((skill: { path: string }) => [skill.path, skill]));
  for (const { type, skill } of skills) {
    assert.equal(type, 'skill');
    assert.deepEqual(skill, { ...(byPath.get(skill.path) as object), copies: [] });
  }
  assert.deepEqual(messages.at(-1), { type: 'done', scan: whole });

  // At a ref too.
  const tagged = await lines(server.address, 'github.com/acme/tools/tree/v1');
  const last = JSON.parse(tagged.text.trimEnd().split('\n').at(-1) ?? '');
  assert.deepEqual(last, { type: 'done', scan: (await api('github.com/acme/tools/tree/v1')).body });
});

test('a line at a time: what fails before the first line is a 422 as at once; the rate limit on the way, a line of its own', async (t) => {
  const server = await holding([], { 'https://api.github.com/repos/acme/lost/commits/main': RATE_LIMITED });
  t.after(server.close);
  const unknown = await lines(server.address, 'github.com/nobody');
  assert.equal(unknown.status, 422);
  assert.deepEqual(JSON.parse(unknown.text), { error: 'Organization or user not found: https://github.com/nobody' });
  const missing = await lines(server.address, 'github.com/acme/missing');
  assert.equal(missing.status, 422);
  assert.deepEqual(JSON.parse(missing.text), { error: 'Repository not found: https://github.com/acme/missing' });

  const { status, text } = await lines(server.address, 'github.com/acme');
  assert.equal(status, 200);
  const messages = text.trimEnd().split('\n').map((line) => JSON.parse(line));
  assert.equal(messages[0].type, 'organization');
  assert.deepEqual(messages.at(-1), { type: 'error', error: 'GitHub rate limit reached; set GITHUB_TOKEN' });
  assert.ok(!messages.some((message) => message.type === 'done'));
});

test('a repository, a line at a time: a file error keeps the other skills and is in the final result', async (t) => {
  const failing = `https://raw.githubusercontent.com/acme/tools/${COMMIT}/.github/skills/review/SKILL.md`;
  const server = await holding([], { [failing]: { status: 500, body: 'oops' } });
  t.after(server.close);
  const { status, text } = await lines(server.address, 'github.com/acme/tools');
  assert.equal(status, 200);
  const messages = text.trimEnd().split('\n').map((line) => JSON.parse(line));
  assert.equal(messages[0].type, 'opened');
  const last = messages.at(-1);
  assert.equal(last.type, 'done');
  assert.equal(last.scan.error, `GitHub answered 500 for ${failing}`);
  assert.deepEqual(last.scan.skills.map((skill: { name: string }) => skill.name), ['broken', 'deploy', 'review']);
  assert.ok(messages.slice(1, -1).every((message) => message.type === 'skill'));
});

test('a page that goes away stops its scan: nothing more is fetched, and no queued repository is opened', async (t) => {
  // many: 12 repositories, each held back once it is opened; 8 are scanned at once, so 4 wait.
  const names = Array.from({ length: 12 }, (_, i) => `many/r${String(i + 1).padStart(2, '0')}`);
  const commits = (name: string) => `https://api.github.com/repos/${name}/commits/main`;
  const server = await holding(names.map(commits), {
    'https://api.github.com/users/many': { status: 200, body: { login: 'many', type: 'Organization' } },
    'https://api.github.com/orgs/many/repos?type=all&per_page=100&page=1': {
      status: 200,
      body: names.map((full_name) => ({ full_name, default_branch: 'main', fork: false, archived: false })),
    },
    ...Object.fromEntries(names.map((name) => [commits(name), { status: 200, body: { sha: COMMIT } }])),
    ...Object.fromEntries(names.map((name) => [`https://api.github.com/repos/${name}/git/trees/${COMMIT}?recursive=1`, tree([])])),
  });
  t.after(server.close);
  const controller = new AbortController();
  const response = await fetch(`${server.address}api/scan?url=${encodeURIComponent('github.com/many')}`, {
    headers: { Accept: 'application/x-ndjson' },
    signal: controller.signal,
  });
  const reader = response.body!.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /"type":"organization"/);
  await until(() => server.fetched.filter((url) => url.endsWith('/commits/main')).length === 8);
  controller.abort();
  await new Promise((resolve) => setTimeout(resolve, 100));
  for (const name of names) server.release(commits(name));
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(server.fetched.filter((url) => url.endsWith('/commits/main')), names.slice(0, 8).map(commits));
  assert.deepEqual(server.fetched.filter((url) => url.includes('/git/trees/')), []);
});

test('a broken rules file → 422 and nothing is fetched', async (t) => {
  const fetched: string[] = [];
  const broken = createWebServer({
    open: (url) => openGitHub(url, { fetch: (url) => (fetched.push(url), replay(RECORDING)(url)) }),
    openOwner: (url) => openGitHubOwner(url, { fetch: (url) => (fetched.push(url), replay(RECORDING)(url)) }),
    rules: { load: async () => ({ path: '/rules.yaml', text: 'version: 2\n' }), peek: async () => ({}) },
    note: () => {},
  });
  const address = await listen(broken, 0);
  t.after(() => broken.close());
  for (const url of ['github.com/acme/tools', 'github.com/acme']) {
    const response = await fetch(`${address}api/scan?url=${url}`);
    assert.equal(response.status, 422);
    assert.match((await response.json()).error, /^\/rules\.yaml:1: /);
  }
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

/** The page at `?<search>#<hash>`, as served, with its fetch going to the test server. */
async function page(address = '', at = base) {
  const html = await (await fetch(at)).text();
  const dom = new JSDOM(html, { url: `${at}${address}`, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.fetch = serverFetch(at);
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

/** The page's fetch, to the test server: jsdom's abort signal passed on as one of Node's. */
function serverFetch(at: string) {
  return ((url: string, init?: RequestInit) => {
    const controller = new AbortController();
    if (init?.signal?.aborted) controller.abort();
    init?.signal?.addEventListener('abort', () => controller.abort());
    return fetch(new URL(url, at), { ...init, signal: controller.signal });
  }) as typeof fetch;
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
    ['./fixture', 'Not a GitHub repository or organization URL: ./fixture'],
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
    openOwner: (url) => openGitHubOwner(url, { fetch: replay(RECORDING) }),
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

test('the page: an organization is one entry, its repositories with skills inside it', async () => {
  const p = await page();
  await p.scan('github.com/acme');
  assert.equal(p.text('.organization-name'), 'acme');
  assert.equal(p.text('[data-organization="acme"] .organization-head .badge'), '4 skills in 2 of 4 repositories');
  assert.deepEqual(p.texts('[data-organization="acme"] .repository .repository-name'), ['acme/other', 'acme/tools']);
  assert.deepEqual(p.texts('[data-repository="acme/tools"] .card-title'), ['broken', 'deploy', 'review']);
  assert.equal(p.text('#count'), '4 skills');
  assert.deepEqual(p.params(), ['https://github.com/acme']);
  // The organization's warnings, and each repository's with it.
  assert.equal(p.text('[data-organization="acme"] > .alert-warn li'), 'acme/lost: Not found in acme/lost: main; skipped');
  assert.equal(p.text('[data-repository="acme/tools"] .alert-warn summary'), '1 warning');
  // Removed as a whole only.
  assert.equal(p.all('[data-organization="acme"] .button-ghost').length, 1);

  p.filter('triage');
  assert.deepEqual(p.texts('.card-title'), ['triage']);
  assert.equal(p.text('#count'), '1 of 4 skills');
  p.filter('');
});

test('the page: the organization again replaces it; one of its repositories is an entry of its own; it is removed as a whole', async () => {
  const p = await page();
  await p.scan('github.com/acme');
  await p.scan('https://github.com/acme/');
  assert.deepEqual(p.texts('.organization-name'), ['acme']);
  await p.scan('github.com/acme/tools');
  assert.deepEqual(p.params(), ['https://github.com/acme', 'https://github.com/acme/tools']);
  assert.equal(p.text('#count'), '7 skills');

  (p.$('[data-organization="acme"] .organization-head .button-ghost') as HTMLButtonElement).click();
  assert.deepEqual(p.texts('.organization-name'), []);
  assert.deepEqual(p.texts('.repository-name'), ['acme/tools']);
  assert.deepEqual(p.params(), ['https://github.com/acme/tools']);
});

test('the page: a skill of an organization opens, and a reload of its address scans the organization again', async () => {
  const id = encodeURIComponent('acme/other:.claude/skills/triage/SKILL.md');
  const p = await page(`?repo=${encodeURIComponent('https://github.com/acme')}#${id}`);
  await until(() => p.text('#skill-view h1') === 'triage');
  const meta = Object.fromEntries(p.all('.meta dt').map((dt) => [dt.textContent, dt.nextElementSibling?.textContent?.trim()]));
  assert.equal(meta.Repository, 'acme/other');
  assert.equal(p.$('#skill-view [data-link]')?.getAttribute('href'), `https://github.com/acme/other/blob/${OTHER}/.claude/skills/triage/SKILL.md`);
  (p.$('#skill-view .back') as HTMLButtonElement).click();
  await until(() => p.$('#catalog-view')?.hidden === false && !p.$('[aria-busy]'));
  assert.deepEqual(p.texts('[data-organization="acme"] .repository .repository-name'), ['acme/other', 'acme/tools']);
});

test('the page: the same skill in two entries, at two commits: each card opens its own, and so does a reload', async () => {
  const p = await page();
  await p.scan('github.com/acme'); // acme/tools at main
  await p.scan('https://github.com/acme/tools/tree/v1'); // the same skill, at v1
  const id = 'acme/tools:skills/deploy/SKILL.md';
  const opened = async (card: HTMLElement | null) => {
    card?.click();
    await until(() => p.$('#skill-view')?.hidden === false);
    const result = { lead: p.text('#skill-view .lead'), link: p.$('#skill-view [data-link]')?.getAttribute('href'), hash: p.window.location.hash };
    (p.$('#skill-view .back') as HTMLButtonElement).click();
    await until(() => p.$('#catalog-view')?.hidden === false);
    return result;
  };
  const tagged = await opened(p.$(`#repositories > [data-repository="acme/tools"] [data-skill="${id}"]`));
  assert.equal(tagged.lead, 'The old deploy.');
  assert.equal(tagged.link, `https://github.com/acme/tools/blob/${TAGGED}/skills/deploy/SKILL.md`);
  const organization = await opened(p.$(`[data-organization="acme"] [data-skill="${id}"]`));
  assert.equal(organization.lead, 'Ship to production. Carefully.');
  assert.equal(organization.link, `https://github.com/acme/tools/blob/${COMMIT}/skills/deploy/SKILL.md`);

  const reloaded = await page(`?repo=github.com/acme&repo=${encodeURIComponent('https://github.com/acme/tools/tree/v1')}${tagged.hash}`);
  await until(() => reloaded.text('#skill-view h1') === 'deploy');
  assert.equal(reloaded.text('#skill-view .lead'), 'The old deploy.');
});

test('the page: an organization\'s repositories show up as each is scanned, in its order, before the scan is done', async (t) => {
  const held = 'https://api.github.com/repos/acme/other/commits/trunk';
  const server = await holding([held]);
  t.after(server.close);
  const deploy = `#${new URLSearchParams({ in: 'https://github.com/acme', skill: 'acme/tools:skills/deploy/SKILL.md' })}`;
  const p = await page(`?repo=github.com/acme${deploy}`, server.address);
  // The open skill shows as soon as its repository is in, while acme/other is still being scanned.
  await until(() => p.text('#skill-view h1') === 'deploy');
  assert.equal(p.text('#skill-view .lead'), 'Ship to production. Carefully.');
  (p.$('#skill-view .back') as HTMLButtonElement).click();
  await until(() => p.$('#catalog-view')?.hidden === false);

  const organization = '[data-organization="acme"]';
  assert.equal(p.$(organization)?.getAttribute('aria-busy'), 'true');
  assert.equal(p.text(`${organization} .organization-head .badge`), '3 skills in 1 of 4 repositories');
  assert.equal(p.text(`${organization} [data-progress]`), 'scanned 3 of 4');
  assert.deepEqual(p.texts(`${organization} .repository .repository-name`), ['acme/tools']);
  assert.equal(p.text('#count'), '3 skills');
  // Its warnings come once it is done.
  assert.equal(p.$(`${organization} > .alert-warn`), null);

  server.release(held);
  await until(() => !p.$('[aria-busy]'));
  assert.deepEqual(p.texts(`${organization} .repository .repository-name`), ['acme/other', 'acme/tools']);
  assert.equal(p.text(`${organization} .organization-head .badge`), '4 skills in 2 of 4 repositories');
  assert.equal(p.$(`${organization} [data-progress]`), null);
  assert.equal(p.text(`${organization} > .alert-warn li`), 'acme/lost: Not found in acme/lost: main; skipped');
});

test('the page: a card opened while its organization is still being scanned has an address that scans it again', async (t) => {
  const held = 'https://api.github.com/repos/acme/other/commits/trunk';
  const server = await holding([held]);
  t.after(server.close);
  const p = await page('', server.address);
  (p.$('#scan-url') as HTMLInputElement).value = 'github.com/acme';
  (p.$('#scan-form') as HTMLFormElement).requestSubmit();
  // acme/tools is in, acme/other still being scanned: the organization is in the address already.
  const id = 'acme/tools:skills/deploy/SKILL.md';
  await until(() => p.$(`[data-organization="acme"] [data-skill="${id}"]`) !== null);
  assert.deepEqual(p.params(), ['https://github.com/acme']);
  p.$(`[data-organization="acme"] [data-skill="${id}"]`)?.click();
  await until(() => p.text('#skill-view h1') === 'deploy');
  assert.deepEqual(p.params(), ['https://github.com/acme']);
  assert.notEqual(p.$('[aria-busy]'), null);

  // A reload of that address, before the first scan is done, scans the organization and opens the skill.
  const address = p.window.location.href.slice(server.address.length);
  const reloaded = await page(address, server.address);
  await until(() => reloaded.text('#skill-view h1') === 'deploy');
  assert.equal(reloaded.text('#skill-view .lead'), 'Ship to production. Carefully.');

  // Back, while the scan goes on, is the catalog with the organization in its address.
  (p.$('#skill-view .back') as HTMLButtonElement).click();
  await until(() => p.$('#catalog-view')?.hidden === false);
  assert.deepEqual(p.params(), ['https://github.com/acme']);
  server.release(held);
  await until(() => !p.$('[aria-busy]') && !reloaded.$('[aria-busy]'));
  assert.deepEqual(p.params(), ['https://github.com/acme']);
});

test('the page: an organization that fails on the way is an error under the input, and the catalog as it was', async (t) => {
  // acme/lost answers with the rate limit, once acme/tools is on the page.
  const held = 'https://api.github.com/repos/acme/lost/commits/main';
  const server = await holding([held], { [held]: RATE_LIMITED });
  t.after(server.close);
  const p = await page('', server.address);
  await p.scan('github.com/acme/other');
  (p.$('#scan-url') as HTMLInputElement).value = 'github.com/acme';
  (p.$('#scan-form') as HTMLFormElement).requestSubmit();
  await until(() => p.texts('[data-organization="acme"] .repository .repository-name').includes('acme/tools'));
  server.release(held);
  await until(() => !p.$('[aria-busy]') && p.text('#scan-error') !== '');
  assert.equal(p.text('#scan-error'), 'GitHub rate limit reached; set GITHUB_TOKEN');
  assert.deepEqual(p.texts('.organization-name'), []);
  assert.deepEqual(p.texts('.repository-name'), ['acme/other']);
  assert.deepEqual(p.params(), ['https://github.com/acme/other']);
  assert.equal(p.text('#count'), '1 skill');
});

test('the page: an organization scanned again that fails on the way is left as it was', async (t) => {
  const p = await page();
  await p.scan('github.com/acme');
  const before = p.$('#repositories')?.innerHTML;
  // The same page, now against a GitHub out of requests for acme/lost.
  const server = await holding([], { 'https://api.github.com/repos/acme/lost/commits/main': RATE_LIMITED });
  t.after(server.close);
  p.window.fetch = serverFetch(server.address);
  await p.scan('https://github.com/acme');
  assert.equal(p.text('#scan-error'), 'GitHub rate limit reached; set GITHUB_TOKEN');
  assert.equal(p.$('#repositories')?.innerHTML, before);
  assert.deepEqual(p.params(), ['https://github.com/acme']);
});

test('the page: an unknown organization is an error under the input, and the catalog as it was', async () => {
  const p = await page();
  await p.scan('github.com/acme/other');
  await p.scan('https://github.com/nobody');
  assert.equal(p.text('#scan-error'), 'Organization or user not found: https://github.com/nobody');
  assert.deepEqual(p.texts('.repository-name'), ['acme/other']);
  assert.deepEqual(p.params(), ['https://github.com/acme/other']);
});

test('the page: a repository\'s skills show up as each is read; the page is all there while it goes on', async (t) => {
  const held = `https://raw.githubusercontent.com/acme/tools/${COMMIT}/.github/skills/review/SKILL.md`;
  const server = await holding([held]);
  t.after(server.close);
  const p = await page('', server.address);
  (p.$('#scan-url') as HTMLInputElement).value = 'github.com/acme/tools';
  (p.$('#scan-form') as HTMLFormElement).requestSubmit();
  const tools = '[data-repository="acme/tools"]';
  await until(() => p.all(`${tools} .card`).length === 3);
  // Its commit and its cards, sorted, while the copy of review is still being read.
  assert.equal(p.$(tools)?.getAttribute('aria-busy'), 'true');
  assert.deepEqual(p.texts(`${tools} .badge`), ['3 skills', COMMIT.slice(0, 7)]);
  assert.deepEqual(p.texts('.card-title'), ['broken', 'deploy', 'review']);
  assert.deepEqual(p.params(), ['https://github.com/acme/tools']);
  // The same URL again, meanwhile: it is being scanned already.
  (p.$('#scan-url') as HTMLInputElement).value = 'https://github.com/acme/tools';
  (p.$('#scan-form') as HTMLFormElement).requestSubmit();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal((p.$('#scan-url') as HTMLInputElement).value, '');
  assert.equal(p.all(`${tools} .card`).length, 3);
  // Another scan, and the filter, meanwhile.
  assert.equal((p.$('#scan-button') as HTMLButtonElement).disabled, false);
  assert.equal(p.text('#scan-button'), 'Scan');
  (p.$('#scan-url') as HTMLInputElement).value = 'github.com/acme/other';
  (p.$('#scan-form') as HTMLFormElement).requestSubmit();
  await until(() => p.$('[data-repository="acme/other"]:not([aria-busy]) .card') !== null);
  assert.deepEqual(p.texts('.repository-name'), ['acme/tools', 'acme/other']);
  assert.equal(p.$(tools)?.getAttribute('aria-busy'), 'true');
  p.filter('review');
  assert.deepEqual(p.texts('.card-title'), ['review']);
  p.filter('');

  // review opens; its copy is in once the scan is done, and the skill stays open, where it was scrolled to.
  let scrolled = 0;
  p.window.scrollTo = () => void scrolled++;
  p.$(`${tools} [data-skill="acme/tools:.claude/skills/review/SKILL.md"]`)?.click();
  await until(() => p.text('#skill-view h1') === 'review');
  const meta = () => Object.fromEntries(p.all('.meta dt').map((dt) => [dt.textContent, dt.nextElementSibling?.textContent?.trim()]));
  assert.equal(meta()['Also in'], undefined);
  assert.equal(scrolled, 1);
  server.release(held);
  await until(() => meta()['Also in'] === '.github/skills/review/SKILL.md');
  assert.equal(p.text('#skill-view h1'), 'review');
  assert.equal(scrolled, 1);
  (p.$('#skill-view .back') as HTMLButtonElement).click();
  await until(() => p.$('#catalog-view')?.hidden === false);
  assert.equal(p.$('[aria-busy]'), null);
  assert.equal(p.text('#count'), '4 skills');
  assert.equal(p.text(`${tools} .alert-warn summary`), '1 warning');
});

test('the page: an organization\'s repository keeps its readable skills when one file fails', async (t) => {
  const held = `https://raw.githubusercontent.com/acme/tools/${COMMIT}/.github/skills/review/SKILL.md`;
  const server = await holding([held], { [held]: { status: 500, body: 'oops' } });
  t.after(server.close);
  const p = await page('', server.address);
  (p.$('#scan-url') as HTMLInputElement).value = 'github.com/acme';
  (p.$('#scan-form') as HTMLFormElement).requestSubmit();
  const tools = '[data-organization="acme"] [data-repository="acme/tools"]';
  await until(() => p.all(`${tools} .card`).length === 3 && p.texts('[data-organization="acme"] .repository .repository-name').length === 2);
  assert.equal(p.$(tools)?.getAttribute('aria-busy'), 'true');
  assert.equal(p.$('[data-organization="acme"] [data-repository="acme/other"]')?.getAttribute('aria-busy'), null);
  assert.equal(p.text('[data-organization="acme"] .organization-head .badge'), '4 skills in 2 of 4 repositories');

  server.release(held);
  await until(() => !p.$('[aria-busy]'));
  assert.equal(p.text('#scan-error'), '');
  assert.deepEqual(p.texts('[data-organization="acme"] .repository .repository-name'), ['acme/other', 'acme/tools']);
  assert.equal(p.text('[data-organization="acme"] .organization-head .badge'), '4 skills in 2 of 4 repositories');
  assert.equal(
    p.text(`${tools} .alert-error`),
    `Scan incomplete: GitHub answered 500 for ${held}. These are the skills read before it; scan again for the rest.`,
  );
});

test('the page: an entry removed while it is being scanned is gone, its scan with it', async (t) => {
  const held = 'https://api.github.com/repos/acme/other/commits/trunk';
  const server = await holding([held]);
  t.after(server.close);
  const p = await page('', server.address);
  await p.scan('github.com/acme/tools');
  const signals: AbortSignal[] = [];
  const pageFetch = p.window.fetch;
  p.window.fetch = ((url: string, init?: RequestInit) => (init?.signal && signals.push(init.signal), pageFetch(url, init))) as typeof fetch;
  (p.$('#scan-url') as HTMLInputElement).value = 'github.com/acme';
  (p.$('#scan-form') as HTMLFormElement).requestSubmit();
  await until(() => p.$('[data-organization="acme"] [data-repository="acme/tools"]') !== null);
  assert.equal(signals.length, 1);
  assert.equal(signals[0].aborted, false);
  (p.$('[data-organization="acme"] .organization-head .button-ghost') as HTMLButtonElement).click();
  assert.equal(signals[0].aborted, true);
  assert.deepEqual(p.texts('.organization-name'), []);
  assert.deepEqual(p.params(), ['https://github.com/acme/tools']);
  await new Promise((resolve) => setTimeout(resolve, 100)); // for the server to hear the page went away
  server.release(held);
  await new Promise((resolve) => setTimeout(resolve, 100));
  // The server stopped the scan too: acme/other, held back when it was removed, is not listed.
  assert.ok(server.fetched.includes(held));
  assert.ok(!server.fetched.includes(`https://api.github.com/repos/acme/other/git/trees/${OTHER}?recursive=1`));
  assert.deepEqual(p.texts('.organization-name'), []);
  assert.deepEqual(p.texts('.repository-name'), ['acme/tools']);
  assert.deepEqual(p.params(), ['https://github.com/acme/tools']);
  assert.equal(p.$('#scan-error')?.hidden, true);
});

test('the page: open warnings stay open, and a focused card keeps the focus, as a scan draws the catalog again', async (t) => {
  const held = 'https://api.github.com/repos/acme/other/commits/trunk';
  const server = await holding([held]);
  t.after(server.close);
  const p = await page('', server.address);
  await p.scan('github.com/acme/tools');
  const details = p.$('[data-repository="acme/tools"] .alert-warn') as HTMLDetailsElement;
  details.open = true;
  details.dispatchEvent(new p.window.Event('toggle'));
  const card = '[data-repository="acme/tools"] [data-skill="acme/tools:skills/deploy/SKILL.md"]';
  p.$(card)?.focus();
  (p.$('#scan-url') as HTMLInputElement).value = 'github.com/acme';
  (p.$('#scan-form') as HTMLFormElement).requestSubmit();
  await until(() => p.$('[data-organization="acme"] [data-repository="acme/tools"]') !== null);
  assert.notEqual(p.$('[data-repository="acme/tools"] .alert-warn'), details); // drawn again
  assert.equal((p.$('#repositories > [data-repository="acme/tools"] .alert-warn') as HTMLDetailsElement).open, true);
  assert.equal(p.window.document.activeElement, p.$(`#repositories > ${card}`));
  server.release(held);
  await until(() => !p.$('[aria-busy]'));
  assert.equal((p.$('#repositories > [data-repository="acme/tools"] .alert-warn') as HTMLDetailsElement).open, true);
});

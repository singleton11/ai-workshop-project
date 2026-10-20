// spec/analysis.md, "An error partway does not lose what was read", and its CLI output, spec/cli.md:
// GitHub fails in the middle of a scan, after the repository and its commit are known.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Fetch } from '../src/core/github.ts';
import { openGitHub } from '../src/core/github.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { DEFAULT_RULES, parseRules } from '../src/core/rules.ts';
import { scan } from '../src/core/scan.ts';
import { atlas } from './helpers.ts';

const COMMIT = '4444444444444444444444444444444444444444';
const API = 'https://api.github.com/repos/acme/flaky';
const RAW = `https://raw.githubusercontent.com/acme/flaky/${COMMIT}`;
const SEARCH = 'https://api.github.com/search/code?q=filename:SKILL.md+repo:acme/flaky&per_page=100';
const LIMITED = { status: 403, body: { message: 'API rate limit exceeded for user ID 1.' } };

const skill = (name: string, description: string) => ({ status: 200, body: `---\nname: ${name}\ndescription: ${description}\n---\n` });
const file = (path: string) => ({ path, mode: '100644', type: 'blob', sha: path });
const folder = (path: string, sha: string) => ({ path, mode: '040000', type: 'tree', sha });
const tree = (entries: unknown[], truncated = false) => ({ status: 200, body: { truncated, tree: entries } });

/** acme/flaky at COMMIT: the repository and its commit answer; everything after that is up to each test. */
const OPEN: Recording = {
  [API]: { status: 200, body: { full_name: 'acme/flaky', default_branch: 'main' } },
  [`${API}/commits/main`]: { status: 200, body: { sha: COMMIT } },
};

/** 150 search results over two pages: the first lists `alpha` and 99 files that are not skills. */
const PAGE_1 = {
  status: 200,
  body: {
    total_count: 150,
    items: [{ path: '.claude/skills/alpha/SKILL.md' }, ...Array.from({ length: 99 }, (_, i) => ({ path: `docs/${i}/SKILL.md` }))],
  },
};

/** Every URL the scan asked for, answered from the recording. */
function recorded(recording: Recording): { fetch: Fetch; asked: string[] } {
  const asked: string[] = [];
  const answer = replay(recording);
  return { asked, fetch: (url, init) => (asked.push(url), answer(url, init)) };
}

test('code search fails on page 2: the skills from page 1, then "scan incomplete", exit code 1; no links looked for', async () => {
  const recording = {
    ...OPEN,
    [`${SEARCH}&page=1`]: PAGE_1,
    [`${SEARCH}&page=2`]: LIMITED,
    [`${RAW}/.claude/skills/alpha/SKILL.md`]: skill('alpha', 'The first skill. More.'),
  };
  const result = await atlas(['scan', 'https://github.com/acme/flaky'], { recording });
  assert.equal(result.code, 1);
  assert.equal(result.stdout, [
    'acme/flaky · 1 skill',
    'alpha — The first skill.',
    `  https://github.com/acme/flaky/blob/${COMMIT}/.claude/skills/alpha/SKILL.md`,
  ].join('\n'));
  const warnings = result.stderr.split('\n');
  assert.equal(warnings.at(-1), 'scan incomplete: GitHub rate limit reached; try again in a minute');
  assert.ok(warnings.slice(0, -1).every((line) => line.startsWith('warning: docs/')), result.stderr);

  // After a failed search, no folder is listed for links: they could point at what it did not reach.
  const { fetch, asked } = recorded(recording);
  const scanned = await scan(await openGitHub('https://github.com/acme/flaky', { fetch, token: 'test' }), parseRules(DEFAULT_RULES, ''));
  assert.deepEqual(scanned.skills.map((skill) => skill.name), ['alpha']);
  assert.equal(scanned.error, 'GitHub rate limit reached; try again in a minute');
  assert.ok(!asked.some((url) => url.includes('/git/trees/')), asked.join('\n'));
});

test('a SKILL.md that cannot be read: left out, not "not found"; the others are listed; --filter too', async () => {
  const recording = {
    ...OPEN,
    [`${API}/git/trees/${COMMIT}?recursive=1`]: tree([
      file('.claude/skills/alpha/SKILL.md'),
      file('.claude/skills/beta/SKILL.md'),
      file('.claude/skills/gamma/SKILL.md'),
      file('.claude/skills/gone/SKILL.md'),
    ]),
    [`${RAW}/.claude/skills/alpha/SKILL.md`]: skill('alpha', 'The first skill.'),
    [`${RAW}/.claude/skills/beta/SKILL.md`]: { status: 500, body: 'oops' },
    [`${RAW}/.claude/skills/gamma/SKILL.md`]: skill('gamma', 'The third skill.'),
    [`${RAW}/.claude/skills/gone/SKILL.md`]: { status: 404, body: 'Not Found' },
  };
  const result = await atlas(['scan', 'github.com/acme/flaky'], { recording, token: undefined });
  assert.equal(result.code, 1);
  assert.deepEqual(result.stdout.split('\n').filter((line) => !line.startsWith(' ')), [
    'acme/flaky · 2 skills',
    'alpha — The first skill.',
    'gamma — The third skill.',
  ]);
  assert.equal(result.stderr, [
    'warning: .claude/skills/gone/SKILL.md: listed, but not found at the scanned commit; skipped',
    `scan incomplete: GitHub answered 500 for ${RAW}/.claude/skills/beta/SKILL.md`,
  ].join('\n'));

  const filtered = await atlas(['scan', '--filter', 'third', 'github.com/acme/flaky'], { recording, token: undefined });
  assert.equal(filtered.code, 1);
  assert.equal(filtered.stdout.split('\n')[0], 'acme/flaky · 1 of 2 skills');
  assert.match(filtered.stderr, /\nscan incomplete: GitHub answered 500 for .*beta\/SKILL\.md$/);
});

test('a symbolic link that cannot be read: left out, without a warning; the first error in path order', async () => {
  const recording = {
    ...OPEN,
    [`${API}/git/trees/${COMMIT}?recursive=1`]: tree([
      file('.claude/skills/alpha/SKILL.md'),
      { path: '.agents/skills/alpha', mode: '120000', type: 'blob', sha: 'link' },
      file('.github/skills/beta/SKILL.md'),
    ]),
    [`${RAW}/.agents/skills/alpha`]: { status: 502, body: 'Bad Gateway' },
    [`${RAW}/.claude/skills/alpha/SKILL.md`]: skill('alpha', 'The first skill.'),
    [`${RAW}/.github/skills/beta/SKILL.md`]: { status: 503, body: 'Unavailable' },
  };
  const result = await atlas(['scan', 'github.com/acme/flaky'], { recording, token: undefined });
  assert.equal(result.code, 1);
  assert.equal(result.stdout, ['acme/flaky · 1 skill', 'alpha — The first skill.', `  https://github.com/acme/flaky/blob/${COMMIT}/.claude/skills/alpha/SKILL.md`].join('\n'));
  // The link's error comes before the file's.
  assert.equal(result.stderr, `scan incomplete: GitHub answered 502 for ${RAW}/.agents/skills/alpha`);
});

test('a tree too large, and a skill folder that fails: the other folders are listed', async () => {
  const recording = {
    ...OPEN,
    [`${API}/git/trees/${COMMIT}?recursive=1`]: tree([], true),
    [`${API}/git/trees/${COMMIT}`]: tree([folder('.claude', 'claude'), folder('.github', 'github')]),
    [`${API}/git/trees/claude`]: tree([folder('skills', 'claude-skills')]),
    [`${API}/git/trees/claude-skills?recursive=1`]: tree([file('alpha/SKILL.md')]),
    [`${API}/git/trees/github`]: LIMITED,
    [`${RAW}/.claude/skills/alpha/SKILL.md`]: skill('alpha', 'The first skill.'),
  };
  const result = await atlas(['scan', 'github.com/acme/flaky'], { recording, token: undefined });
  assert.equal(result.code, 1);
  assert.equal(result.stdout.split('\n')[0], 'acme/flaky · 1 skill');
  assert.equal(result.stderr, [
    'warning: the tree is too large to list at once; looked only in .agents/skills, .claude/skills, .github/skills, agent/skills (GITHUB_TOKEN searches everywhere)',
    'scan incomplete: GitHub rate limit reached; set GITHUB_TOKEN',
  ].join('\n'));
});

test('the tree itself fails: 0 skills, then the error; before the commit is known, the error alone', async () => {
  const recording = { ...OPEN, [`${API}/git/trees/${COMMIT}?recursive=1`]: LIMITED };
  const result = await atlas(['scan', 'github.com/acme/flaky'], { recording, token: undefined });
  assert.equal(result.code, 1);
  assert.equal(result.stdout, 'acme/flaky · 0 skills');
  assert.equal(result.stderr, 'scan incomplete: GitHub rate limit reached; set GITHUB_TOKEN');

  const early = await atlas(['scan', 'github.com/acme/flaky'], { recording: { [API]: LIMITED }, token: undefined });
  assert.equal(early.code, 1);
  assert.equal(early.stdout, '');
  assert.equal(early.stderr, 'GitHub rate limit reached; set GITHUB_TOKEN');
});

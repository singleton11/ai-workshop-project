// spec/analysis.md, "An organization", and its output in spec/cli.md: every repository of an
// organization or a user, with GitHub answering from the recordings below.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBrowserBackend } from '../src/browser.ts';
import { openGitHub, parseGitHubOwnerUrl, parseGitHubUrl } from '../src/core/github.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { atlas, history, noHistory } from './helpers.ts';

const TOOLS = '1111111111111111111111111111111111111111';
const OTHER = '3333333333333333333333333333333333333333';
const PLAIN = '4444444444444444444444444444444444444444';

const API = 'https://api.github.com';

/** A tree answer: these files, all regular. */
function tree(paths: string[]) {
  return { status: 200, body: { truncated: false, tree: paths.map((path) => ({ path, mode: '100644', type: 'blob', sha: path })) } };
}

const raw = (repo: string, commit: string, path: string, body: string) => ({
  [`https://raw.githubusercontent.com/${repo}/${commit}/${path}`]: { status: 200, body },
});

/** What the repository list says about one repository. */
const listed = (name: string, extra: { fork?: boolean; archived?: boolean } = {}) => ({
  full_name: `acme/${name}`,
  default_branch: 'main',
  fork: false,
  archived: false,
  ...extra,
});

/**
 * acme, an organization: tools (two skills, one in test data), Other (one skill), plain (only test
 * data), empty (no commit), gone (went away), and a fork and an archived one that are never opened.
 */
const ACME: Recording = {
  [`${API}/users/acme`]: { status: 200, body: { login: 'acme', type: 'Organization' } },
  [`${API}/orgs/acme/repos?type=all&per_page=100&page=1`]: {
    status: 200,
    body: [listed('tools'), listed('fork', { fork: true }), listed('plain'), listed('Other'), listed('old', { archived: true }), listed('empty'), listed('gone')],
  },
  [`${API}/repos/acme/tools/commits/main`]: { status: 200, body: { sha: TOOLS } },
  [`${API}/repos/acme/tools/git/trees/${TOOLS}?recursive=1`]: tree(['.claude/skills/review/SKILL.md', 'skills/deploy/SKILL.md', 'tests/skills/x/SKILL.md']),
  ...raw('acme/tools', TOOLS, '.claude/skills/review/SKILL.md', '---\nname: review\ndescription: Review pull requests. Before every merge.\n---\n'),
  ...raw('acme/tools', TOOLS, 'skills/deploy/SKILL.md', '---\nname: deploy\ndescription: Ship to production.\n---\n'),
  [`${API}/repos/acme/Other/commits/main`]: { status: 200, body: { sha: OTHER } },
  [`${API}/repos/acme/Other/git/trees/${OTHER}?recursive=1`]: tree(['.claude/skills/triage/SKILL.md']),
  ...raw('acme/Other', OTHER, '.claude/skills/triage/SKILL.md', '---\nname: triage\ndescription: Sort new issues.\n---\n'),
  [`${API}/repos/acme/plain/commits/main`]: { status: 200, body: { sha: PLAIN } },
  [`${API}/repos/acme/plain/git/trees/${PLAIN}?recursive=1`]: tree(['fixture/skills/x/SKILL.md', 'README.md']),
  [`${API}/repos/acme/empty/commits/main`]: { status: 409, body: { message: 'Git Repository is empty.' } },
  [`${API}/repos/acme/gone/commits/main`]: { status: 404, body: { message: 'Not Found' } },
};

/** With a token: one code search for the organization, and the folders a symbolic link can be in. */
const ACME_SEARCH: Recording = {
  [`${API}/search/code?q=filename:SKILL.md+org:acme&per_page=100&page=1`]: {
    status: 200,
    body: {
      total_count: 3,
      incomplete_results: false,
      items: [
        { path: '.claude/skills/review/SKILL.md', repository: { full_name: 'acme/tools' } },
        { path: '.claude/skills/triage/SKILL.md', repository: { full_name: 'acme/Other' } },
        { path: '.claude/skills/copy/SKILL.md', repository: { full_name: 'acme/fork' } },
      ],
    },
  },
  ...skillFolder('acme/tools', TOOLS, 'review'),
  ...skillFolder('acme/Other', OTHER, 'triage'),
};

/** The trees down to `.claude/skills`, with one skill in it. */
function skillFolder(repo: string, commit: string, skill: string): Recording {
  return {
    [`${API}/repos/${repo}/git/trees/${commit}`]: { status: 200, body: { truncated: false, tree: [{ path: '.claude', mode: '040000', type: 'tree', sha: `${repo}-claude` }] } },
    [`${API}/repos/${repo}/git/trees/${repo}-claude`]: { status: 200, body: { truncated: false, tree: [{ path: 'skills', mode: '040000', type: 'tree', sha: `${repo}-skills` }] } },
    [`${API}/repos/${repo}/git/trees/${repo}-skills?recursive=1`]: tree([`${skill}/SKILL.md`]),
  };
}

const ACME_OUTPUT = [
  'acme · 3 skills in 2 of 5 repositories',
  '',
  'acme/Other · 1 skill',
  'triage — Sort new issues.',
  `  https://github.com/acme/Other/blob/${OTHER}/.claude/skills/triage/SKILL.md`,
  '',
  'acme/tools · 2 skills',
  'deploy — Ship to production.',
  `  https://github.com/acme/tools/blob/${TOOLS}/skills/deploy/SKILL.md`,
  'review — Review pull requests.',
  `  https://github.com/acme/tools/blob/${TOOLS}/.claude/skills/review/SKILL.md`,
].join('\n');

test('https://github.com/<owner> is an organization; …/<owner>/<repo> is still a repository', () => {
  for (const url of ['https://github.com/acme', 'github.com/acme/', 'http://www.github.com/acme', ' github.com/acme ']) {
    assert.deepEqual(parseGitHubOwnerUrl(url), { owner: 'acme' }, url);
    assert.equal(parseGitHubUrl(url), undefined, url);
  }
  for (const url of ['github.com/acme/tools', 'github.com/acme/tools/tree/v1', 'gitlab.com/acme', 'github.com/']) {
    assert.equal(parseGitHubOwnerUrl(url), undefined, url);
  }
});

test('an organization, without a token: each repository through its tree, the ones with skills printed, sorted by name', async () => {
  const result = await atlas(['scan', 'https://github.com/acme'], { recording: ACME, token: undefined });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, ACME_OUTPUT);
  assert.equal(
    result.stderr,
    [
      'warning: acme/tools: tests/skills/x/SKILL.md: test data (matches "**/tests/**")',
      'warning: acme/gone: Not found in acme/gone: main; skipped',
      'warning: acme/plain: fixture/skills/x/SKILL.md: test data (matches "**/fixture/**")',
    ].join('\n'),
  );
});

test('an organization filter applies to its repository skills without filtering warnings', async () => {
  const result = await atlas(['scan', '--filter', 'REVIEW', 'https://github.com/acme'], { recording: ACME, token: undefined });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(
    result.stdout,
    [
      'acme · 1 skill in 1 of 5 repositories',
      '',
      'acme/tools · 1 of 2 skills',
      'review — Review pull requests.',
      `  https://github.com/acme/tools/blob/${TOOLS}/.claude/skills/review/SKILL.md`,
    ].join('\n'),
  );
  assert.match(result.stderr, /^warning: acme\/tools: tests\/skills\/x\/SKILL\.md: test data/m);
  assert.match(result.stderr, /^warning: acme\/gone: Not found in acme\/gone: main; skipped/m);
});

test('a repository that stops partway: its skills read before it, then "scan incomplete", exit code 1; --filter too', async () => {
  const deploy = `https://raw.githubusercontent.com/acme/tools/${TOOLS}/skills/deploy/SKILL.md`;
  const recording = { ...ACME, [deploy]: { status: 500, body: 'Internal Server Error' } };
  const incomplete = `scan incomplete: acme/tools: GitHub answered 500 for ${deploy}`;

  const result = await atlas(['scan', 'https://github.com/acme'], { recording, token: undefined });
  assert.equal(result.code, 1);
  assert.equal(
    result.stdout,
    [
      'acme · 2 skills in 2 of 5 repositories',
      '',
      'acme/Other · 1 skill',
      'triage — Sort new issues.',
      `  https://github.com/acme/Other/blob/${OTHER}/.claude/skills/triage/SKILL.md`,
      '',
      'acme/tools · 1 skill',
      'review — Review pull requests.',
      `  https://github.com/acme/tools/blob/${TOOLS}/.claude/skills/review/SKILL.md`,
    ].join('\n'),
  );
  assert.match(result.stderr, /^warning: acme\/gone: Not found in acme\/gone: main; skipped$/m);
  assert.ok(result.stderr.split('\n').at(-1)!.startsWith(incomplete), result.stderr);

  // acme/tools has no skill that matches, and its scan is still incomplete.
  const filtered = await atlas(['scan', '--filter', 'triage', 'https://github.com/acme'], { recording, token: undefined });
  assert.equal(filtered.code, 1);
  assert.equal(filtered.stdout.split('\n')[0], 'acme · 1 skill in 1 of 5 repositories');
  assert.doesNotMatch(filtered.stdout, /acme\/tools/);
  assert.ok(filtered.stderr.split('\n').at(-1)!.startsWith(incomplete), filtered.stderr);
});

test('an organization, with a token: one code search, and only the repositories it finds a SKILL.md in are opened', async () => {
  const asked: string[] = [];
  const github = replay({ ...ACME, ...ACME_SEARCH }, noHistory());
  const result = await atlas(['scan', 'github.com/acme'], {
    recording: ACME,
    token: 'test',
    fetch: (url, init) => (asked.push(url), github(url, init)),
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(
    result.stdout,
    [
      'acme · 2 skills in 2 of 5 repositories',
      '',
      'acme/Other · 1 skill',
      'triage — Sort new issues.',
      `  https://github.com/acme/Other/blob/${OTHER}/.claude/skills/triage/SKILL.md`,
      '',
      'acme/tools · 1 skill',
      'review — Review pull requests.',
      `  https://github.com/acme/tools/blob/${TOOLS}/.claude/skills/review/SKILL.md`,
    ].join('\n'),
  );
  assert.equal(result.stderr, '');
  // No request at all for the repositories without a SKILL.md, nor for the fork the search found.
  assert.deepEqual(asked.filter((url) => /acme\/(plain|empty|gone|fork|old)\b/.test(url)), []);
  assert.equal(asked.filter((url) => url.includes('/search/code')).length, 1);
});

test('a code search that cannot list everything → a warning, and every repository through its tree', async () => {
  const capped: Recording = {
    [`${API}/search/code?q=filename:SKILL.md+org:acme&per_page=100&page=1`]: {
      status: 200,
      body: { total_count: 1001, incomplete_results: false, items: [] },
    },
  };
  const result = await atlas(['scan', 'github.com/acme'], { recording: { ...ACME, ...capped }, token: 'test' });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, ACME_OUTPUT);
  assert.match(result.stderr, /^warning: code search found more SKILL\.md files than it can list; every repository was listed through its tree$/m);
});

test('a user: their repositories, every page of them, and `user:` in the code search', async () => {
  const names = Array.from({ length: 100 }, (_, i) => `r${String(i).padStart(3, '0')}`);
  const user: Recording = {
    [`${API}/users/Someone`]: { status: 200, body: { login: 'someone', type: 'User' } },
    [`${API}/users/someone/repos?type=owner&per_page=100&page=1`]: {
      status: 200,
      body: names.map((name) => ({ full_name: `someone/${name}`, default_branch: 'main', fork: false, archived: false })),
    },
    [`${API}/users/someone/repos?type=owner&per_page=100&page=2`]: {
      status: 200,
      body: [{ full_name: 'someone/skills', default_branch: 'main', fork: false, archived: false }],
    },
    ...Object.fromEntries(names.map((name) => [`${API}/repos/someone/${name}/commits/main`, { status: 409, body: { message: 'Git Repository is empty.' } }])),
    [`${API}/repos/someone/skills/commits/main`]: { status: 200, body: { sha: TOOLS } },
    [`${API}/repos/someone/skills/git/trees/${TOOLS}?recursive=1`]: tree(['skills/notes/SKILL.md']),
    ...raw('someone/skills', TOOLS, 'skills/notes/SKILL.md', '---\nname: notes\ndescription: Take notes.\n---\n'),
  };
  const result = await atlas(['scan', 'github.com/Someone'], { recording: user, token: undefined });
  assert.equal(result.code, 0, result.stderr);
  // Empty repositories are skipped without a warning.
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.split('\n')[0], 'someone · 1 skill in 1 of 101 repositories');
  assert.match(result.stdout, /\nsomeone\/skills · 1 skill\nnotes — Take notes\.\n/);

  const searched = await atlas(['scan', 'github.com/Someone'], {
    recording: {
      ...user,
      [`${API}/search/code?q=filename:SKILL.md+user:someone&per_page=100&page=1`]: {
        status: 200,
        body: { total_count: 1, incomplete_results: false, items: [{ path: 'skills/notes/SKILL.md', repository: { full_name: 'someone/skills' } }] },
      },
      [`${API}/repos/someone/skills/git/trees/${TOOLS}`]: tree([]),
      [`${API}/repos/someone/skills/git/trees/${TOOLS}?recursive=1`]: { status: 500, body: { message: 'the tree is not used with a token' } },
    },
    token: 'test',
  });
  assert.equal(searched.code, 0, searched.stderr);
  assert.equal(searched.stdout.split('\n')[0], 'someone · 1 skill in 1 of 101 repositories');
});

test('no repository with skills: the totals only', async () => {
  const bare: Recording = {
    [`${API}/users/bare`]: { status: 200, body: { login: 'bare', type: 'Organization' } },
    [`${API}/orgs/bare/repos?type=all&per_page=100&page=1`]: { status: 200, body: [] },
  };
  const result = await atlas(['scan', 'github.com/bare'], { recording: bare, token: undefined });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, 'bare · 0 skills in 0 of 0 repositories');
});

test('an unknown owner → a clear message, exit code 1', async () => {
  const result = await atlas(['scan', 'https://github.com/nobody'], {
    recording: { [`${API}/users/nobody`]: { status: 404, body: { message: 'Not Found' } } },
  });
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'Organization or user not found: https://github.com/nobody');
});

test('the rate limit stops the whole scan: a clear message, exit code 1, nothing printed', async () => {
  const limited: Recording = {
    ...ACME,
    [`${API}/repos/acme/Other/git/trees/${OTHER}?recursive=1`]: { status: 403, body: { message: 'API rate limit exceeded for 192.0.2.1.' } },
  };
  const result = await atlas(['scan', 'github.com/acme'], { recording: limited, token: undefined });
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'GitHub rate limit reached; set GITHUB_TOKEN');
});

test('the rate limit on a skill\'s date stops the whole scan too; dates of the others are printed as for one repository', async () => {
  const dates = `${API}/repos/acme/tools/commits?sha=${TOOLS}&path=skills/deploy/SKILL.md&per_page=1`;
  const dated = await atlas(['scan', 'github.com/acme'], {
    recording: { ...ACME, ...history('acme/Other', OTHER, '.claude/skills/triage/SKILL.md', '2026-04-05T06:07:08Z') },
    token: undefined,
  });
  assert.equal(dated.code, 0, dated.stderr);
  assert.match(dated.stdout, new RegExp(`\\ntriage — Sort new issues\\.\\n {2}updated 2026-04-05 · https://github\\.com/acme/Other/blob/${OTHER}/`));
  const limited = await atlas(['scan', 'github.com/acme'], {
    recording: { ...ACME, [dates]: { status: 403, body: { message: 'API rate limit exceeded for 192.0.2.1.' } } },
    token: undefined,
  });
  assert.equal(limited.code, 1);
  assert.equal(limited.stdout, '');
  assert.equal(limited.stderr, 'GitHub rate limit reached; set GITHUB_TOKEN');
});

test('at most 8 repositories at the same time', async () => {
  const names = Array.from({ length: 30 }, (_, i) => `r${i}`);
  const many = replay({
    [`${API}/users/many`]: { status: 200, body: { login: 'many', type: 'Organization' } },
    [`${API}/orgs/many/repos?type=all&per_page=100&page=1`]: {
      status: 200,
      body: names.map((name) => ({ full_name: `many/${name}`, default_branch: 'main', fork: false, archived: false })),
    },
    ...Object.fromEntries(names.map((name) => [`${API}/repos/many/${name}/commits/main`, { status: 409, body: { message: 'Git Repository is empty.' } }])),
  });
  let open = 0;
  let most = 0;
  const result = await atlas(['scan', 'github.com/many'], {
    token: undefined,
    fetch: async (url, init) => {
      if (!url.includes('/commits/')) return many(url, init);
      most = Math.max(most, ++open);
      await new Promise((resolve) => setTimeout(resolve, 5));
      open--;
      return many(url, init);
    },
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, 'many · 0 skills in 0 of 30 repositories');
  assert.equal(most, 8);
});

test('an empty repository on its own → a clear message, exit code 1', async () => {
  const empty = replay({
    [`${API}/repos/acme/empty`]: { status: 200, body: { full_name: 'acme/empty', default_branch: 'main' } },
    [`${API}/repos/acme/empty/commits/main`]: { status: 409, body: { message: 'Git Repository is empty.' } },
  });
  await assert.rejects(openGitHub('github.com/acme/empty', { fetch: empty }), { message: 'Repository is empty: https://github.com/acme/empty' });
});

test('the browser terminal scans an organization too', async () => {
  const browser = createBrowserBackend({ fetch: replay(ACME, noHistory()) });
  const output = await browser.run('$ skill-atlas scan https://github.com/acme');
  assert.ok(output.startsWith(`${ACME_OUTPUT}\n`), output);
  assert.match(output, /^warning: acme\/gone: Not found in acme\/gone: main; skipped$/m);
});

test('help says an organization can be scanned', async () => {
  assert.match((await atlas(['help'])).stdout, /scan \[--rules <file>\] \[--filter <text>\] \[--cluster\] <GitHub URL \| directory>\s+find every skill in a repository or organization/);
});

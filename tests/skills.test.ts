// spec/analysis.md, "What is a skill" and "Duplicates": each case on a repository made for it, in a
// temporary folder, so symbolic links and CRLF survive any checkout.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test, type TestContext } from 'node:test';
import { atlas, EXAMPLE_COMMIT, FIXTURE } from './helpers.ts';

const ROOT = join(FIXTURE, '..');

/** A skill's SKILL.md, with or without a name. */
function skill(description: string, name?: string): string {
  return `---\n${name ? `name: ${name}\n` : ''}description: ${description}\n---\n# Body\n`;
}

type Files = Record<string, string | { link: string }>;

/** A repository called `repo`, with these files and symbolic links. */
function repository(t: TestContext, files: Files): string {
  const parent = mkdtempSync(join(tmpdir(), 'skill-atlas-repo-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'repo');
  mkdirSync(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    if (typeof content === 'string') writeFileSync(join(root, path), content);
    else symlinkSync(content.link, join(root, path));
  }
  return root;
}

/** What `scan` prints for a repository: stdout lines, with the file:// root as `<root>`. */
async function scanned(root: string, args: string[] = []) {
  const result = await atlas(['scan', ...args, root]);
  return { ...result, stdout: result.stdout.replaceAll(pathToFileURL(root).href, '<root>') };
}

test('a skill: the root SKILL.md, and any SKILL.md, in any letter case, under a skills folder at any depth', async (t) => {
  const root = repository(t, {
    'SKILL.md': skill('The repository itself.', 'whole-repo'),
    '.claude/skills/claude/SKILL.md': skill('Claude.'),
    '.cursor/skills/cursor/SKILL.md': skill('Cursor.'),
    'agent/skills/agent/SKILL.md': skill('Agent.'),
    'skills/collection/SKILL.md': skill('A collection.'),
    'libs/foo/.junie/skills/junie/SKILL.md': skill('Junie, in a subproject.'),
    '.claude/skills/a/SKILL.md': skill('A.'),
    '.claude/skills/a/examples/b/SKILL.md': skill('A skill inside a skill.'),
    '.windsurf/skills/lower/skill.md': skill('Lower case.'),
    '.claude/skills/claude/README.md': '# not a SKILL.md',
  });
  const result = await scanned(root);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(
    result.stdout,
    [
      'repo · 9 skills',
      'a — A.',
      '  <root>/.claude/skills/a/SKILL.md',
      'agent — Agent.',
      '  <root>/agent/skills/agent/SKILL.md',
      'b — A skill inside a skill.',
      '  <root>/.claude/skills/a/examples/b/SKILL.md',
      'claude — Claude.',
      '  <root>/.claude/skills/claude/SKILL.md',
      'collection — A collection.',
      '  <root>/skills/collection/SKILL.md',
      'cursor — Cursor.',
      '  <root>/.cursor/skills/cursor/SKILL.md',
      'junie — Junie, in a subproject.',
      '  <root>/libs/foo/.junie/skills/junie/SKILL.md',
      'lower — Lower case.',
      '  <root>/.windsurf/skills/lower/skill.md',
      'whole-repo — The repository itself.',
      '  <root>/SKILL.md',
    ].join('\n'),
  );
});

test('a root SKILL.md without a name in its front matter is named after the repository', async (t) => {
  const result = await scanned(repository(t, { 'SKILL.md': skill('No name.') }));
  assert.equal(result.stdout, ['repo · 1 skill', 'repo — No name.', '  <root>/SKILL.md'].join('\n'));
});

test('not a skill, and test data: not listed, each with a warning that names why', async (t) => {
  const root = repository(t, {
    'plugins/foo/resources/agent/SKILL.md': skill('Shipped in a product.'),
    'src/test/.claude/skills/t/SKILL.md': skill('Test data.'),
    'testData/skills/t/SKILL.md': skill('IntelliJ test data.'),
    'web/__tests__/skills/t/SKILL.md': skill('Jest test data.'),
    'third_party/x/.claude/skills/t/SKILL.md': skill('Vendored.'),
  });
  const result = await scanned(root);
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'repo · 0 skills');
  assert.equal(
    result.stderr,
    [
      'warning: plugins/foo/resources/agent/SKILL.md: not a skill (matches no skills pattern)',
      'warning: src/test/.claude/skills/t/SKILL.md: test data (matches "**/test/**")',
      'warning: testData/skills/t/SKILL.md: test data (matches "**/testdata/**")',
      'warning: third_party/x/.claude/skills/t/SKILL.md: test data (matches "**/third_party/**")',
      'warning: web/__tests__/skills/t/SKILL.md: test data (matches "**/__tests__/**")',
    ].join('\n'),
  );
});

test('scanning skill-atlas itself finds 0 skills, and warns about the fixture as test data', async () => {
  const result = await atlas(['scan', ROOT]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^\S+ · 0 skills$/);
  assert.equal(
    result.stderr,
    [
      'warning: fixture/.agents/skills/release-checklist/SKILL.md: test data (matches "**/fixture/**")',
      'warning: fixture/.claude/skills/commits/SKILL.md: test data (matches "**/fixture/**")',
      'warning: fixture/.github/skills/code-style/SKILL.md: test data (matches "**/fixture/**")',
    ].join('\n'),
  );
});

test('identical copies, CRLF and a BOM aside, are one skill: linked at the shortest path, the rest "also in"', async (t) => {
  const text = skill('Write commits.', 'commits');
  const root = repository(t, {
    '.claude/skills/commits/SKILL.md': text,
    '.agents/skills/commits/SKILL.md': `\uFEFF${text.replaceAll('\n', '\r\n')}`,
    'libs/foo/.github/skills/commits/SKILL.md': text,
  });
  const result = await scanned(root);
  assert.equal(result.stderr, '');
  assert.equal(
    result.stdout,
    [
      'repo · 1 skill',
      'commits — Write commits.',
      '  <root>/.agents/skills/commits/SKILL.md',
      '  also in .claude/skills/commits/SKILL.md, libs/foo/.github/skills/commits/SKILL.md',
    ].join('\n'),
  );
});

test('identical copies of the same length: the main path is the one that sorts first', async (t) => {
  const text = skill('Same.', 'same');
  const root = repository(t, { '.bbbbbb/skills/same/SKILL.md': text, '.aaaaaa/skills/same/SKILL.md': text });
  const result = await scanned(root);
  assert.match(result.stdout, /\n {2}<root>\/\.aaaaaa\/skills\/same\/SKILL\.md\n {2}also in \.bbbbbb\/skills\/same\/SKILL\.md$/);
});

test('a copy in test data is not a copy: it is skipped, with its warning', async (t) => {
  const text = skill('Write commits.', 'commits');
  const root = repository(t, { '.claude/skills/commits/SKILL.md': text, 'tests/.claude/skills/commits/SKILL.md': text });
  const result = await scanned(root);
  assert.equal(result.stdout, ['repo · 1 skill', 'commits — Write commits.', '  <root>/.claude/skills/commits/SKILL.md'].join('\n'));
  assert.equal(result.stderr, 'warning: tests/.claude/skills/commits/SKILL.md: test data (matches "**/tests/**")');
});

test('identical copies without a name are named after the main path’s folder', async (t) => {
  const text = skill('No name.');
  const root = repository(t, { '.claude/skills/commit/SKILL.md': text, '.agents/skills/commits/SKILL.md': text });
  const result = await scanned(root);
  assert.match(result.stdout, /^repo · 1 skill\ncommit — No name\.\n {2}<root>\/\.claude\/skills\/commit\/SKILL\.md\n/);
});

test('malformed front matter in identical copies: one warning, for the main path', async (t) => {
  const text = '---\nname: [broken\n---\n';
  const root = repository(t, { '.claude/skills/broken/SKILL.md': text, '.agents/skills/broken/SKILL.md': text });
  const result = await scanned(root);
  assert.match(result.stderr, /^warning: \.agents\/skills\/broken\/SKILL\.md: malformed front matter: [^\n]*$/);
});

test('the same name, different content: each listed, one warning that counts groups, not files', async (t) => {
  const root = repository(t, {
    '.claude/skills/commits/SKILL.md': skill('One way.', 'commits'),
    '.agents/skills/commits/SKILL.md': skill('One way.', 'commits'),
    '.github/skills/commits/SKILL.md': skill('Another way.', 'commits'),
  });
  const result = await scanned(root);
  assert.equal(
    result.stdout,
    [
      'repo · 2 skills',
      'commits — One way.',
      '  <root>/.agents/skills/commits/SKILL.md',
      '  also in .claude/skills/commits/SKILL.md',
      'commits — Another way.',
      '  <root>/.github/skills/commits/SKILL.md',
    ].join('\n'),
  );
  assert.equal(
    result.stderr,
    'warning: commits: 2 different skills share this name: .agents/skills/commits/SKILL.md, .github/skills/commits/SKILL.md',
  );
});

test('a symbolic link to a skills folder: its skills are copies, never listed twice; the shortest path wins, a link too', async (t) => {
  const root = repository(t, {
    '.agents/skills/commits/SKILL.md': skill('Write commits.', 'commits'),
    '.claude/skills': { link: '../.agents/skills' },
    '.junie/skills/commits': { link: '../../.agents/skills/commits' },
  });
  const result = await scanned(root);
  assert.equal(result.stderr, '');
  assert.equal(
    result.stdout,
    [
      'repo · 1 skill',
      'commits — Write commits.',
      '  <root>/.junie/skills/commits/SKILL.md',
      '  also in .agents/skills/commits/SKILL.md, .claude/skills/commits/SKILL.md',
    ].join('\n'),
  );
});

test('a link the rules accept to a target they do not: listed at the link, no warning for the target', async (t) => {
  const root = repository(t, {
    'plugins/foo/agent/SKILL.md': skill('Shipped, and exposed to agents.', 'foo'),
    '.claude/skills/foo': { link: '../../plugins/foo/agent' },
    'docs/foo': { link: '../plugins/foo/agent' }, // a link the rules reject: ignored, silently
  });
  const result = await scanned(root);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, ['repo · 1 skill', 'foo — Shipped, and exposed to agents.', '  <root>/.claude/skills/foo/SKILL.md'].join('\n'));
});

test('a link outside the repository, at nothing, or in a loop: a warning, skipped', async (t) => {
  const root = repository(t, {
    '.claude/skills/outside': { link: '../../../elsewhere' },
    '.claude/skills/nothing': { link: '../../.agents/skills/missing' },
    '.claude/skills/loop-a': { link: 'loop-b' },
    '.claude/skills/loop-b': { link: 'loop-a' },
    'docs/nothing': { link: 'missing' }, // where no skill could be: silent
  });
  const result = await scanned(root);
  assert.equal(result.stdout, 'repo · 0 skills');
  assert.equal(
    result.stderr,
    [
      'warning: .claude/skills/loop-a: symbolic link is a loop; skipped',
      'warning: .claude/skills/loop-b: symbolic link is a loop; skipped',
      'warning: .claude/skills/nothing: symbolic link points at nothing; skipped',
      'warning: .claude/skills/outside: symbolic link points outside the repository; skipped',
    ].join('\n'),
  );
});

// On GitHub, SKILL.md and skill.md can sit in the same folder; most local disks cannot hold both.
const RAW = `https://raw.githubusercontent.com/JetBrains/example/${EXAMPLE_COMMIT}`;
const COMMITS = skill('Write commits.', 'commits');

test('GitHub: SKILL.md and skill.md in one folder, and a symbolic link, follow the same rules', async () => {
  const tree = [
    { path: '.claude/skills/commits/SKILL.md', mode: '100644', type: 'blob', sha: 'a' },
    { path: '.claude/skills/commits/skill.md', mode: '100644', type: 'blob', sha: 'a' },
    { path: '.agents/skills', mode: '120000', type: 'blob', sha: 'b' },
  ];
  const trees = (tree: object[]) => ({ status: 200, body: { truncated: false, tree } });
  const recording = {
    // Without a token: the whole tree.
    [`https://api.github.com/repos/JetBrains/example/git/trees/${EXAMPLE_COMMIT}?recursive=1`]: trees(tree),
    // With a token: the folders a skill can be in; `.agents/skills` is the link itself.
    [`https://api.github.com/repos/JetBrains/example/git/trees/${EXAMPLE_COMMIT}`]: trees([
      { path: '.agents', mode: '040000', type: 'tree', sha: 'agents' },
      { path: '.claude', mode: '040000', type: 'tree', sha: 'claude' },
    ]),
    'https://api.github.com/repos/JetBrains/example/git/trees/agents': trees([{ path: 'skills', mode: '120000', type: 'blob', sha: 'b' }]),
    'https://api.github.com/repos/JetBrains/example/git/trees/claude': trees([{ path: 'skills', mode: '040000', type: 'tree', sha: 'claude-skills' }]),
    'https://api.github.com/repos/JetBrains/example/git/trees/claude-skills?recursive=1': trees([
      { path: 'commits/SKILL.md', mode: '100644', type: 'blob', sha: 'a' },
      { path: 'commits/skill.md', mode: '100644', type: 'blob', sha: 'a' },
    ]),
    'https://api.github.com/search/code?q=filename:SKILL.md+repo:JetBrains/example&per_page=100&page=1': {
      status: 200,
      body: { total_count: 2, items: [{ path: '.claude/skills/commits/SKILL.md' }, { path: '.claude/skills/commits/skill.md' }] },
    },
    [`${RAW}/.claude/skills/commits/SKILL.md`]: { status: 200, body: COMMITS },
    [`${RAW}/.claude/skills/commits/skill.md`]: { status: 200, body: COMMITS },
    [`${RAW}/.agents/skills`]: { status: 200, body: '../.claude/skills' },
  };
  const expected = [
    'JetBrains/example · 1 skill',
    'commits — Write commits.',
    `  https://github.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/.agents/skills/commits/SKILL.md`,
    '  also in .agents/skills/commits/skill.md, .claude/skills/commits/SKILL.md, .claude/skills/commits/skill.md',
  ].join('\n');
  // With a token through code search, without one through the tree: the same skills.
  for (const token of ['test', undefined]) {
    const result = await atlas(['scan', 'github.com/JetBrains/example'], { recording, token });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, expected);
  }
});

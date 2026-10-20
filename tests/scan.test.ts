// The decisions in spec/analysis.md and spec/cli.md, checked on what the real command prints for
// ./fixture and for a small GitHub repository answered in tests/helpers.ts. The edge cases of
// where skills live are yours to add.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { openGitHub } from '../src/core/github.ts';
import { parseSkill } from '../src/core/parse.ts';
import { replay } from '../src/core/replay.ts';
import { atlas, CLI, EXAMPLE_COMMIT, FIXTURE } from './helpers.ts';

const fixture = await atlas(['scan', FIXTURE]);
const example = await atlas(['scan', 'github.com/JetBrains/example']);

test('malformed front matter → the directory name, no description and a warning', () => {
  const parsed = parseSkill(readFileSync(join(FIXTURE, '.agents/skills/release-checklist/SKILL.md'), 'utf8'));
  assert.equal(parsed.name, undefined);
  assert.equal(parsed.description, '');
  assert.equal(
    parsed.warning,
    'malformed front matter: Nested mappings are not allowed in compact mappings at line 3, column 14; using the directory name',
  );
});

test('front matter that refers to itself → malformed, so a JSON answer cannot fail on it', () => {
  const parsed = parseSkill('---\nname: loop\nmetadata: &m { self: *m }\n---\nBody.\n');
  assert.equal(parsed.name, undefined);
  assert.deepEqual(parsed.properties, {});
  assert.equal(parsed.warning, 'front matter refers to itself; using the directory name');
  assert.doesNotThrow(() => JSON.stringify(parsed));
});

test('scan prints the repository, then each skill with its first sentence and pinned link', () => {
  assert.equal(example.code, 0, example.stderr);
  assert.equal(
    example.stdout,
    [
      'JetBrains/example · 1 skill',
      'commits — Write commit messages the way this repository does.',
      `  https://github.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md`,
    ].join('\n'),
  );
});

test('./fixture: every skill, sorted by name, linked to its file, with a warning for the malformed one', () => {
  const root = pathToFileURL(FIXTURE).href;
  assert.equal(fixture.code, 0);
  assert.equal(
    fixture.stdout,
    [
      'fixture · 3 skills',
      "code-style — Follow the project's code style.",
      `  ${root}/.github/skills/code-style/SKILL.md`,
      'commits — Write commit messages the way this repository does.',
      `  ${root}/.claude/skills/commits/SKILL.md`,
      'release-checklist',
      `  ${root}/.agents/skills/release-checklist/SKILL.md`,
    ].join('\n'),
  );
  assert.match(fixture.stderr, /^warning: \.agents\/skills\/release-checklist\/SKILL\.md: malformed front matter: /);
});

test('the CLI prints the result at once and stores nothing but the rules file', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'skill-atlas-'));
  const config = mkdtempSync(join(tmpdir(), 'skill-atlas-config-'));
  t.after(() => [cwd, config].forEach((path) => rmSync(path, { recursive: true, force: true })));
  const env = { ...process.env, XDG_CONFIG_HOME: config, SKILL_ATLAS_RULES: '' };
  const scanned = spawnSync(process.execPath, [CLI, 'scan', FIXTURE], { cwd, env, encoding: 'utf8' });
  assert.equal(scanned.status, 0, scanned.stderr);
  assert.equal(scanned.stdout, `${fixture.stdout}\n`);
  assert.deepEqual(readdirSync(cwd), []);
  assert.deepEqual(readdirSync(join(config, 'skill-atlas')), ['rules.yaml']);
});

test('unreachable repository → a clear message, exit code 1', async () => {
  const missing = await atlas(['scan', join(FIXTURE, 'no-such-directory')]);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /^Not a GitHub URL or a readable directory: .*no-such-directory$/);

  // What GitHub answers for a repository that does not exist.
  const notFound = replay({ 'https://api.github.com/repos/JetBrains/no-such-repository': { status: 404, body: { message: 'Not Found' } } });
  await assert.rejects(openGitHub('https://github.com/JetBrains/no-such-repository', { fetch: notFound }), {
    message: 'Repository not found: https://github.com/JetBrains/no-such-repository',
  });

  const offline = await atlas(['scan', 'https://github.com/JetBrains/not-answered']);
  assert.equal(offline.code, 1);
  assert.match(offline.stderr, /^Cannot reach GitHub: not recorded: https:\/\/api\.github\.com\/repos\/JetBrains\/not-answered$/);
});

test('rate limit → a message that asks for GITHUB_TOKEN', async () => {
  const limited = replay({
    'https://api.github.com/repos/JetBrains/MPS': {
      status: 403,
      body: { message: 'API rate limit exceeded for 192.0.2.1. (But here is the good news: ...)' },
    },
  });
  await assert.rejects(openGitHub('https://github.com/JetBrains/MPS', { fetch: limited }), {
    message: 'GitHub rate limit reached; set GITHUB_TOKEN',
  });
});

test('…/tree/<ref> scans that commit, through the tree even with a token', async () => {
  const commit = '1111111111111111111111111111111111111111';
  const pinned = replay({
    'https://api.github.com/repos/JetBrains/example': { status: 200, body: { full_name: 'JetBrains/example', default_branch: 'main' } },
    [`https://api.github.com/repos/JetBrains/example/commits/${commit}`]: { status: 200, body: { sha: commit } },
    [`https://api.github.com/repos/JetBrains/example/git/trees/${commit}?recursive=1`]: {
      status: 200,
      body: { truncated: false, tree: [{ path: '.claude/skills/old/SKILL.md', mode: '100644', type: 'blob', sha: 'a' }] },
    },
    [`https://raw.githubusercontent.com/JetBrains/example/${commit}/.claude/skills/old/SKILL.md`]: {
      status: 200,
      body: '---\nname: old\ndescription: A skill at an older commit.\n---\n',
    },
  });
  const source = await openGitHub(`https://github.com/JetBrains/example/tree/${commit}/`, { fetch: pinned, token: 'test' });
  assert.equal(source.repository.commit, commit);
  assert.deepEqual(source.paths, ['.claude/skills/old/SKILL.md']);

  const missing = replay({
    'https://api.github.com/repos/JetBrains/example': { status: 200, body: { full_name: 'JetBrains/example', default_branch: 'main' } },
    'https://api.github.com/repos/JetBrains/example/commits/no-such-branch': { status: 404, body: { message: 'No commit found' } },
  });
  await assert.rejects(openGitHub('github.com/JetBrains/example/tree/no-such-branch', { fetch: missing }), {
    message: 'Not found in JetBrains/example: no-such-branch',
  });
});

test('--filter keeps the skills whose name, description or path contains the text, in any letter case', async () => {
  const root = pathToFileURL(FIXTURE).href;
  // `commits` by its name, `code-style` by its description ("…before committing…").
  const byText = await atlas(['scan', '--filter', 'COMMIT', FIXTURE]);
  assert.equal(byText.code, 0, byText.stderr);
  assert.equal(
    byText.stdout,
    [
      'fixture · 2 of 3 skills',
      "code-style — Follow the project's code style.",
      `  ${root}/.github/skills/code-style/SKILL.md`,
      'commits — Write commit messages the way this repository does.',
      `  ${root}/.claude/skills/commits/SKILL.md`,
    ].join('\n'),
  );
  // Warnings are not filtered.
  assert.match(byText.stderr, /^warning: \.agents\/skills\/release-checklist\/SKILL\.md: malformed front matter: /);

  const byPath = await atlas(['scan', FIXTURE, '--filter', '.Agents/Skills/']);
  assert.equal(byPath.stdout, ['fixture · 1 of 3 skills', 'release-checklist', `  ${root}/.agents/skills/release-checklist/SKILL.md`].join('\n'));

  // The whole description counts, not only the first sentence that is printed.
  const github = await atlas(['scan', '--filter', 'every commit', 'github.com/JetBrains/example']);
  assert.equal(github.stdout.split('\n')[0], 'JetBrains/example · 1 of 1 skills');
});

test('--filter: no match is not an error; an empty text keeps every skill; given twice → usage', async () => {
  const none = await atlas(['scan', '--filter', 'no-such-skill', FIXTURE]);
  assert.equal(none.code, 0);
  assert.equal(none.stdout, 'fixture · 0 of 3 skills');

  assert.equal((await atlas(['scan', '--filter', ' ', FIXTURE])).stdout, fixture.stdout);

  const usage = 'Usage: skill-atlas scan [--rules <file>] [--filter <text>] <GitHub URL | directory>';
  for (const args of [['--filter', 'a', '--filter', 'b', FIXTURE], [FIXTURE, '--filter']]) {
    const wrong = await atlas(['scan', ...args]);
    assert.equal(wrong.code, 1);
    assert.equal(wrong.stderr, usage);
  }
  assert.match((await atlas(['help'])).stdout, /scan \[--rules <file>\] \[--filter <text>\]/);
});

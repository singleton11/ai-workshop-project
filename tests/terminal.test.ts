// spec/cli.md, "In a terminal": the same lines, laid out for reading, when stdout is a TTY; a pipe
// gets them plain (scan.test.ts runs the real command into a pipe and compares it with the plain lines).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import type { Recording } from '../src/core/replay.ts';
import { atlas, CLI, EXAMPLE_COMMIT, FIXTURE, history } from './helpers.ts';

const LINK = `https://github.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md`;
const DATED = history('JetBrains/example', EXAMPLE_COMMIT, '.claude/skills/commits/SKILL.md', '2026-03-14T23:30:00Z');
const bold = (text: string) => `\x1b[1m${text}\x1b[0m`;
const dim = (text: string) => `\x1b[2m${text}\x1b[0m`;
const name = (text: string) => `\x1b[1;36m${text}\x1b[0m`;

/** JetBrains/example with a second skill, `notes`, whose first sentence is `description`. */
function withNotes(description: string): Recording {
  const search = 'https://api.github.com/search/code?q=filename:SKILL.md+repo:JetBrains/example&per_page=100&page=1';
  const skills = `https://api.github.com/repos/JetBrains/example/git/trees/claude-skills?recursive=1`;
  return {
    ...DATED,
    [search]: { status: 200, body: { total_count: 2, items: [{ path: '.claude/skills/commits/SKILL.md' }, { path: '.claude/skills/notes/SKILL.md' }] } },
    [skills]: {
      status: 200,
      body: { truncated: false, tree: ['commits', 'notes'].map((skill) => ({ path: `${skill}/SKILL.md`, mode: '100644', type: 'blob', sha: skill })) },
    },
    [`https://raw.githubusercontent.com/JetBrains/example/${EXAMPLE_COMMIT}/.claude/skills/notes/SKILL.md`]: {
      status: 200,
      body: `---\nname: notes\ndescription: ${description}\n---\n`,
    },
  };
}

test('in a terminal: an empty line before each skill, the name in bold cyan, the rest dimmed', async () => {
  const result = await atlas(['scan', 'github.com/JetBrains/example'], { recording: DATED, terminal: { columns: 120, color: true } });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(
    result.stdout,
    [
      `${bold('JetBrains/example')} ${dim('· 1 skill')}`,
      '',
      `${name('commits')} — Write commit messages the way this repository does.`,
      `  ${dim(`updated 2026-03-14 · ${LINK}`)}`,
    ].join('\n'),
  );
});

test('in a terminal: the line with the name is cut to its width with …; the link line never is', async () => {
  const recording = withNotes('Keep notes of every meeting, decision and follow-up in the docs folder of this repository.');
  const result = await atlas(['scan', 'github.com/JetBrains/example'], { recording, terminal: { columns: 40, color: false } });
  assert.equal(result.code, 0, result.stderr);
  const lines = result.stdout.split('\n');
  // 40 characters exactly: the name, " — ", then the sentence cut, its trailing space dropped.
  assert.equal(lines[1], '');
  assert.equal(lines[2], 'commits — Write commit messages the way…');
  assert.equal(lines[3], `  updated 2026-03-14 · ${LINK}`);
  assert.equal(lines[5], 'notes — Keep notes of every meeting, de…');
  for (const line of [lines[2], lines[5]]) assert.equal([...line].length, 40, line);
  // A sentence that fits is left as it is.
  const wide = await atlas(['scan', 'github.com/JetBrains/example'], { recording, terminal: { columns: 200, color: false } });
  assert.equal(wide.stdout.split('\n')[5], 'notes — Keep notes of every meeting, decision and follow-up in the docs folder of this repository.');
});

test('in a terminal: a name with no room left for its sentence is alone on its line, cut to the width too', async () => {
  const line = async (columns: number) =>
    (await atlas(['scan', 'github.com/JetBrains/example'], { recording: DATED, terminal: { columns, color: true } })).stdout.split('\n')[2];
  // "commits" is 7 characters: with " — ", 10 leave no room, 11 room for "…" only.
  assert.equal(await line(11), `${name('commits')} — …`);
  assert.equal(await line(10), name('commits'));
  assert.equal(await line(7), name('commits'));
  assert.equal(await line(5), name('comm…'));
  assert.equal(await line(1), name('…'));
});

test('in a terminal: a name without a description is cut to the width too', async () => {
  const recording = withNotes('Keep notes.');
  const key = `https://raw.githubusercontent.com/JetBrains/example/${EXAMPLE_COMMIT}/.claude/skills/notes/SKILL.md`;
  recording[key] = { status: 200, body: '---\nname: a-skill-with-a-long-name-and-no-description\n---\n' };
  const result = await atlas(['scan', 'github.com/JetBrains/example'], { recording, terminal: { columns: 20, color: false } });
  assert.equal(result.code, 0, result.stderr);
  const lines = result.stdout.split('\n');
  assert.equal(lines[2], 'a-skill-with-a-long…');
  assert.equal(lines[5], 'commits — Write com…');
});

test('the CLI in a terminal: colors, unless NO_COLOR, even empty, or TERM=dumb', { skip: !hasScript() && 'needs util-linux `script` for a terminal' }, () => {
  const scan = (env: Record<string, string | undefined>) => {
    const environment: Record<string, string | undefined> = { ...process.env, SKILL_ATLAS_RULES: '/dev/null', TERM: 'xterm', ...env };
    for (const key of Object.keys(environment)) if (environment[key] === undefined) delete environment[key];
    const command = `'${process.execPath}' '${CLI}' scan '${FIXTURE}'`;
    const scanned = spawnSync('script', ['-qec', command, '/dev/null'], { env: environment, encoding: 'utf8' });
    assert.equal(scanned.status, 0, scanned.stderr);
    return scanned.stdout;
  };
  assert.match(scan({ NO_COLOR: undefined }), /\x1b\[1;36m/);
  for (const env of [{ NO_COLOR: '' }, { NO_COLOR: '1' }, { NO_COLOR: undefined, TERM: 'dumb' }]) {
    const stdout = scan(env);
    assert.doesNotMatch(stdout, /\x1b/, JSON.stringify(env));
    // Still the terminal's layout: an empty line before the first skill.
    assert.match(stdout, /^fixture · \d+ skills\r?\n\r?\n/, JSON.stringify(env));
  }
});

function hasScript(): boolean {
  return spawnSync('script', ['-qec', 'true', '/dev/null']).status === 0;
}

test('in a terminal without colors (NO_COLOR, TERM=dumb): the layout, no escape codes', async () => {
  const result = await atlas(['scan', 'github.com/JetBrains/example'], { recording: DATED, terminal: { columns: 120, color: false } });
  assert.equal(
    result.stdout,
    ['JetBrains/example · 1 skill', '', 'commits — Write commit messages the way this repository does.', `  updated 2026-03-14 · ${LINK}`].join('\n'),
  );
  assert.doesNotMatch(result.stdout, /\x1b/);
});

test('in a terminal: --filter keeps the layout, and its count is dimmed too', async () => {
  const recording = withNotes('Keep notes.');
  const result = await atlas(['scan', '--filter', 'notes', 'github.com/JetBrains/example'], { recording, terminal: { columns: 120, color: true } });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(result.stdout.split('\n').slice(0, 3), [`${bold('JetBrains/example')} ${dim('· 1 of 2 skills')}`, '', `${name('notes')} — Keep notes.`]);
});

test('in a terminal: "also in" is dimmed; warnings on stderr are as they are', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'skill-atlas-terminal-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const text = '---\nname: commits\ndescription: Write commits.\n---\n';
  for (const path of ['.agents/skills/commits/SKILL.md', '.claude/skills/commits/SKILL.md', 'skills/x/y/z/SKILL.md', 'plugins/a/SKILL.md']) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), path.startsWith('plugins') ? '---\nname: a\n---\n' : text);
  }
  const result = await atlas(['scan', root], { terminal: { columns: 120, color: true }, localDates: true });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /\n {2}\x1b\[2malso in \.agents\/skills\/commits\/SKILL\.md, \.claude\/skills\/commits\/SKILL\.md\x1b\[0m$/);
  assert.equal(result.stderr, 'warning: plugins/a/SKILL.md: not a skill (matches no skills pattern)');
});

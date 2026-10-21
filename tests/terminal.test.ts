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

/** JetBrains/example with a second skill, as its SKILL.md says. */
function withSkillFile(text: string): Recording {
  const recording = withNotes('Keep notes.');
  recording[`https://raw.githubusercontent.com/JetBrains/example/${EXAMPLE_COMMIT}/.claude/skills/notes/SKILL.md`] = { status: 200, body: text };
  return recording;
}

const NIHONGO = '---\nname: 日本語のスキル\ndescription: 日本語の説明文はとても長いのでターミナルの幅を超えてしまいます。次の文。\n---\n';

test('in a terminal: the width is in columns: a CJK character takes two', async () => {
  const lines = async (columns: number) =>
    (await atlas(['scan', 'github.com/JetBrains/example'], { recording: withSkillFile(NIHONGO), terminal: { columns, color: false } })).stdout.split('\n');
  // 40 columns: the name 14, " — " 3, then 11 characters of the sentence (22) and "…".
  const at40 = await lines(40);
  assert.equal(at40[2], 'commits — Write commit messages the way…');
  assert.equal(at40[5], '日本語のスキル — 日本語の説明文はとても…');
  // 41: the twelfth character would cross the edge, so it is left out; the line is 40 columns.
  assert.equal((await lines(41))[5], '日本語のスキル — 日本語の説明文はとても…');
  // A sentence that fits in columns is left as it is ("。" ends no sentence: the description is one).
  const whole = '日本語のスキル — 日本語の説明文はとても長いのでターミナルの幅を超えてしまいます。次の文。';
  assert.equal((await lines(89))[5], whole);
  assert.equal((await lines(88))[5], '日本語のスキル — 日本語の説明文はとても長いのでターミナルの幅を超えてしまいます。次の文…');
});

test('in a terminal: a wide name with no room left for its sentence is cut in columns too', async () => {
  const line = async (columns: number) =>
    (await atlas(['scan', 'github.com/JetBrains/example'], { recording: withSkillFile(NIHONGO), terminal: { columns, color: true } })).stdout.split('\n')[5];
  // "日本語のスキル" is 14 columns: with " — ", 17 leave no room, 18 room for "…" only.
  assert.equal(await line(18), `${name('日本語のスキル')} — …`);
  assert.equal(await line(17), name('日本語のスキル'));
  assert.equal(await line(14), name('日本語のスキル'));
  assert.equal(await line(13), name('日本語のスキ…'));
  assert.equal(await line(12), name('日本語のス…'));
  assert.equal(await line(2), name('…'));
  assert.equal(await line(1), name('…'));
});

test('in a terminal: an emoji takes two columns, a combining mark none, an emoji sequence two', async () => {
  // "🚀 rocket" is 9 columns; "café" with a combining accent 4; "👩‍💻" (a ZWJ sequence) 2, "🇯🇵" 2.
  const text = '---\nname: 🚀 rocket\ndescription: Launch café builds 👩‍💻🇯🇵 every day from the main branch of this repository.\n---\n';
  const line = async (columns: number) =>
    (await atlas(['scan', 'github.com/JetBrains/example'], { recording: withSkillFile(text), terminal: { columns, color: false } })).stdout.split('\n')[5];
  assert.equal(await line(31), '🚀 rocket — Launch café builds…');
  assert.equal(await line(34), '🚀 rocket — Launch café builds 👩‍💻…');
  assert.equal(await line(36), '🚀 rocket — Launch café builds 👩‍💻🇯🇵…');
  // 35: the flag would cross the edge, so it is left out; the line is 34 columns.
  assert.equal(await line(35), '🚀 rocket — Launch café builds 👩‍💻…');
});

test('in a terminal: a halfwidth voiced kana, "ｶﾞ", is one grapheme but two columns', async () => {
  const line = async (text: string, columns: number) =>
    (await atlas(['scan', 'github.com/JetBrains/example'], { recording: withSkillFile(text), terminal: { columns, color: false } })).stdout.split('\n')[5];
  // "ｶﾞ" is "ｶ" and "ﾞ": a column each. 20 columns: "kana — " 7, six of them (12) and "…".
  const sentence = `---\nname: kana\ndescription: ${'ｶﾞ'.repeat(20)}. Next.\n---\n`;
  assert.equal(await line(sentence, 20), `kana — ${'ｶﾞ'.repeat(6)}…`);
  // 21: the seventh would cross the edge, so it is left out; the line is 20 columns.
  assert.equal(await line(sentence, 21), `kana — ${'ｶﾞ'.repeat(6)}…`);
  // A name 60 columns wide, at 40: nineteen of them (38) and "…".
  assert.equal(await line(`---\nname: ${'ｶﾞ'.repeat(30)}\ndescription: Kana.\n---\n`, 40), `${'ｶﾞ'.repeat(19)}…`);
});

test('the CLI in a terminal 40 columns wide: a CJK line fits it, as an ASCII one does', { skip: !hasScript() && 'needs util-linux `script` for a terminal' }, (t) => {
  const root = mkdtempSync(join(tmpdir(), 'skill-atlas-wide-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'skills/cjk'), { recursive: true });
  mkdirSync(join(root, 'skills/ascii'), { recursive: true });
  writeFileSync(join(root, 'skills/cjk/SKILL.md'), NIHONGO);
  writeFileSync(join(root, 'skills/ascii/SKILL.md'), '---\nname: ascii\ndescription: An ascii description that is long enough to be cut at forty columns. Next.\n---\n');
  const command = `stty cols 40; '${process.execPath}' '${CLI}' scan '${root}'`;
  const env = { ...process.env, SKILL_ATLAS_RULES: '/dev/null', TERM: 'xterm', NO_COLOR: '1' };
  const scanned = spawnSync('script', ['-qec', command, '/dev/null'], { env, encoding: 'utf8' });
  assert.equal(scanned.status, 0, scanned.stderr);
  const lines = scanned.stdout.split(/\r?\n/);
  assert.ok(lines.includes('ascii — An ascii description that is lo…'), scanned.stdout);
  assert.ok(lines.includes('日本語のスキル — 日本語の説明文はとても…'), scanned.stdout);
});

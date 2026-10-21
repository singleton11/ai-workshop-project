// spec/cli.md, "Output": what a scanned repository wrote is printed with each control character
// (C0, DEL, C1) shown as `�`, so it cannot change the terminal or print a line of its own. Issue #21.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test, type TestContext } from 'node:test';
import type { Ask } from '../src/core/cluster.ts';
import { atlas, CLI, EXAMPLE_COMMIT } from './helpers.ts';

/** Clears the screen, moves the cursor home and opens an OSC 8 link, as in the issue. */
const CLEARING = '\x1b[2J\x1b[Hgood-skill\x1b]8;;https://evil.example\x07';
/** Any of C0, DEL or C1. */
const CONTROL = /[\x00-\x1f\x7f-\x9f]/;
const bold = (text: string) => `\x1b[1m${text}\x1b[0m`;
const dim = (text: string) => `\x1b[2m${text}\x1b[0m`;
const name = (text: string) => `\x1b[1;36m${text}\x1b[0m`;

/** A directory with these `SKILL.md` files, removed after the test. */
function repository(t: TestContext, files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'skill-atlas-control-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

/** A SKILL.md; the YAML double quotes turn `\e`, `\n` and `\u009b` into the bytes themselves. */
const skill = (yamlName: string, yamlDescription: string) => `---\nname: "${yamlName}"\ndescription: "${yamlDescription}"\n---\n`;

const HOSTILE = {
  'skills/a/SKILL.md': skill('\\e[2J\\e[Hgood-skill\\e]8;;https://evil.example\\a', 'Looks harmless.'),
  'skills/b/SKILL.md': skill('real\\nfake — injected line', 'Second.'),
  'skills/c/SKILL.md': skill('colors', 'Turns \\e[31mred\\u009b2J here. And more.'),
};

test('a pipe: control characters in a name or a sentence are shown as �; one skill, one name line', async (t) => {
  const root = repository(t, HOSTILE);
  const result = await atlas(['scan', root]);
  assert.equal(result.code, 0, result.stderr);
  const lines = result.stdout.split('\n');
  assert.deepEqual(
    lines.filter((_, index) => index % 2 === 1),
    [
      '�[2J�[Hgood-skill�]8;;https://evil.example� — Looks harmless.',
      'colors — Turns �[31mred�2J here.',
      'real�fake — injected line — Second.',
    ],
  );
  assert.equal(lines.length, 7);
  for (const line of lines) assert.doesNotMatch(line, CONTROL, JSON.stringify(line));
});

test('a terminal: the only escape codes are skill-atlas\'s own colors, whatever the width', async (t) => {
  const root = repository(t, HOSTILE);
  const wide = await atlas(['scan', root], { terminal: { columns: 120, color: true } });
  assert.equal(wide.code, 0, wide.stderr);
  const lines = wide.stdout.split('\n');
  assert.equal(lines[2], `${name('�[2J�[Hgood-skill�]8;;https://evil.example�')} — Looks harmless.`);
  assert.equal(lines[8], `${name('real�fake — injected line')} — Second.`);
  const ours = /\x1b\[(?:1|2|1;36|0)m/g;
  for (const line of lines) assert.doesNotMatch(line.replace(ours, ''), CONTROL, JSON.stringify(line));
  // Cut to a narrow terminal: never in the middle of an escape sequence, as there is none to cut.
  for (const columns of [1, 5, 10, 20]) {
    const narrow = await atlas(['scan', root], { terminal: { columns, color: false } });
    for (const line of narrow.stdout.split('\n')) assert.doesNotMatch(line, CONTROL, `${columns} columns`);
    const names = narrow.stdout.split('\n').filter((_, index) => index % 3 === 2);
    assert.equal(names.length, 3, `${columns} columns`);
    for (const line of names) assert.ok([...line].length <= columns, `${columns} columns: ${line}`);
  }
  assert.equal((await atlas(['scan', root], { terminal: { columns: 10, color: true } })).stdout.split('\n')[2], name('�[2J�[Hgo…'));
});

test('a GitHub repository: the same name, the same �', async () => {
  const recording = {
    [`https://raw.githubusercontent.com/JetBrains/example/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md`]: {
      status: 200,
      body: skill('\\e[2J\\e[Hcommits\\r\\nfake', 'Write \\e]0;title\\a commits.'),
    },
  };
  const result = await atlas(['scan', 'github.com/JetBrains/example'], { recording });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(result.stdout.split('\n'), [
    'JetBrains/example · 1 skill',
    '�[2J�[Hcommits��fake — Write �]0;title� commits.',
    `  https://github.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md`,
  ]);
});

test('paths, "also in", warnings and the directory name: shown with � too', async (t) => {
  const text = '---\nname: commits\ndescription: Write commits.\n---\n';
  const root = repository(t, {
    '\x1b[2Jdir/.agents/skills/commits/SKILL.md': text,
    '\x1b[2Jdir/.claude/skills/commits\x1b[31m/SKILL.md': text,
    '\x1b[2Jdir/plugins/a\x1b[2J\nwarning: fake/SKILL.md': '---\nname: a\n---\n',
  });
  const result = await atlas(['scan', join(root, '\x1b[2Jdir')], { terminal: { columns: 120, color: true } });
  assert.equal(result.code, 0, result.stderr);
  const lines = result.stdout.split('\n');
  assert.equal(lines[0], `${bold('�[2Jdir')} ${dim('· 1 skill')}`);
  assert.equal(lines.at(-1), `  ${dim('also in .claude/skills/commits�[31m/SKILL.md')}`);
  assert.equal(result.stderr, 'warning: plugins/a�[2J�warning: fake/SKILL.md: not a skill (matches no skills pattern)');
});

test('--cluster: a topic from the model is shown with � too', async (t) => {
  const root = repository(t, { 'skills/a/SKILL.md': skill('alpha', 'First.') });
  const ask: Ask = async () => JSON.stringify([{ topic: `Tools${CLEARING}`, skills: [`${root.split('/').at(-1)}:skills/a/SKILL.md`] }]);
  const result = await atlas(['scan', '--cluster', root], { cluster: ask });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout.split('\n')[2], '## Tools�[2J�[Hgood-skill�]8;;https://evil.example� · 1 skill');
});

test('the CLI into a pipe, as in the issue: no escape byte from the repository reaches stdout', (t) => {
  const root = repository(t, HOSTILE);
  const scanned = spawnSync(process.execPath, [CLI, 'scan', root], { env: { ...process.env, SKILL_ATLAS_RULES: '/dev/null' }, encoding: 'utf8' });
  assert.equal(scanned.status, 0, scanned.stderr);
  assert.doesNotMatch(scanned.stdout, /[\x00-\x09\x0b-\x1f\x7f-\x9f]/);
  assert.match(scanned.stdout, /\n�\[2J�\[Hgood-skill�\]8;;https:\/\/evil\.example� — Looks harmless\.\n/);
  assert.match(scanned.stdout, /\nreal�fake — injected line — Second\.\n/);
});

// spec/rules.md: the rules file, created on the first scan, then the user's to edit.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { createBrowserBackend } from '../src/browser.ts';
import { DEFAULT_RULES } from '../src/core/rules.ts';
import { rulesFile } from '../src/rules-file.ts';
import { atlas, FIXTURE, found, OWN_SKILLS } from './helpers.ts';

const ROOT = join(FIXTURE, '..');

/** A fresh config folder, as XDG_CONFIG_HOME. */
function configHome(t: TestContext): string {
  const config = mkdtempSync(join(tmpdir(), 'skill-atlas-config-'));
  t.after(() => {
    chmodSync(config, 0o700);
    rmSync(config, { recursive: true, force: true });
  });
  return config;
}

/** A rules file with this text, for `--rules`. */
function rulesWith(t: TestContext, text: string): string {
  const path = join(configHome(t), 'rules.yaml');
  writeFileSync(path, text);
  return path;
}

const linux = (config: string) => rulesFile({ XDG_CONFIG_HOME: config }, 'linux');

test('the first scan writes the default rules and says so; later scans keep the file as it is', async (t) => {
  const config = configHome(t);
  const path = join(config, 'skill-atlas', 'rules.yaml');
  const first = await atlas(['scan', FIXTURE], { rules: linux(config) });
  assert.equal(first.code, 0);
  assert.match(first.stderr, new RegExp(`^created ${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} with the default rules; edit it to change what is a skill\n`));
  assert.equal(readFileSync(path, 'utf8'), DEFAULT_RULES);
  assert.equal(first.stdout, (await atlas(['scan', FIXTURE])).stdout);

  writeFileSync(path, 'version: 1\n# my own\n');
  const second = await atlas(['scan', FIXTURE], { rules: linux(config) });
  assert.doesNotMatch(second.stderr, /created/);
  assert.equal(readFileSync(path, 'utf8'), 'version: 1\n# my own\n');
});

test('where the rules are: $SKILL_ATLAS_RULES, else $XDG_CONFIG_HOME, else ~/.config; %APPDATA% on Windows', async (t) => {
  const config = configHome(t);
  assert.equal((await rulesFile({ SKILL_ATLAS_RULES: join(config, 'mine.yaml'), XDG_CONFIG_HOME: config }, 'linux').peek()).path, join(config, 'mine.yaml'));
  assert.equal((await linux(config).peek()).path, join(config, 'skill-atlas', 'rules.yaml'));
  assert.match((await rulesFile({}, 'linux').peek()).path ?? '', /\.config\/skill-atlas\/rules\.yaml$/);
  assert.equal((await rulesFile({ APPDATA: config }, 'win32').peek()).path, join(config, 'skill-atlas', 'rules.yaml'));
});

test('two first scans at the same moment: one file, written once, never overwritten', async (t) => {
  const config = configHome(t);
  const notes: string[] = [];
  const store = linux(config);
  const loaded = await Promise.all([1, 2, 3].map(() => store.load(undefined, (text) => notes.push(text))));
  assert.deepEqual(notes.filter((note) => note.startsWith('created')).length, 1);
  for (const { text } of loaded) assert.equal(text, DEFAULT_RULES);
  assert.deepEqual(readdirSync(join(config, 'skill-atlas')), ['rules.yaml']);
});

test('rules that cannot be written: a warning, and the scan uses the defaults', { skip: process.getuid?.() === 0 }, async (t) => {
  const config = configHome(t);
  chmodSync(config, 0o500);
  const result = await atlas(['scan', FIXTURE], { rules: linux(config) });
  assert.equal(result.code, 0);
  assert.match(result.stderr, /^warning: cannot write the rules to .*rules\.yaml \(.*\); using the defaults\n/);
  assert.equal(result.stdout, (await atlas(['scan', FIXTURE])).stdout);
});

test('--rules: this file for this run; a missing one is an error, and is not created', async (t) => {
  const config = configHome(t);
  const missing = join(config, 'missing.yaml');
  const result = await atlas(['scan', '--rules', missing, FIXTURE], { rules: linux(config) });
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `No rules file: ${missing}`);
  assert.equal(existsSync(missing), false);
  assert.equal(existsSync(join(config, 'skill-atlas')), false);
});

test('the user’s own patterns: a product folder becomes a skill, the fixture stops being test data', async (t) => {
  const own = rulesWith(t, 'skills:\n  - "**/skills/**/SKILL.md"\n  - "plugins/*/resources/agent/SKILL.md"\ntest-data: []\n');
  const product = mkdtempSync(join(tmpdir(), 'skill-atlas-repo-'));
  t.after(() => rmSync(product, { recursive: true, force: true }));
  mkdirSync(join(product, 'plugins/foo/resources/agent'), { recursive: true });
  writeFileSync(join(product, 'plugins/foo/resources/agent/SKILL.md'), '---\nname: foo\ndescription: Shipped.\n---\n');
  const result = await atlas(['scan', '--rules', own, product]);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, / · 1 skill\nfoo — Shipped\.\n/);

  const itself = await atlas(['scan', '--rules', own, ROOT]);
  assert.match(itself.stdout, found(3 + OWN_SKILLS.length));
});

test('a key left out keeps its default; [] means none', async (t) => {
  const leftOut = await atlas(['scan', '--rules', rulesWith(t, 'version: 1\n'), ROOT]);
  assert.match(leftOut.stdout, found(OWN_SKILLS.length));
  assert.match(leftOut.stderr, /test data/);

  const none = await atlas(['scan', '--rules', rulesWith(t, 'skills: []\n'), FIXTURE]);
  assert.equal(none.stdout, 'fixture · 0 skills');
  assert.match(none.stderr, /not a skill \(matches no skills pattern\)/);
});

test('each kind of warning can be turned off', async (t) => {
  const quiet = rulesWith(t, 'skills: []\nwarnings:\n  not-a-skill: false\n');
  assert.equal((await atlas(['scan', '--rules', quiet, FIXTURE])).stderr.includes('not a skill'), false);

  const noTestData = rulesWith(t, 'warnings:\n  test-data: false\n');
  const itself = await atlas(['scan', '--rules', noTestData, ROOT]);
  assert.match(itself.stdout, found(OWN_SKILLS.length));
  assert.equal(itself.stderr, '');

  const sameName = mkdtempSync(join(tmpdir(), 'skill-atlas-repo-'));
  t.after(() => rmSync(sameName, { recursive: true, force: true }));
  for (const [folder, description] of [['.claude', 'One.'], ['.github', 'Two.']]) {
    mkdirSync(join(sameName, folder, 'skills/x'), { recursive: true });
    writeFileSync(join(sameName, folder, 'skills/x/SKILL.md'), `---\nname: x\ndescription: ${description}\n---\n`);
  }
  assert.match((await atlas(['scan', sameName])).stderr, /x: 2 different skills share this name/);
  const off = await atlas(['scan', '--rules', rulesWith(t, 'warnings:\n  same-name: false\n'), sameName]);
  assert.equal(off.stderr, '');
  assert.match(off.stdout, / · 2 skills\n/);
});

test('a broken rules file: <path>:<line>: the problem, exit code 1, nothing scanned', async (t) => {
  const cases: [string, RegExp][] = [
    ['skills: [unclosed\n', /:\d+: malformed YAML: /],
    ['version: 1\nskils:\n  - x\n', /:2: unknown key "skils"$/],
    ['version: 2\n', /:1: version must be 1$/],
    ['skills:\n  - "**/skills/{a,b}/SKILL.md"\n', /:2: skills: bad pattern "\*\*\/skills\/\{a,b\}\/SKILL\.md": only \*, \*\* and \? are supported$/],
    ['skills: "**/SKILL.md"\n', /:1: skills must be a list of patterns$/],
    ['test-data:\n  - 3\n', /:2: test-data: a pattern must be a non-empty string$/],
    ['warnings:\n  test-data: no\n', /:2: test-data must be true or false$/],
    ['warnings:\n  loud: true\n', /:2: unknown warning "loud"$/],
    ['- a list\n', /:1: the rules are not a mapping$/],
  ];
  for (const [text, problem] of cases) {
    const path = rulesWith(t, text);
    const result = await atlas(['scan', '--rules', path, 'https://github.com/JetBrains/not-answered']);
    assert.equal(result.code, 1, text);
    assert.equal(result.stdout, '', text);
    assert.ok(result.stderr.startsWith(`${path}:`), result.stderr);
    assert.match(result.stderr, problem, text);
  }
});

test('rules shows the file, or the defaults it will have; --defaults the current defaults', async (t) => {
  const config = configHome(t);
  const path = join(config, 'skill-atlas', 'rules.yaml');
  const before = await atlas(['rules'], { rules: linux(config) });
  assert.equal(before.stdout, `# ${path} does not exist yet: the first scan creates it with these defaults\n${DEFAULT_RULES.trimEnd()}`);
  assert.equal(existsSync(path), false);

  mkdirSync(join(config, 'skill-atlas'));
  writeFileSync(path, 'version: 1\n');
  assert.equal((await atlas(['rules'], { rules: linux(config) })).stdout, `# ${path}\nversion: 1`);
  assert.equal((await atlas(['rules', '--defaults'], { rules: linux(config) })).stdout, DEFAULT_RULES.trimEnd());
});

test('help and an unknown command write nothing', async (t) => {
  const config = configHome(t);
  assert.equal((await atlas(['help'], { rules: linux(config) })).code, 0);
  assert.equal((await atlas(['nope'], { rules: linux(config) })).code, 1);
  assert.deepEqual(readdirSync(config), []);
});

test('in the browser: the built-in defaults, which cannot be changed there', async () => {
  const browser = createBrowserBackend({ fetch: async () => new Response('', { status: 404 }) });
  assert.equal(await browser.run('skill-atlas rules'), `# the default rules; they cannot be changed here\n${DEFAULT_RULES.trimEnd()}`);
  assert.equal(await browser.run('skill-atlas scan --rules x.yaml github.com/a/b'), '--rules needs a file; there are no files here');
});

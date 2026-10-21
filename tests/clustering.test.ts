// spec/clustering.md, and `scan --cluster` in spec/cli.md: the model is a function here, or
// tests/fake-claude.mjs where `claude -p` itself runs. The page and the API are in web.test.ts.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createBrowserBackend } from '../src/browser.ts';
import { CLAUDE_ARGS, claude } from '../src/claude.ts';
import { BODY_LIMIT, clusterPrompt, clusterSkills, clustersFrom, type Ask, type ClusterInput } from '../src/core/cluster.ts';
import { AtlasError } from '../src/core/errors.ts';
import type { Recording } from '../src/core/replay.ts';
import { atlas, CLI, FIXTURE, withoutDates } from './helpers.ts';

const FAKE = fileURLToPath(new URL('./fake-claude.mjs', import.meta.url));

const STYLE = 'fixture:.github/skills/code-style/SKILL.md';
const COMMITS = 'fixture:.claude/skills/commits/SKILL.md';
const RELEASE = 'fixture:.agents/skills/release-checklist/SKILL.md';

/** A model that answers `answer` and keeps every question it was asked. */
function model(answer: string | ((prompt: string) => string)) {
  const prompts: string[] = [];
  const ask: Ask = async (prompt) => {
    prompts.push(prompt);
    return typeof answer === 'string' ? answer : answer(prompt);
  };
  return { ask, prompts };
}

/** The skills the question lists, as the model reads them. */
function asked(prompt: string): ClusterInput[] {
  return JSON.parse(prompt.slice(prompt.indexOf('Skills (JSON):') + 'Skills (JSON):'.length));
}

const topics = (...clusters: [string, string[]][]) => JSON.stringify(clusters.map(([topic, skills]) => ({ topic, skills })));

// The core

test('the question: every skill once, its id, name, description and the start of its body; JSON asked for', async () => {
  const long = 'x'.repeat(BODY_LIMIT + 10);
  const prompt = clusterPrompt([
    { id: 'a', name: 'alpha', description: 'First.', body: 'Short body.' },
    { id: 'b', name: 'beta', description: '', body: long },
  ]);
  assert.match(prompt, /^Group these agent skills by topic/);
  assert.match(prompt, /2 to 8 topics/);
  assert.match(prompt, /exactly one topic/);
  assert.match(prompt, /\[\{"topic": "<name>", "skills": \["<id>", …\]\}, …\]/);
  assert.deepEqual(asked(prompt), [
    { id: 'a', name: 'alpha', description: 'First.', body: 'Short body.' },
    { id: 'b', name: 'beta', description: '', body: `${'x'.repeat(BODY_LIMIT)}…` },
  ]);
});

test('no skills, no question', async () => {
  const { ask, prompts } = model('[]');
  assert.deepEqual(await clusterSkills([], ask), []);
  assert.equal(prompts.length, 0);
});

test('the answer: in a code fence or after a few words too; the largest topic first, then by name', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const answer = `Here you go:\n\`\`\`json\n${topics(['Zeta', ['e']], ['Docs', ['a', 'b']], ['Alpha', ['c']], ['Build', ['d']])}\n\`\`\``;
  assert.deepEqual(clustersFrom(answer, ids), [
    { topic: 'Docs', skills: ['a', 'b'] },
    { topic: 'Alpha', skills: ['c'] },
    { topic: 'Build', skills: ['d'] },
    { topic: 'Zeta', skills: ['e'] },
  ]);
});

test('the answer is checked: unknown ids and second mentions dropped, the rest in Other, same names one, empty topics gone', () => {
  const answer = topics(
    ['Docs', ['a', 'nope', 'a']],
    ['  Docs ', ['b']],
    ['Build', ['a', 'c']],
    ['Empty', ['nope']],
    ['', ['d']],
  );
  assert.deepEqual(clustersFrom(answer, ['a', 'b', 'c', 'd', 'e', 'f']), [
    { topic: 'Other', skills: ['d', 'e', 'f'] },
    { topic: 'Docs', skills: ['a', 'b'] },
    { topic: 'Build', skills: ['c'] },
  ]);
});

test('an answer that is not topics is an error, with the start of it', () => {
  for (const answer of ['I cannot help with that.', '{"topic": "x"}', '[{"topic": "x", "skills": [1]}]', '[{"skills": []}]', '[oops]', '']) {
    assert.throws(() => clustersFrom(answer, ['a']), (error) => error instanceof AtlasError && error.message.startsWith('Clustering failed: the model did not answer with topics: '), answer);
  }
  assert.throws(() => clustersFrom(`no ${'word '.repeat(50)}`, ['a']), (error: Error) => error.message.endsWith('…') && error.message.length < 200);
  assert.throws(() => clustersFrom('', ['a']), /topics: \(nothing\)$/);
});

// The CLI

test('scan --cluster: the same first line, then each topic and its skills, the largest first', async () => {
  const { ask, prompts } = model(topics(['Release', [RELEASE]], ['Code Quality', [STYLE, COMMITS]]));
  const result = await atlas(['scan', '--cluster', FIXTURE], { cluster: ask });
  assert.equal(result.code, 0, result.stderr);
  const plain = await atlas(['scan', FIXTURE]);
  const lines = plain.stdout.split('\n');
  const block = (name: string) => {
    const start = lines.findIndex((line) => line.startsWith(name));
    return lines.slice(start, start + 2);
  };
  assert.equal(result.stdout, [
    'fixture · 3 skills',
    '',
    '## Code Quality · 2 skills',
    ...block('code-style'),
    ...block('commits'),
    '',
    '## Release · 1 skill',
    ...block('release-checklist'),
  ].join('\n'));
  // One question, with each skill's body.
  assert.equal(prompts.length, 1);
  const skills = asked(prompts[0]);
  assert.deepEqual(skills.map((skill) => skill.id).sort(), [RELEASE, COMMITS, STYLE].sort());
  const commits = skills.find((skill) => skill.id === COMMITS)!;
  assert.equal(commits.name, 'commits');
  assert.match(commits.description, /^Write commit messages/);
  assert.ok(commits.body.trim().length > 0);
  assert.equal(result.stderr, plain.stderr); // the same warnings
});

test('scan --cluster --filter: only the matching skills are asked about; none, no question', async () => {
  const { ask, prompts } = model((prompt) => topics(['Git', asked(prompt).map((skill) => skill.id)]));
  const result = await atlas(['scan', '--filter', 'COMMIT MESSAGES', '--cluster', FIXTURE], { cluster: ask });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^fixture · 1 of 3 skills\n\n## Git · 1 skill\ncommits — /);
  assert.deepEqual(asked(prompts[0]).map((skill) => skill.id), [COMMITS]);

  const none = await atlas(['scan', '--cluster', '--filter', 'nothing matches', FIXTURE], { cluster: ask });
  assert.equal(none.code, 0);
  assert.equal(none.stdout, 'fixture · 0 of 3 skills');
  assert.equal(prompts.length, 1);
});

test('scan --cluster: a skill the model left out is in Other; its copies are still said', async () => {
  const { ask } = model(topics(['Git', [COMMITS]]));
  const result = await atlas(['scan', '--cluster', FIXTURE], { cluster: ask });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(result.stdout.split('\n').filter((line) => line.startsWith('## ')), ['## Other · 2 skills', '## Git · 1 skill']);
});

test('scan --cluster: a model that fails prints nothing but its error, exit code 1', async () => {
  const result = await atlas(['scan', '--cluster', FIXTURE], { cluster: model('Sorry, no.').ask });
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'Clustering failed: the model did not answer with topics: Sorry, no.');
});

test('scan --cluster once; not in the browser terminal', async () => {
  const usage = 'Usage: skill-atlas scan [--rules <file>] [--filter <text>] [--cluster] <GitHub URL | directory>';
  assert.equal((await atlas(['scan', '--cluster', '--cluster', FIXTURE])).stderr, usage);
  assert.match((await atlas(['help'])).stdout, /--cluster groups them by topic, with claude -p and a small model/);
  const browser = createBrowserBackend({ fetch: async () => new Response('', { status: 404 }) });
  assert.equal(await browser.run('skill-atlas scan --cluster https://github.com/acme/tools'), '--cluster runs only from the command line');
});

/** acme with two repositories, listed through their trees: tools (deploy, review) and other (triage). */
const ACME: Recording = (() => {
  const API = 'https://api.github.com';
  const tree = (paths: string[]) => ({ status: 200, body: { truncated: false, tree: paths.map((path) => ({ path, mode: '100644', type: 'blob', sha: path })) } });
  const skill = (repo: string, commit: string, path: string, name: string, description: string) => ({
    [`https://raw.githubusercontent.com/${repo}/${commit}/${path}`]: { status: 200, body: `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n` },
  });
  return {
    [`${API}/users/acme`]: { status: 200, body: { login: 'acme', type: 'Organization' } },
    [`${API}/orgs/acme/repos?type=all&per_page=100&page=1`]: {
      status: 200,
      body: ['tools', 'other'].map((name) => ({ full_name: `acme/${name}`, default_branch: 'main', fork: false, archived: false })),
    },
    [`${API}/repos/acme/tools`]: { status: 200, body: { full_name: 'acme/tools', default_branch: 'main' } },
    [`${API}/repos/acme/tools/commits/main`]: { status: 200, body: { sha: '1'.repeat(40) } },
    [`${API}/repos/acme/tools/git/trees/${'1'.repeat(40)}?recursive=1`]: tree(['skills/deploy/SKILL.md', 'skills/review/SKILL.md']),
    ...skill('acme/tools', '1'.repeat(40), 'skills/deploy/SKILL.md', 'deploy', 'Ship to production.'),
    ...skill('acme/tools', '1'.repeat(40), 'skills/review/SKILL.md', 'review', 'Review pull requests.'),
    [`${API}/repos/acme/other/commits/main`]: { status: 200, body: { sha: '2'.repeat(40) } },
    [`${API}/repos/acme/other/git/trees/${'2'.repeat(40)}?recursive=1`]: tree(['skills/triage/SKILL.md']),
    ...skill('acme/other', '2'.repeat(40), 'skills/triage/SKILL.md', 'triage', 'Sort new issues.'),
  };
})();

test('scan --cluster of an organization: one question for all its repositories; a topic mixes them', async () => {
  const { ask, prompts } = model(topics(['Workflow', ['acme/tools:skills/review/SKILL.md', 'acme/other:skills/triage/SKILL.md']], ['Release', ['acme/tools:skills/deploy/SKILL.md']]));
  const result = await atlas(['scan', '--cluster', 'https://github.com/acme'], { recording: ACME, token: undefined, cluster: ask });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, [
    'acme · 3 skills in 2 of 2 repositories',
    '',
    '## Workflow · 2 skills',
    'review — Review pull requests.',
    `  https://github.com/acme/tools/blob/${'1'.repeat(40)}/skills/review/SKILL.md`,
    'triage — Sort new issues.',
    `  https://github.com/acme/other/blob/${'2'.repeat(40)}/skills/triage/SKILL.md`,
    '',
    '## Release · 1 skill',
    'deploy — Ship to production.',
    `  https://github.com/acme/tools/blob/${'1'.repeat(40)}/skills/deploy/SKILL.md`,
  ].join('\n'));
  assert.equal(prompts.length, 1);
  assert.equal(asked(prompts[0]).length, 3);
});

test('scan --cluster of a scan that stopped partway: the skills it read, clustered, then "scan incomplete", exit code 1', async () => {
  const failing: Recording = { ...ACME, [`https://raw.githubusercontent.com/acme/tools/${'1'.repeat(40)}/skills/review/SKILL.md`]: { status: 500, body: 'oops' } };
  const { ask, prompts } = model((prompt) => topics(['All', asked(prompt).map((skill) => skill.id)]));
  const result = await atlas(['scan', '--cluster', 'https://github.com/acme/tools'], { recording: failing, token: undefined, cluster: ask });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /^acme\/tools · 1 skill\n\n## All · 1 skill\ndeploy — Ship to production\./);
  assert.deepEqual(asked(prompts[0]).map((skill) => skill.id), ['acme/tools:skills/deploy/SKILL.md']);
  assert.match(result.stderr, /^scan incomplete: GitHub answered 500 for .*review\/SKILL\.md$/);
});

// claude -p

/** `claude()` with tests/fake-claude.mjs, answering as `env` says; what it was given. */
async function fake(env: Record<string, string>, prompt = 'the question') {
  const dir = await mkdtemp(join(tmpdir(), 'skill-atlas-claude-'));
  const log = join(dir, 'log.json');
  Object.assign(process.env, { FAKE_CLAUDE_LOG: log }, env);
  try {
    const answer: { text?: string; error?: Error } = await claude(FAKE)(prompt).then((text) => ({ text }), (error: Error) => ({ error }));
    const given = await readFile(log, 'utf8').then(JSON.parse, () => undefined);
    return { ...answer, given };
  } finally {
    for (const key of ['FAKE_CLAUDE_LOG', ...Object.keys(env)]) delete process.env[key];
  }
}

test('claude -p with the small model, no tools and no session kept; the question on stdin, the answer its result', async () => {
  assert.deepEqual(CLAUDE_ARGS, ['-p', '--model', 'haiku', '--output-format', 'json', '--tools', '', '--no-session-persistence']);
  const { text, given } = await fake({ FAKE_CLAUDE_RESULT: '[{"topic":"A","skills":[]}]' }, 'Group these…');
  assert.equal(text, '[{"topic":"A","skills":[]}]');
  assert.deepEqual(given, { args: CLAUDE_ARGS, prompt: 'Group these…' });
});

test('claude fails: its message, the first line of it; not found: how to get it', async () => {
  assert.equal((await fake({ FAKE_CLAUDE_ERROR: 'Not logged in · Please run /login' })).error?.message, `Clustering failed: ${FAKE}: Not logged in · Please run /login`);
  assert.equal((await fake({ FAKE_CLAUDE_STDERR: 'Something broke' })).error?.message, `Clustering failed: ${FAKE}: Something broke`);
  const missing = await claude('/nonexistent/claude')('q').catch((error: Error) => error);
  assert.equal((missing as Error).message, 'Clustering needs Claude Code: /nonexistent/claude was not found; install it, or set SKILL_ATLAS_CLAUDE');
});

test('a question dropped: claude is stopped', async () => {
  process.env.FAKE_CLAUDE_HANG = '1';
  try {
    const controller = new AbortController();
    const asking = claude(FAKE)('q', controller.signal);
    setTimeout(() => controller.abort(), 200);
    await assert.rejects(asking, { name: 'AbortError' });
  } finally {
    delete process.env.FAKE_CLAUDE_HANG;
  }
});

test('the CLI itself: SKILL_ATLAS_CLAUDE is the program it runs; without it, a clear error and exit code 1', async () => {
  const run = (env: Record<string, string>) =>
    new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
      const child = spawn(process.execPath, [CLI, 'scan', '--cluster', FIXTURE], { env: { ...process.env, SKILL_ATLAS_RULES: '/dev/null', ...env } });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => (stdout += chunk));
      child.stderr.on('data', (chunk) => (stderr += chunk));
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    });
  const ok = await run({ SKILL_ATLAS_CLAUDE: FAKE, FAKE_CLAUDE_RESULT: topics(['Everything', [STYLE, COMMITS, RELEASE]]) });
  assert.equal(ok.code, 0, ok.stderr);
  assert.match(withoutDates(ok.stdout), /^fixture · 3 skills\n\n## Everything · 3 skills\ncode-style — /);

  const missing = await run({ SKILL_ATLAS_CLAUDE: '/nonexistent/claude' });
  assert.equal(missing.code, 1);
  assert.equal(missing.stdout, '');
  assert.match(missing.stderr, /Clustering needs Claude Code: \/nonexistent\/claude was not found; install it, or set SKILL_ATLAS_CLAUDE\n$/);
});

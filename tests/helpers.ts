// Runs the commands the way the CLI does, with GitHub answering from EXAMPLE below.
import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, type RulesStore } from '../src/commands.ts';
import type { Ask } from '../src/core/cluster.ts';
import { openGitHub, openGitHubOwner, parseGitHubOwnerUrl, parseGitHubUrl, type Fetch } from '../src/core/github.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { DEFAULT_RULES } from '../src/core/rules.ts';
import { openDirectory } from '../src/local.ts';

export const FIXTURE = fileURLToPath(new URL('../fixture', import.meta.url));
export const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

/** The agent skills skill-atlas keeps for working on itself, `.agents/skills/<name>`: a scan of this checkout finds them. */
const OWN = join(FIXTURE, '../.agents/skills');
export const OWN_SKILLS = readdirSync(OWN).filter((name) => existsSync(join(OWN, name, 'SKILL.md')));

/** The first line of a scan that found `n` skills. */
export function found(n: number): RegExp {
  return new RegExp(`^\\S+ · ${n} ${n === 1 ? 'skill' : 'skills'}(\n|$)`);
}

/** The commit GitHub answers for JetBrains/example. */
export const EXAMPLE_COMMIT = '5ab6270ab772d113e8ad52ebfcaa0109c522ae00';

/** What GitHub answers for a small repository, JetBrains/example, with one skill. */
export const EXAMPLE: Recording = {
  'https://api.github.com/repos/JetBrains/example': { status: 200, body: { full_name: 'JetBrains/example', default_branch: 'main' } },
  'https://api.github.com/repos/JetBrains/example/commits/main': { status: 200, body: { sha: EXAMPLE_COMMIT } },
  'https://api.github.com/search/code?q=filename:SKILL.md+repo:JetBrains/example&per_page=100&page=1': {
    status: 200,
    body: { total_count: 1, items: [{ path: '.claude/skills/commits/SKILL.md' }] },
  },
  [`https://raw.githubusercontent.com/JetBrains/example/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md`]: {
    status: 200,
    body: '---\nname: commits\ndescription: Write commit messages the way this repository does. Use for every commit.\n---\n# Commits\n',
  },
  // With a token, symbolic links come from the folders a skill can be in, one level at a time.
  [`https://api.github.com/repos/JetBrains/example/git/trees/${EXAMPLE_COMMIT}`]: {
    status: 200,
    body: { truncated: false, tree: [{ path: '.claude', mode: '040000', type: 'tree', sha: 'claude' }] },
  },
  'https://api.github.com/repos/JetBrains/example/git/trees/claude': {
    status: 200,
    body: { truncated: false, tree: [{ path: 'skills', mode: '040000', type: 'tree', sha: 'claude-skills' }] },
  },
  'https://api.github.com/repos/JetBrains/example/git/trees/claude-skills?recursive=1': {
    status: 200,
    body: { truncated: false, tree: [{ path: 'commits/SKILL.md', mode: '100644', type: 'blob', sha: 'a' }] },
  },
};

/** A request for the last commit that changed a file, as `openGitHub` asks it for a skill's date. */
export const HISTORY = /^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/commits\?sha=/;

/**
 * Answers a history request that is not recorded with no commits: a skill without a date. Anything
 * else goes to `next`, or fails as `replay` does.
 */
export function noHistory(next?: Fetch): Fetch {
  return async (url, init) => {
    if (HISTORY.test(url)) return new Response('[]', { status: 200 });
    if (next) return next(url, init);
    throw new Error(`not recorded: ${url}`);
  };
}

/** GitHub's answer for the last commit that changed `path` at `commit` in `repo`: committed at `date`. */
export function history(repo: string, commit: string, path: string, date: string): Recording {
  const url = `https://api.github.com/repos/${repo}/commits?sha=${commit}&path=${path.split('/').map(encodeURIComponent).join('/')}&per_page=1`;
  return { [url]: { status: 200, body: [{ sha: 'f'.repeat(40), commit: { committer: { name: 'Someone', date } } }] } };
}

/** CLI output with each `updated <day> · ` taken out: for scans of local folders, whose dates are the machine's. */
export function withoutDates(text: string): string {
  return text.replace(/^ {2}updated \d{4}-\d{2}-\d{2} · /gm, '  ');
}

export type AtlasOptions = {
  /** More recorded GitHub answers, next to EXAMPLE. */
  recording?: Recording;
  /** What answers a URL that is not recorded. */
  fallback?: Fetch;
  /** Without a token, GitHub is listed through the tree. */
  token?: string;
  /** The rules: the defaults, kept in memory, unless given. */
  rules?: RulesStore;
  /** GitHub itself, instead of the recordings. */
  fetch?: Fetch;
  /** A local folder's dates are the machine's (its Git history, its file times), so they are taken out unless kept. */
  localDates?: boolean;
  /** The model `--cluster` asks; none by default, so a test that clusters by mistake fails. */
  cluster?: Ask;
};

/** No model: a test that is not about clustering never asks one. */
export const NO_MODEL: Ask = async () => {
  throw new Error('no model in this test');
};

/** The default rules, in memory, so nothing is written; `--rules` still reads its file. */
export const DEFAULTS: RulesStore = {
  load: async (explicit) =>
    explicit ? { path: explicit, text: await readFile(explicit, 'utf8') } : { path: '<default rules>', text: DEFAULT_RULES },
  peek: async () => ({}),
};

/** `skill-atlas <args>`, as the CLI runs it, with GitHub answering from EXAMPLE. */
export async function atlas(args: string[], options: AtlasOptions = {}) {
  const github = options.fetch ?? replay({ ...EXAMPLE, ...options.recording }, noHistory(options.fallback));
  const token = 'token' in options ? options.token : 'test';
  const stdout: string[] = [];
  const stderr: string[] = [];
  let local = false;
  const code = await run(args, {
    // With a token, through code search, as EXAMPLE answers it.
    open: (input) =>
      parseGitHubUrl(input) ? openGitHub(input, { fetch: github, token })
      : parseGitHubOwnerUrl(input) ? openGitHubOwner(input, { fetch: github, token })
      : ((local = true), openDirectory(input)),
    print: (text) => stdout.push(text),
    error: (text) => stderr.push(text),
    rules: options.rules ?? DEFAULTS,
    cluster: options.cluster ?? NO_MODEL,
  });
  const printed = stdout.join('\n');
  return { code, stdout: local && !options.localDates ? withoutDates(printed) : printed, stderr: stderr.join('\n') };
}

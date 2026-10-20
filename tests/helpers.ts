// Runs the commands the way the CLI does, with GitHub answering from EXAMPLE below.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { run, type RulesStore } from '../src/commands.ts';
import { openGitHub, openGitHubOwner, parseGitHubOwnerUrl, parseGitHubUrl, type Fetch } from '../src/core/github.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { DEFAULT_RULES } from '../src/core/rules.ts';
import { openDirectory } from '../src/local.ts';

export const FIXTURE = fileURLToPath(new URL('../fixture', import.meta.url));
export const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

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
};

/** The default rules, in memory, so nothing is written; `--rules` still reads its file. */
export const DEFAULTS: RulesStore = {
  load: async (explicit) =>
    explicit ? { path: explicit, text: await readFile(explicit, 'utf8') } : { path: '<default rules>', text: DEFAULT_RULES },
  peek: async () => ({}),
};

/** `skill-atlas <args>`, as the CLI runs it, with GitHub answering from EXAMPLE. */
export async function atlas(args: string[], options: AtlasOptions = {}) {
  const github = options.fetch ?? replay({ ...EXAMPLE, ...options.recording }, options.fallback);
  const token = 'token' in options ? options.token : 'test';
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await run(args, {
    // With a token, through code search, as EXAMPLE answers it.
    open: (input) =>
      parseGitHubUrl(input) ? openGitHub(input, { fetch: github, token })
      : parseGitHubOwnerUrl(input) ? openGitHubOwner(input, { fetch: github, token })
      : openDirectory(input),
    print: (text) => stdout.push(text),
    error: (text) => stderr.push(text),
    rules: options.rules ?? DEFAULTS,
  });
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}

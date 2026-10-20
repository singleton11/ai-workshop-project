import { AtlasError } from './errors.ts';
import { SKILL_ROOTS } from './find.ts';
import type { Source } from './scan.ts';

/** The part of `fetch` the core uses, so tests and the browser can pass their own. */
export type Fetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<Response>;

export type GitHubOptions = {
  fetch: Fetch;
  /** With a token, skills are found through code search; without it, through the tree. */
  token?: string;
};

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';

/**
 * `https://github.com/owner/repo`, with or without the scheme, a trailing slash or `.git`;
 * `…/tree/<ref>` pins a commit, a branch or a tag instead of the default branch.
 */
export function parseGitHubUrl(input: string): { owner: string; repo: string; ref?: string } | undefined {
  const match = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/([^?#]+?))?\/?$/i.exec(
    input.trim(),
  );
  return match ? { owner: match[1], repo: match[2], ref: match[3] } : undefined;
}

/** Resolves the ref, by default the default branch, to a commit and lists the files that may be skills. */
export async function openGitHub(input: string, options: GitHubOptions): Promise<Source> {
  const name = parseGitHubUrl(input);
  if (!name) throw new AtlasError(`Not a GitHub repository URL: ${input}`);
  const github = client(options);
  const info = await github.json<{ full_name: string; default_branch: string }>(
    `${API}/repos/${name.owner}/${name.repo}`,
    `Repository not found: https://github.com/${name.owner}/${name.repo}`,
  );
  const id = info.full_name;
  const ref = name.ref ?? info.default_branch;
  const { sha } = await github.json<{ sha: string }>(
    `${API}/repos/${id}/commits/${encodePath(ref)}`,
    `Not found in ${id}: ${ref}`,
  );
  const warnings: string[] = [];
  // Code search sees only the default branch, so a pinned ref is always listed through its tree.
  const paths = options.token && !name.ref ? await searchPaths(github, id) : await treePaths(github, id, sha, warnings, !name.ref);
  const [organization, repo] = id.split('/');
  return {
    repository: { id, organization, name: repo, url: `https://github.com/${id}`, commit: sha },
    paths,
    warnings,
    read: (path) => github.raw(`${RAW}/${id}/${sha}/${encodePath(path)}`),
  };
}

/** Code search looks at the whole default branch, 100 results a page. */
async function searchPaths(github: Client, id: string): Promise<string[]> {
  const paths = new Set<string>(); // pages can repeat a result
  // GitHub returns at most 1000 results: ten pages.
  for (let page = 1; page <= 10; page++) {
    const result = await github.json<{ total_count: number; items: { path: string }[] }>(
      `${API}/search/code?q=filename:SKILL.md+repo:${id}&per_page=100&page=${page}`,
    );
    for (const item of result.items) paths.add(item.path);
    if (result.items.length < 100 || page * 100 >= result.total_count) break;
  }
  return [...paths];
}

type Tree = { truncated: boolean; tree: { path: string; mode: string; type: string; sha: string }[] };

/** The whole tree at once, or only the skill roots when it is too large for one answer. */
async function treePaths(github: Client, id: string, sha: string, warnings: string[], searchable: boolean): Promise<string[]> {
  const tree = await github.json<Tree>(`${API}/repos/${id}/git/trees/${sha}?recursive=1`);
  if (!tree.truncated) return files(tree);
  // Code search sees only the default branch: for a pinned ref, GITHUB_TOKEN does not help.
  const hint = searchable ? ' (GITHUB_TOKEN searches everywhere)' : '';
  warnings.push(`the tree is too large to list at once; looked only in ${SKILL_ROOTS.join(', ')}${hint}`);
  const paths: string[] = [];
  for (const root of SKILL_ROOTS) {
    const rootSha = await directory(github, id, sha, root);
    if (!rootSha) continue;
    const subtree = await github.json<Tree>(`${API}/repos/${id}/git/trees/${rootSha}?recursive=1`);
    paths.push(...files(subtree).map((path) => `${root}/${path}`));
  }
  return paths;
}

/** Walks down one level at a time; the directory's tree, or undefined if it does not exist. */
async function directory(github: Client, id: string, sha: string, path: string): Promise<string | undefined> {
  let current = sha;
  for (const segment of path.split('/')) {
    const tree = await github.json<Tree>(`${API}/repos/${id}/git/trees/${current}`);
    const entry = tree.tree.find((item) => item.path === segment && item.type === 'tree');
    if (!entry) return undefined;
    current = entry.sha;
  }
  return current;
}

/** Regular files only: a symbolic link's content is its target, not a SKILL.md. */
function files(tree: Tree): string[] {
  return tree.tree.filter((item) => item.type === 'blob' && item.mode !== '120000').map((item) => item.path);
}

type Client = ReturnType<typeof client>;

function client({ fetch, token }: GitHubOptions) {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const answers = new Map<string, Promise<unknown>>(); // the root tree is asked for once per skill root

  async function get(url: string, init?: { headers: Record<string, string> }): Promise<Response> {
    try {
      return await fetch(url, init);
    } catch (error) {
      throw new AtlasError(`Cannot reach GitHub: ${describe(error)}`);
    }
  }

  async function request(url: string, notFound: string): Promise<unknown> {
    const response = await get(url, { headers });
    if (response.ok) return response.json();
    const body: unknown = await response.json().catch(() => undefined);
    const message = (body as { message?: unknown } | undefined)?.message;
    const text = typeof message === 'string' ? message : '';
    if (response.status === 404) throw new AtlasError(notFound);
    if ((response.status === 403 || response.status === 429) && /rate limit/i.test(text)) {
      throw new AtlasError(`GitHub rate limit reached; ${token ? 'try again in a minute' : 'set GITHUB_TOKEN'}`);
    }
    if (response.status === 401) throw new AtlasError('GitHub rejected the token in GITHUB_TOKEN');
    throw new AtlasError(`GitHub answered ${response.status} for ${url}${text && `: ${text}`}`);
  }

  return {
    /** A GitHub API answer; `notFound` explains a 404. */
    json<T>(url: string, notFound = `Not found on GitHub: ${url}`): Promise<T> {
      if (!answers.has(url)) answers.set(url, request(url, notFound));
      return answers.get(url) as Promise<T>;
    },
    /** A file's bytes at the scanned commit, or undefined if it is not there. */
    async raw(url: string): Promise<Uint8Array | undefined> {
      const response = await get(url);
      if (response.status === 404) return undefined;
      if (!response.ok) throw new AtlasError(`GitHub answered ${response.status} for ${url}`);
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error ? `${error.message} (${error.cause.message})` : error.message;
}

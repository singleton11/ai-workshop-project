import { AtlasError, EmptyRepository, GitHubUnavailable } from './errors.ts';
import { compare, SKILL_ROOTS } from './find.ts';
import type { Organization } from './organization.ts';
import type { Source } from './scan.ts';

/** The part of `fetch` the core uses, so tests and the browser can pass their own. */
export type Fetch = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<Response>;

export type GitHubOptions = {
  fetch: Fetch;
  /** With a token, skills are found through code search; without it, through the tree. */
  token?: string;
  /** Once it is aborted, no request is made and those under way stop: each fails with its reason. */
  signal?: AbortSignal;
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

/**
 * `https://github.com/owner`: an organization or a user, every repository it has. With or without
 * the scheme or a trailing slash.
 */
export function parseGitHubOwnerUrl(input: string): { owner: string } | undefined {
  const match = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/?$/i.exec(input.trim());
  return match ? { owner: match[1] } : undefined;
}

/** What GitHub says about a repository, in its own answer and in an organization's list. */
type RepositoryInfo = { full_name: string; default_branch: string };

/** Resolves the ref, by default the default branch, to a commit and lists the files that may be skills. */
export async function openGitHub(input: string, options: GitHubOptions): Promise<Source> {
  const name = parseGitHubUrl(input);
  if (!name) throw new AtlasError(`Not a GitHub repository URL: ${input}`);
  const github = client(options);
  const info = await github.json<RepositoryInfo>(
    `${API}/repos/${name.owner}/${name.repo}`,
    `Repository not found: https://github.com/${name.owner}/${name.repo}`,
  );
  return openRepository(github, info, { ref: name.ref });
}

/**
 * With a token and no ref, through code search: `searched` when an organization's search already
 * found its SKILL.md files, else a search of its own. `tree`: through the tree even so.
 */
async function openRepository(
  github: Client,
  info: RepositoryInfo,
  { ref, searched, tree = false }: { ref?: string; searched?: string[]; tree?: boolean },
): Promise<Source> {
  const id = info.full_name;
  const commit = ref ?? info.default_branch;
  const { sha } = await github
    .json<{ sha: string }>(`${API}/repos/${id}/commits/${encodePath(commit)}`, `Not found in ${id}: ${commit}`)
    .catch((error: unknown) => {
      throw error instanceof EmptyRepository ? new EmptyRepository(`Repository is empty: https://github.com/${id}`) : error;
    });
  const warnings: string[] = [];
  let listing: Listing;
  // Code search sees only the default branch, so a pinned ref is always listed through its tree.
  if (github.token && !ref && !tree) {
    // Code search finds files, not symbolic links: those come from the folders a skill can be in.
    // Not the whole tree: on a large repository it alone takes seconds.
    const files = searched ?? (await searchPaths(github, id));
    listing = { files, links: (await listFolders(github, id, sha, skillFolders(files))).links, truncated: false };
  } else {
    listing = await listTree(github, id, sha);
    if (listing.truncated) {
      warnings.push(`the tree is too large to list at once; looked only in ${SKILL_ROOTS.join(', ')}${ref ? '' : ' (GITHUB_TOKEN searches everywhere)'}`);
    }
  }
  const [organization, repo] = id.split('/');
  return {
    repository: { id, organization, name: repo, url: `https://github.com/${id}`, commit: sha },
    paths: listing.files,
    links: listing.links,
    warnings,
    read: (path) => github.raw(`${RAW}/${id}/${sha}/${encodePath(path)}`),
    // A symbolic link's content is its target.
    readLink: async (path) => {
      const bytes = await github.raw(`${RAW}/${id}/${sha}/${encodePath(path)}`);
      return bytes && new TextDecoder().decode(bytes).trim();
    },
  };
}

/**
 * An organization's or a user's repositories, forks and archived ones left out. Without a token,
 * each one is listed through its tree. With one, a single code search over the owner finds the
 * SKILL.md files, and only the repositories it finds them in are opened; if the search cannot
 * list them all (more than 1000), every repository is listed through its tree instead.
 */
export async function openGitHubOwner(input: string, options: GitHubOptions): Promise<Organization> {
  const name = parseGitHubOwnerUrl(input);
  if (!name) throw new AtlasError(`Not a GitHub organization URL: ${input}`);
  const github = client(options);
  const owner = await github.json<{ login: string; type: string }>(
    `${API}/users/${name.owner}`,
    `Organization or user not found: https://github.com/${name.owner}`,
  );
  const isOrganization = owner.type === 'Organization';
  const all: (RepositoryInfo & { fork: boolean; archived: boolean })[] = [];
  // 100 a page; a short page is the last one.
  for (let page = 1; ; page++) {
    const items = await github.json<typeof all>(
      `${API}/${isOrganization ? `orgs/${owner.login}/repos?type=all` : `users/${owner.login}/repos?type=owner`}&per_page=100&page=${page}`,
    );
    all.push(...items);
    if (items.length < 100) break;
  }
  const listed = all.filter((info) => !info.fork && !info.archived).sort((a, b) => compareNames(a.full_name, b.full_name));
  const warnings: string[] = [];
  let found: Map<string, string[]> | undefined;
  if (github.token) {
    found = await searchOwner(github, `${isOrganization ? 'org' : 'user'}:${owner.login}`);
    if (!found) warnings.push('code search found more SKILL.md files than it can list; every repository was listed through its tree');
  }
  const repositories = listed
    .filter((info) => !found || found.has(info.full_name.toLowerCase()))
    .map((info) => {
      const searched = found?.get(info.full_name.toLowerCase());
      // Through the tree when the search could not cover everything, as without a token.
      return { id: info.full_name, open: () => openRepository(github, info, { searched, tree: !searched }) };
    });
  return { owner: { id: owner.login, url: `https://github.com/${owner.login}` }, listed: listed.length, repositories, warnings };
}

/** Every SKILL.md code search finds for `qualifier`, by repository (lower case); undefined if it cannot list them all. */
async function searchOwner(github: Client, qualifier: string): Promise<Map<string, string[]> | undefined> {
  const found = new Map<string, Set<string>>(); // pages can repeat a result
  for (let page = 1; ; page++) {
    const result = await github.json<{ total_count: number; incomplete_results: boolean; items: { path: string; repository: { full_name: string } }[] }>(
      `${API}/search/code?q=filename:SKILL.md+${qualifier}&per_page=100&page=${page}`,
    );
    // GitHub returns at most 1000 results: ten pages.
    if (result.incomplete_results || result.total_count > 1000) return undefined;
    for (const item of result.items) {
      const key = item.repository.full_name.toLowerCase();
      found.set(key, (found.get(key) ?? new Set()).add(item.path));
    }
    if (result.items.length < 100 || page * 100 >= result.total_count) break;
  }
  return new Map([...found].map(([key, paths]) => [key, [...paths]]));
}

/** By name in any letter case, then code-unit order: the order of an organization's repositories. */
function compareNames(a: string, b: string): number {
  return compare(a.toLowerCase(), b.toLowerCase()) || compare(a, b);
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

type Listing = { files: string[]; links: string[]; truncated: boolean };

/** The whole tree at once, or only the skill roots when it is too large for one answer. */
async function listTree(github: Client, id: string, sha: string): Promise<Listing> {
  const tree = await github.json<Tree>(`${API}/repos/${id}/git/trees/${sha}?recursive=1`);
  if (!tree.truncated) return { ...entries(tree, ''), truncated: false };
  return { ...(await listFolders(github, id, sha, SKILL_ROOTS)), truncated: true };
}

/** The files and links in these folders, all of them at the same time; a missing folder adds nothing. */
async function listFolders(github: Client, id: string, sha: string, folders: string[]): Promise<Omit<Listing, 'truncated'>> {
  const found = await Promise.all(
    folders.map(async (folder) => {
      const found = await directory(github, id, sha, folder);
      if (!found) return { files: [], links: [] };
      if ('link' in found) return { files: [], links: [found.link] };
      return entries(await github.json<Tree>(`${API}/repos/${id}/git/trees/${found.sha}?recursive=1`), `${folder}/`);
    }),
  );
  return { files: found.flatMap((item) => item.files), links: [...new Set(found.flatMap((item) => item.links))] };
}

/** SKILL_ROOTS, and each outermost `skills` folder a found SKILL.md is in: where a link to a skill can be. */
function skillFolders(files: string[]): string[] {
  const folders = new Set(SKILL_ROOTS);
  for (const file of files) {
    const segments = file.split('/');
    const index = segments.findIndex((segment, i) => i < segments.length - 1 && segment.toLowerCase() === 'skills');
    if (index >= 0) folders.add(segments.slice(0, index + 1).join('/'));
  }
  const sorted = [...folders].sort();
  return sorted.filter((folder) => !sorted.some((outer) => outer !== folder && folder.startsWith(`${outer}/`)));
}

/**
 * Walks down one level at a time: the folder's tree; or, if the path goes through a symbolic link,
 * that link's path; or undefined if there is no such folder.
 */
async function directory(github: Client, id: string, sha: string, path: string): Promise<{ sha: string } | { link: string } | undefined> {
  let current = sha;
  const segments = path.split('/');
  for (const [index, segment] of segments.entries()) {
    const tree = await github.json<Tree>(`${API}/repos/${id}/git/trees/${current}`);
    const entry = tree.tree.find((item) => item.path === segment);
    if (entry?.mode === '120000') return { link: segments.slice(0, index + 1).join('/') };
    if (entry?.type !== 'tree') return undefined;
    current = entry.sha;
  }
  return { sha: current };
}

/** Regular files, and symbolic links apart: a link's content is its target, not a SKILL.md. */
function entries(tree: Tree, prefix: string): { files: string[]; links: string[] } {
  const blobs = tree.tree.filter((item) => item.type === 'blob');
  return {
    files: blobs.filter((item) => item.mode !== '120000').map((item) => prefix + item.path),
    links: blobs.filter((item) => item.mode === '120000').map((item) => prefix + item.path),
  };
}

type Client = ReturnType<typeof client>;

function client({ fetch, token, signal }: GitHubOptions) {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const answers = new Map<string, Promise<unknown>>(); // the root tree is asked for once per skill root

  async function get(url: string, init?: { headers: Record<string, string> }): Promise<Response> {
    signal?.throwIfAborted();
    try {
      return await fetch(url, { ...init, signal });
    } catch (error) {
      // Not GitHub's failure: whoever asked went away.
      signal?.throwIfAborted();
      throw new GitHubUnavailable(`Cannot reach GitHub: ${describe(error)}`);
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
      throw new GitHubUnavailable(`GitHub rate limit reached; ${token ? 'try again in a minute' : 'set GITHUB_TOKEN'}`);
    }
    if (response.status === 401) throw new GitHubUnavailable('GitHub rejected the token in GITHUB_TOKEN');
    if (response.status === 409 && /empty/i.test(text)) throw new EmptyRepository(text);
    throw new AtlasError(`GitHub answered ${response.status} for ${url}${text && `: ${text}`}`);
  }

  return {
    /** With a token, code search can be used. */
    token,
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

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
  let listing: Listing;
  // Code search sees only the default branch, so a pinned ref is always listed through its tree.
  if (options.token && !name.ref) {
    // Code search finds files, not symbolic links: those come from the folders a skill can be in.
    // Not the whole tree: on a large repository it alone takes seconds.
    const search = await searchPaths(github, id);
    // After a failed search, a link could point at a file it did not reach: no links, and no false warnings.
    const folders = search.error === undefined ? await listFolders(github, id, sha, skillFolders(search.files)) : { files: [], links: [] };
    listing = { files: search.files, links: folders.links, truncated: false, error: search.error ?? folders.error };
  } else {
    listing = await listTree(github, id, sha);
    if (listing.truncated) {
      warnings.push(`the tree is too large to list at once; looked only in ${SKILL_ROOTS.join(', ')}${name.ref ? '' : ' (GITHUB_TOKEN searches everywhere)'}`);
    }
  }
  const [organization, repo] = id.split('/');
  return {
    repository: { id, organization, name: repo, url: `https://github.com/${id}`, commit: sha },
    paths: listing.files,
    links: listing.links,
    warnings,
    ...(listing.error === undefined ? {} : { error: listing.error }),
    read: (path) => github.raw(`${RAW}/${id}/${sha}/${encodePath(path)}`),
    // A symbolic link's content is its target.
    readLink: async (path) => {
      const bytes = await github.raw(`${RAW}/${id}/${sha}/${encodePath(path)}`);
      return bytes && new TextDecoder().decode(bytes).trim();
    },
  };
}

/** Code search looks at the whole default branch, 100 results a page; a failed page keeps the pages before it. */
async function searchPaths(github: Client, id: string): Promise<{ files: string[]; error?: string }> {
  const paths = new Set<string>(); // pages can repeat a result
  // GitHub returns at most 1000 results: ten pages.
  for (let page = 1; page <= 10; page++) {
    let result: { total_count: number; items: { path: string }[] };
    try {
      result = await github.json(`${API}/search/code?q=filename:SKILL.md+repo:${id}&per_page=100&page=${page}`);
    } catch (error) {
      return { files: [...paths], error: explained(error) };
    }
    for (const item of result.items) paths.add(item.path);
    if (result.items.length < 100 || page * 100 >= result.total_count) break;
  }
  return { files: [...paths] };
}

type Tree = { truncated: boolean; tree: { path: string; mode: string; type: string; sha: string }[] };

/** `error`: what stopped the listing before it ended. */
type Listing = { files: string[]; links: string[]; truncated: boolean; error?: string };

/** The whole tree at once, or only the skill roots when it is too large for one answer. */
async function listTree(github: Client, id: string, sha: string): Promise<Listing> {
  let tree: Tree;
  try {
    tree = await github.json<Tree>(`${API}/repos/${id}/git/trees/${sha}?recursive=1`);
  } catch (error) {
    return { files: [], links: [], truncated: false, error: explained(error) };
  }
  if (!tree.truncated) return { ...entries(tree, ''), truncated: false };
  return { ...(await listFolders(github, id, sha, SKILL_ROOTS)), truncated: true };
}

/**
 * The files and links in these folders, all of them at the same time; a missing folder adds nothing.
 * A folder that fails adds nothing either: the first one that does, in the given order, is the `error`.
 */
async function listFolders(github: Client, id: string, sha: string, folders: string[]): Promise<Omit<Listing, 'truncated'>> {
  const found = await Promise.all(
    folders.map(async (folder) => {
      try {
        const found = await directory(github, id, sha, folder);
        if (!found) return { files: [], links: [] };
        if ('link' in found) return { files: [], links: [found.link] };
        return entries(await github.json<Tree>(`${API}/repos/${id}/git/trees/${found.sha}?recursive=1`), `${folder}/`);
      } catch (error) {
        return { files: [], links: [], error: explained(error) };
      }
    }),
  );
  const error = found.find((item) => 'error' in item)?.error;
  return {
    files: found.flatMap((item) => item.files),
    links: [...new Set(found.flatMap((item) => item.links))],
    ...(error === undefined ? {} : { error }),
  };
}

/** A failure explained to the user, as its message; anything else is a bug, and goes on up. */
function explained(error: unknown): string {
  if (!(error instanceof AtlasError)) throw error;
  return error.message;
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

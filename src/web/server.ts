// The web interface's server: the page, and a scan as JSON. A thin client of the core, like the
// CLI; it keeps no result. spec/web.md.
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { firstSentence, type RulesStore } from '../commands.ts';
import { clusterSkills, type Ask, type ClusterInput } from '../core/cluster.ts';
import { AtlasError } from '../core/errors.ts';
import { parseGitHubOwnerUrl, parseGitHubUrl } from '../core/github.ts';
import { skillLink, type Repository, type Skill } from '../core/model.ts';
import { scanOrganization, type Organization, type OwnerListing } from '../core/organization.ts';
import { parseRules, type Rules } from '../core/rules.ts';
import { scan, type ScanResult, type Source } from '../core/scan.ts';
import { renderBody } from './render.ts';

export type WebOptions = {
  /** Opens a GitHub repository URL; once `signal` is aborted, no more is fetched for it. */
  open(url: string, signal: AbortSignal): Promise<Source>;
  /**
   * Opens a GitHub organization's (or user's) URL: every repository it has. Once `signal` is aborted,
   * no more is fetched for it. `listing` hears how far listing its repositories has got.
   */
  openOwner(url: string, signal: AbortSignal, listing?: (progress: OwnerListing) => void): Promise<Organization>;
  rules: RulesStore;
  /** Asks the model that groups skills by topic; once `signal` is aborted, the question is dropped. */
  cluster: Ask;
  /** Where the rules file's notes go: the server's stderr. */
  note(text: string): void;
};

const PUBLIC = new URL('./public/', import.meta.url);
const ASSETS: Record<string, { file: string; type: string }> = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/style.css': { file: 'style.css', type: 'text/css; charset=utf-8' },
};

// No inline script, nothing from elsewhere but images in a skill's body.
const HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' https: data:; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

export function createWebServer(options: WebOptions): Server {
  return createServer((request, response) => {
    handle(request, response, options).catch((error: unknown) => {
      if (response.headersSent) return void response.destroy();
      send(response, 500, { error: `Unexpected error: ${error instanceof Error ? error.message : String(error)}` });
    });
  });
}

/** Listens on 127.0.0.1 and returns the page's address; a port in use is the user's to fix. */
export async function listen(server: Server, port: number): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) =>
      reject(error.code === 'EADDRINUSE' ? new AtlasError(`Port ${port} is in use; try serve --port <n>`) : error),
    );
    server.listen(port, '127.0.0.1', resolve);
  });
  return `http://localhost:${(server.address() as AddressInfo).port}/`;
}

async function handle(request: IncomingMessage, response: ServerResponse, options: WebOptions) {
  // Only the page itself, not another site through a name that points here.
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(request.headers.host ?? '')) return send(response, 403, { error: 'Forbidden' });
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (url.pathname === '/api/cluster') return clusterRequest(request, response, options.cluster);
  if (request.method !== 'GET' && request.method !== 'HEAD') return send(response, 405, { error: 'Method not allowed' });
  if (url.pathname === '/api/scan') {
    const stream = /\bapplication\/x-ndjson\b/.test(request.headers.accept ?? '');
    return scanRequest(url.searchParams.get('url') ?? '', stream, response, options);
  }
  const asset = ASSETS[url.pathname];
  if (!asset) return send(response, 404, { error: `Not found: ${url.pathname}` });
  response.writeHead(200, { ...HEADERS, 'Content-Type': asset.type, 'Cache-Control': 'no-cache' });
  response.end(await readFile(new URL(asset.file, PUBLIC)));
}

async function scanRequest(input: string, stream: boolean, response: ServerResponse, { open, openOwner, rules, note }: WebOptions) {
  const name = parseGitHubUrl(input);
  const owner = name ? undefined : parseGitHubOwnerUrl(input);
  if (!input.trim()) return send(response, 400, { error: 'Paste a GitHub repository or organization URL' });
  if (!name && !owner) return send(response, 400, { error: `Not a GitHub repository or organization URL: ${input.trim()}` });
  // A page that goes away before its answer is done (a removed entry, a closed tab) stops its scan:
  // nothing more is fetched from GitHub for it.
  const gone = new AbortController();
  response.once('close', () => {
    if (!response.writableFinished) gone.abort();
  });
  try {
    // The rules first, as in the CLI: a broken rules file stops the scan before anything is fetched.
    const file = await rules.load(undefined, note);
    const parsed = parseRules(file.text, file.path);
    if (name && stream) return await streamRepository(await open(input, gone.signal), parsed, name.ref ?? '', response);
    if (name) return send(response, 200, repositoryAnswer(await scan(await open(input, gone.signal), parsed), name.ref ?? ''));
    if (stream) return await streamOrganization(input, parsed, response, openOwner, gone.signal);
    const organization = await openOwner(input, gone.signal);
    const result = await scanOrganization(organization, parsed);
    send(response, 200, {
      // An organization is one entry in the catalog, like a repository: the same source replaces it.
      source: result.owner.url,
      owner: result.owner,
      listed: result.listed,
      repositories: result.repositories.map((repository) => repositoryAnswer(repository, '')),
      warnings: result.warnings,
    });
  } catch (error) {
    if (gone.signal.aborted) return void response.destroy(); // no one to answer
    if (!(error instanceof AtlasError)) throw error;
    send(response, 422, { error: error.message });
  }
}

/** The most a page may send to be clustered: a large organization's skills, bodies and all. */
const CLUSTER_LIMIT = 8 * 1024 * 1024;

/**
 * `POST /api/cluster`, the skills as JSON: their topics. JSON only, so a page elsewhere cannot send
 * one without asking first, and this server never says yes. A page that goes away drops the question.
 */
async function clusterRequest(request: IncomingMessage, response: ServerResponse, ask: Ask) {
  if (request.method !== 'POST') return send(response, 405, { error: 'Method not allowed' });
  if (!/^application\/json\s*(;|$)/i.test(request.headers['content-type'] ?? '')) {
    return send(response, 415, { error: 'Send the skills as application/json' });
  }
  let text = '';
  for await (const chunk of request) {
    text += chunk;
    if (text.length > CLUSTER_LIMIT) {
      response.setHeader('Connection', 'close');
      return send(response, 413, { error: 'Too many skills to cluster at once' });
    }
  }
  const skills = clusterInputs(text);
  if (!skills) return send(response, 400, { error: 'Send { skills: [{ id, name, description, body }] }' });
  const gone = new AbortController();
  response.once('close', () => {
    if (!response.writableFinished) gone.abort();
  });
  try {
    send(response, 200, { clusters: await clusterSkills(skills, ask, gone.signal) });
  } catch (error) {
    if (gone.signal.aborted) return void response.destroy(); // no one to answer
    if (!(error instanceof AtlasError)) throw error;
    send(response, 422, { error: error.message });
  }
}

/** `{ skills: [{ id, name, description, body }] }`, each a string, each id once; else nothing. */
function clusterInputs(text: string): ClusterInput[] | undefined {
  let value: { skills?: unknown };
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  const skills = value?.skills;
  if (!Array.isArray(skills)) return undefined;
  const fields = ['id', 'name', 'description', 'body'] as const;
  if (!skills.every((skill) => typeof skill === 'object' && skill !== null && fields.every((field) => typeof skill[field] === 'string'))) return undefined;
  if (new Set(skills.map((skill) => skill.id)).size !== skills.length) return undefined;
  return skills.map((skill) => Object.fromEntries(fields.map((field) => [field, skill[field]])) as ClusterInput);
}

type Line = (body: unknown) => void;

/** The start of a line-at-a-time answer; once it is out, a failure can only be a line of its own. */
function startLines(response: ServerResponse): Line {
  response.writeHead(200, { ...HEADERS, 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
  // A page that went away, or stopped listening, hears nothing more.
  return (body: unknown) => {
    if (!response.writableEnded && !response.destroyed) response.write(`${JSON.stringify(body)}\n`);
  };
}

/**
 * A repository, a line at a time, so the page shows each skill as soon as it is read: the
 * repository first, then each skill, then the whole answer, as at once.
 */
async function streamRepository(source: Source, rules: Rules, ref: string, response: ServerResponse) {
  const line = startLines(response);
  const { repository } = source;
  line({ type: 'opened', ...repositoryHead(repository, ref) });
  try {
    const result = await scan(source, rules, (skill) => line({ type: 'skill', skill: skillAnswer(repository, skill) }));
    line({ type: 'done', scan: repositoryAnswer(result, ref) });
  } catch (error) {
    if (!(error instanceof AtlasError)) throw error;
    line({ type: 'error', error: error.message });
  }
  response.end();
}

/**
 * An organization, a line at a time, so the page shows how far it has got all along: how many
 * repositories are listed, and code search's SKILL.md files, while they are listed; then the owner,
 * each repository's skills as they are read and the repository once it is done; then the warnings.
 * Until the first line, a failure (an unknown owner) is answered as without lines.
 */
async function streamOrganization(input: string, rules: Rules, response: ServerResponse, openOwner: WebOptions['openOwner'], signal: AbortSignal) {
  let line: Line | undefined;
  try {
    const organization = await openOwner(input, signal, ({ owner, repositories, search }) =>
      (line ??= startLines(response))({ type: 'listing', source: owner.url, owner, repositories, ...(search ? { search } : {}) }));
    const write = (line ??= startLines(response));
    const { owner, listed, repositories } = organization;
    write({ type: 'organization', source: owner.url, owner, listed, scanning: repositories.length });
    const result = await scanOrganization(organization, rules, {
      found: (index, repository, skill) => write({ type: 'skill', index, ...repositoryHead(repository, ''), skill: skillAnswer(repository, skill) }),
      scanned: (index, scanned) =>
        write({ type: 'repository', index, repository: scanned && scanned.skills.length > 0 ? repositoryAnswer(scanned, '') : undefined }),
    });
    write({ type: 'done', warnings: result.warnings });
  } catch (error) {
    if (!line || !(error instanceof AtlasError)) throw error;
    line({ type: 'error', error: error.message });
  }
  response.end();
}

/** One repository's scan, as the page shows it: each skill with its link, its summary and its body made safe. */
function repositoryAnswer(result: ScanResult, ref: string) {
  return {
    ...repositoryHead(result.repository, ref),
    skills: result.skills.map((skill) => skillAnswer(result.repository, skill)),
    warnings: result.warnings,
    ...(result.error === undefined ? {} : { error: result.error }),
  };
}

function repositoryHead(repository: Repository, ref: string) {
  // What makes two scans the same repository: a new scan of it replaces the old one.
  return { source: `https://github.com/${repository.id}${ref ? `/tree/${ref}` : ''}`, ref, repository };
}

function skillAnswer(repository: Repository, { body, ...skill }: Skill) {
  const link = skillLink(repository, { ...skill, body });
  const raw = link.replace(`${repository.url}/blob/`, `https://raw.githubusercontent.com/${repository.id}/`);
  const root = { page: `${repository.url}/blob/${repository.commit}/`, raw: `https://raw.githubusercontent.com/${repository.id}/${repository.commit}/` };
  return { ...skill, summary: firstSentence(skill.description), link, html: renderBody(body, { page: link, raw }, root) };
}

function send(response: ServerResponse, status: number, body: unknown) {
  // Before the headers: a body that cannot be serialized is still a 500, not a crash.
  const text = JSON.stringify(body);
  response.writeHead(status, { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(text);
}

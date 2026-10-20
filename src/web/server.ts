// The web interface's server: the page, and a scan as JSON. A thin client of the core, like the
// CLI; it keeps no result. spec/web.md.
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { firstSentence, type RulesStore } from '../commands.ts';
import { AtlasError } from '../core/errors.ts';
import { parseGitHubOwnerUrl, parseGitHubUrl } from '../core/github.ts';
import { skillLink } from '../core/model.ts';
import { scanOrganization, type Organization } from '../core/organization.ts';
import { parseRules, type Rules } from '../core/rules.ts';
import { scan, type ScanResult, type Source } from '../core/scan.ts';
import { renderBody } from './render.ts';

export type WebOptions = {
  /** Opens a GitHub repository URL. */
  open(url: string): Promise<Source>;
  /** Opens a GitHub organization's (or user's) URL: every repository it has. */
  openOwner(url: string): Promise<Organization>;
  rules: RulesStore;
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
  try {
    // The rules first, as in the CLI: a broken rules file stops the scan before anything is fetched.
    const file = await rules.load(undefined, note);
    const parsed = parseRules(file.text, file.path);
    if (name) return send(response, 200, repositoryAnswer(await scan(await open(input), parsed), name.ref ?? ''));
    const organization = await openOwner(input);
    if (stream) return await streamOrganization(organization, parsed, response);
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
    if (!(error instanceof AtlasError)) throw error;
    send(response, 422, { error: error.message });
  }
}

/**
 * An organization, a line at a time, so the page adds each repository as soon as it is scanned:
 * the owner first, then each repository as it is done, then the warnings. Once the first line is
 * out, a failure can only be a line of its own.
 */
async function streamOrganization(organization: Organization, rules: Rules, response: ServerResponse) {
  response.writeHead(200, { ...HEADERS, 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
  const line = (body: unknown) => response.write(`${JSON.stringify(body)}\n`);
  const { owner, listed, repositories } = organization;
  line({ type: 'organization', source: owner.url, owner, listed, scanning: repositories.length });
  try {
    const result = await scanOrganization(organization, rules, (index, scanned) =>
      line({ type: 'repository', index, repository: scanned && scanned.skills.length > 0 ? repositoryAnswer(scanned, '') : undefined }),
    );
    line({ type: 'done', warnings: result.warnings });
  } catch (error) {
    if (!(error instanceof AtlasError)) throw error;
    line({ type: 'error', error: error.message });
  }
  response.end();
}

/** One repository's scan, as the page shows it: each skill with its link, its summary and its body made safe. */
function repositoryAnswer(result: ScanResult, ref: string) {
  const { repository } = result;
  return {
    // What makes two scans the same repository: a new scan of it replaces the old one.
    source: `https://github.com/${repository.id}${ref ? `/tree/${ref}` : ''}`,
    ref,
    repository,
    skills: result.skills.map(({ body, ...skill }) => {
      const link = skillLink(repository, { ...skill, body });
      const raw = link.replace(`${repository.url}/blob/`, `https://raw.githubusercontent.com/${repository.id}/`);
      const root = { page: `${repository.url}/blob/${repository.commit}/`, raw: `https://raw.githubusercontent.com/${repository.id}/${repository.commit}/` };
      return { ...skill, summary: firstSentence(skill.description), link, html: renderBody(body, { page: link, raw }, root) };
    }),
    warnings: result.warnings,
  };
}

function send(response: ServerResponse, status: number, body: unknown) {
  // Before the headers: a body that cannot be serialized is still a 500, not a crash.
  const text = JSON.stringify(body);
  response.writeHead(status, { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(text);
}

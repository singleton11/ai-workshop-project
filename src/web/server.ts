// The web interface's server: the page, and a scan as JSON. A thin client of the core, like the
// CLI; it keeps no result. spec/web.md.
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { firstSentence, type RulesStore } from '../commands.ts';
import { AtlasError } from '../core/errors.ts';
import { parseGitHubUrl } from '../core/github.ts';
import { skillLink } from '../core/model.ts';
import { parseRules } from '../core/rules.ts';
import { scan, type Source } from '../core/scan.ts';
import { renderBody } from './render.ts';

export type WebOptions = {
  /** Opens a GitHub repository URL. */
  open(url: string): Promise<Source>;
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
  if (url.pathname === '/api/scan') return scanRequest(url.searchParams.get('url') ?? '', response, options);
  const asset = ASSETS[url.pathname];
  if (!asset) return send(response, 404, { error: `Not found: ${url.pathname}` });
  response.writeHead(200, { ...HEADERS, 'Content-Type': asset.type, 'Cache-Control': 'no-cache' });
  response.end(await readFile(new URL(asset.file, PUBLIC)));
}

async function scanRequest(input: string, response: ServerResponse, { open, rules, note }: WebOptions) {
  const name = parseGitHubUrl(input);
  if (!input.trim()) return send(response, 400, { error: 'Paste a GitHub repository URL' });
  if (!name) return send(response, 400, { error: `Not a GitHub repository URL: ${input.trim()}` });
  try {
    // The rules first, as in the CLI: a broken rules file stops the scan before anything is fetched.
    const file = await rules.load(undefined, note);
    const parsed = parseRules(file.text, file.path);
    const result = await scan(await open(input), parsed);
    const { repository } = result;
    send(response, 200, {
      // What makes two scans the same repository: a new scan of it replaces the old one.
      source: `https://github.com/${repository.id}${name.ref ? `/tree/${name.ref}` : ''}`,
      ref: name.ref ?? '',
      repository,
      skills: result.skills.map(({ body, ...skill }) => {
        const link = skillLink(repository, { ...skill, body });
        const raw = link.replace(`${repository.url}/blob/`, `https://raw.githubusercontent.com/${repository.id}/`);
        const root = { page: `${repository.url}/blob/${repository.commit}/`, raw: `https://raw.githubusercontent.com/${repository.id}/${repository.commit}/` };
        return { ...skill, summary: firstSentence(skill.description), link, html: renderBody(body, { page: link, raw }, root) };
      }),
      warnings: result.warnings,
    });
  } catch (error) {
    if (!(error instanceof AtlasError)) throw error;
    send(response, 422, { error: error.message });
  }
}

function send(response: ServerResponse, status: number, body: unknown) {
  // Before the headers: a body that cannot be serialized is still a 500, not a crash.
  const text = JSON.stringify(body);
  response.writeHead(status, { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(text);
}

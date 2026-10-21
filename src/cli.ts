#!/usr/bin/env node
// The Node client: a GitHub repository, or an organization's, through the GitHub API, or a local directory; stdout and
// stderr, or the web interface. A scan's result is never stored; the only file written is the rules file.
import { run } from './commands.ts';
import { openGitHub, openGitHubOwner, parseGitHubOwnerUrl, parseGitHubUrl } from './core/github.ts';
import { openDirectory } from './local.ts';
import { rulesFile } from './rules-file.ts';
import { createWebServer, listen } from './web/server.ts';

const token = process.env.GITHUB_TOKEN || undefined;
const rules = rulesFile();

process.exitCode = await run(process.argv.slice(2), {
  open: (input) =>
    parseGitHubUrl(input) ? openGitHub(input, { fetch, token })
    : parseGitHubOwnerUrl(input) ? openGitHubOwner(input, { fetch, token })
    : openDirectory(input),
  print: (text) => console.log(text),
  error: (text) => console.error(text),
  rules,
  // A terminal gets the list laid out for reading; a pipe or a file, the plain lines. `NO_COLOR`, even empty: no colors.
  terminal: process.stdout.isTTY
    ? { columns: process.stdout.columns || 80, color: process.env.NO_COLOR === undefined && process.env.TERM !== 'dumb' }
    : undefined,
  serve: (port) =>
    listen(
      createWebServer({
        open: (url, signal) => openGitHub(url, { fetch, token, signal }),
        openOwner: (url, signal, listing) => openGitHubOwner(url, { fetch, token, signal }, listing),
        rules,
        note: (text) => console.error(text),
      }),
      port,
    ),
});

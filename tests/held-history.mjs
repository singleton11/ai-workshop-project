// For tests that run the CLI as its own process: load with `node --import <this file>`. GitHub
// answers from REPLAY (JSON: URL → status and body), except a file's history, which is held back
// until its request is aborted; each one held is a line `held <url>` on stderr.
import { readFileSync } from 'node:fs';

const saved = JSON.parse(readFileSync(process.env.REPLAY, 'utf8'));
const HISTORY = /^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/commits\?sha=/;

globalThis.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  const signal = init?.signal;
  signal?.throwIfAborted();
  if (HISTORY.test(url)) {
    process.stderr.write(`held ${url}\n`);
    return new Promise((_, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }));
  }
  if (!Object.hasOwn(saved, url)) throw new TypeError('fetch failed', { cause: new Error(`not in ${process.env.REPLAY}: ${url}`) });
  return new Response(saved[url].body, { status: saved[url].status });
};

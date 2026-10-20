// For demo videos only: GitHub as a recording needs it. Load with `node --import <this file>` or
// NODE_OPTIONS=--import=<this file>; it wraps the global fetch.
//   DROP_AFTER=<n>    the connection drops (fetch failed, ECONNRESET) after n files from
//                     raw.githubusercontent.com, counted from the start of each repository scan
//   DROP_FILE=<path>  the same, but n is read from the file at the start of each repository scan,
//                     so a running server can be switched; no file, or an empty one: no drop
//   LATENCY_MS=<ms>   each file waits ms to 2·ms, so cards arrive one by one
//   RECORD=<file>     adds every answer to the file (JSON: URL → status and body)
//   REPLAY=<file>     answers from the file instead of the network; a URL not in it fails
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const network = globalThis.fetch;
const latency = Number(process.env.LATENCY_MS ?? 0);
const { RECORD, REPLAY } = process.env;
const saved = REPLAY ? load(REPLAY) : RECORD && existsSync(RECORD) ? load(RECORD) : {};
let dropAfter = Infinity;
let read = 0;

function load(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function dropSetting() {
  if (process.env.DROP_FILE) return existsSync(process.env.DROP_FILE) ? readFileSync(process.env.DROP_FILE, 'utf8').trim() : '';
  return process.env.DROP_AFTER ?? '';
}

async function answer(url, init) {
  if (REPLAY) {
    if (!Object.hasOwn(saved, url)) throw new TypeError('fetch failed', { cause: new Error(`not in ${REPLAY}: ${url}`) });
    return new Response(saved[url].body, { status: saved[url].status });
  }
  const response = await network(url, init);
  if (RECORD) {
    saved[url] = { status: response.status, body: await response.clone().text() };
    writeFileSync(RECORD, JSON.stringify(saved, null, 1));
  }
  return response;
}

globalThis.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  // A repository scan starts with the repository itself.
  if (/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+$/.test(url)) {
    const value = dropSetting();
    dropAfter = value === '' ? Infinity : Number(value);
    read = 0;
  }
  if (url.startsWith('https://raw.githubusercontent.com/')) {
    if (latency) await new Promise((resolve) => setTimeout(resolve, latency * (1 + Math.random())));
    if (read >= dropAfter) throw new TypeError('fetch failed', { cause: new Error('read ECONNRESET') });
    read++;
  }
  return answer(url, init);
};

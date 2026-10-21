#!/usr/bin/env node
// For demo videos and visual tests only: `claude` as a recording needs it, for `scan --cluster` and
// *Group by topic*. Point SKILL_ATLAS_CLAUDE at this file; it takes claude's arguments and its stdin.
//   CLAUDE_RECORD=<file>    runs the real `claude` (or $CLAUDE_REAL) and saves its JSON answer in the file
//   CLAUDE_REPLAY=<file>    prints the saved answer instead, whatever the question: no model, no network
//   CLAUDE_DELAY_MS=<ms>    waits before answering, as a model does, so "Grouping by topic…" shows
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const { CLAUDE_RECORD, CLAUDE_REPLAY } = process.env;
const prompt = readFileSync(0, 'utf8');
await new Promise((resolve) => setTimeout(resolve, Number(process.env.CLAUDE_DELAY_MS ?? 0)));
if (CLAUDE_REPLAY) {
  process.stdout.write(readFileSync(CLAUDE_REPLAY, 'utf8'));
} else {
  const real = spawnSync(process.env.CLAUDE_REAL || 'claude', process.argv.slice(2), { input: prompt, encoding: 'utf8' });
  if (real.error) throw real.error;
  process.stderr.write(real.stderr);
  if (real.status === 0 && CLAUDE_RECORD) writeFileSync(CLAUDE_RECORD, real.stdout);
  process.stdout.write(real.stdout);
  process.exitCode = real.status ?? 1;
}

#!/usr/bin/env node
// `claude` for the tests: saves its arguments and stdin, then answers as FAKE_CLAUDE says.
//   FAKE_CLAUDE_LOG=<file>     where to save { args, prompt }
//   FAKE_CLAUDE_RESULT=<text>  the model's answer: printed as claude -p --output-format json does
//   FAKE_CLAUDE_ERROR=<text>   an error instead: is_error, and exit code 1
//   FAKE_CLAUDE_STDERR=<text>  printed on stderr, then exit code 2 with nothing on stdout
//   FAKE_CLAUDE_HANG=1         never answers, until it is killed
import { readFileSync, writeFileSync } from 'node:fs';

const env = process.env;
const prompt = readFileSync(0, 'utf8');
if (env.FAKE_CLAUDE_LOG) writeFileSync(env.FAKE_CLAUDE_LOG, JSON.stringify({ args: process.argv.slice(2), prompt }));
if (env.FAKE_CLAUDE_HANG) setInterval(() => {}, 1000);
else if (env.FAKE_CLAUDE_STDERR) {
  process.stderr.write(`${env.FAKE_CLAUDE_STDERR}\nmore detail\n`);
  process.exitCode = 2;
} else if (env.FAKE_CLAUDE_ERROR) {
  process.stdout.write(JSON.stringify({ type: 'result', is_error: true, result: env.FAKE_CLAUDE_ERROR }));
  process.exitCode = 1;
} else process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: env.FAKE_CLAUDE_RESULT ?? '[]' }));

// The model behind clustering, for the Node client: Claude Code's `claude -p` with a small model,
// no tools and no session kept. spec/clustering.md.
import { spawn } from 'node:child_process';
import { AtlasError } from './core/errors.ts';
import type { Ask } from './core/cluster.ts';

/** Claude Code's small model. */
export const MODEL = 'haiku';

export const CLAUDE_ARGS = ['-p', '--model', MODEL, '--output-format', 'json', '--tools', '', '--no-session-persistence'];

/** `claude -p`, or the program `$SKILL_ATLAS_CLAUDE` names; the prompt goes in on stdin. */
export function claude(command = process.env.SKILL_ATLAS_CLAUDE || 'claude'): Ask {
  return (prompt, signal) =>
    new Promise((resolve, reject) => {
      const child = spawn(command, CLAUDE_ARGS, { stdio: ['pipe', 'pipe', 'pipe'], signal });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
      child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
      child.stdin.on('error', () => {}); // a program that exits without reading it; its exit says why
      child.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
          reject(new AtlasError(`Clustering needs Claude Code: ${command} was not found; install it, or set SKILL_ATLAS_CLAUDE`));
        } else reject(signal?.aborted ? error : new AtlasError(`Clustering failed: ${command}: ${error.message}`));
      });
      child.on('close', (code) => {
        let answer: { result?: unknown; is_error?: unknown } | undefined;
        try {
          answer = JSON.parse(stdout);
        } catch {
          answer = undefined;
        }
        if (code === 0 && answer && !answer.is_error && typeof answer.result === 'string') return resolve(answer.result);
        const why = (typeof answer?.result === 'string' && answer.result) || stderr.trim() || stdout.trim() || `exit code ${code}`;
        reject(new AtlasError(`Clustering failed: ${command}: ${why.split('\n')[0]}`));
      });
      child.stdin.end(prompt);
    });
}

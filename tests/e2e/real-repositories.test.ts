// End to end: the real CLI on real GitHub repositories, each pinned to a commit, against a text
// snapshot of what it printed. Needs the network; GITHUB_TOKEN avoids the rate limit and does not
// change the output.
//
//   npm run test:e2e           compare with tests/e2e/snapshots/
//   npm run test:e2e:update    rewrite the snapshots
//   node --test --test-update-snapshots --test-name-pattern=koog tests/e2e/*.test.ts   only one
//
// To move a repository to a newer commit, change its commit below, then update and review the diff.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DEFAULT_RULES } from '../../src/core/rules.ts';
import { CLI } from '../helpers.ts';

const REPOSITORIES = [
  { repository: 'JetBrains/MPS', commit: 'd7e4f5c1394535b05e90dde6e3e7e8a3f3e174a2' },
  { repository: 'JetBrains/android', commit: '0a40d23123eb4d6d7842dee26cdf5b0d8a96ea78' },
  { repository: 'JetBrains/koog', commit: '22e342e033c716f835312dd6cbe83193e1cbcf76' },
];

const SNAPSHOTS = fileURLToPath(new URL('./snapshots', import.meta.url));
const update = process.execArgv.includes('--test-update-snapshots');

// A rules file that already exists, so the output does not depend on the machine's config folder.
const rulesFile = join(mkdtempSync(join(tmpdir(), 'skill-atlas-e2e-')), 'rules.yaml');
writeFileSync(rulesFile, DEFAULT_RULES);

for (const { repository, commit } of REPOSITORIES) {
  test(repository, { timeout: 120_000 }, () => {
    const args = ['scan', `github.com/${repository}/tree/${commit}`];
    const scanned = spawnSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      env: { ...process.env, SKILL_ATLAS_RULES: rulesFile },
    });
    assert.equal(scanned.error, undefined);
    // A scan that failed, say on the rate limit, is never a snapshot.
    assert.equal(scanned.status, 0, scanned.stderr);
    const actual = [
      `$ ./skill-atlas ${args.join(' ')}`,
      '--- stdout',
      scanned.stdout.trimEnd(),
      '--- stderr',
      scanned.stderr.trimEnd(),
      '',
    ].join('\n');

    const file = join(SNAPSHOTS, `${repository.replace('/', '-')}.txt`);
    if (update) {
      mkdirSync(SNAPSHOTS, { recursive: true });
      writeFileSync(file, actual);
      return;
    }
    assert.ok(existsSync(file), `no snapshot ${file}; run npm run test:e2e:update`);
    // Line by line, so a failure shows which skills changed.
    assert.deepEqual(actual.split('\n'), readFileSync(file, 'utf8').split('\n'), 'run npm run test:e2e:update if this is expected');
  });
}

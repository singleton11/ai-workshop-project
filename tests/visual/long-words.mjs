// The made-up repository of the issue #37 demo, example/long-words, added to net.json: words too
// long for the screen, with no space to break at, in a name and in a description (a docs URL).
// Not recorded: GitHub has no such repository. Run again after changing it: node tests/visual/long-words.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const NET = new URL('./net.json', import.meta.url);
const REPO = 'example/long-words';
const COMMIT = 'c0ffee0000000000000000000000000000000037';
const DATE = '2026-03-14T12:00:00Z';
const SKILLS = {
  'skills/docs-fetch/SKILL.md': skill(
    'docs-fetch',
    'Fetches the API reference from https://docs.example.com/reference/v2/organizations/projects/environments/deployments/rollouts/canary-analysis/metrics-and-thresholds.html before answering.',
  ),
  'skills/long-name/SKILL.md': skill('LongName'.repeat(20), `${'Word'.repeat(60)}. Then the rest.`),
  'skills/release-notes/SKILL.md': skill('release-notes', 'Write the release notes from the pull requests merged since the last tag. Use before a release.'),
};

function skill(name, description) {
  // An ordinary body: a long word in the body is issue #23 (the body stretching the grid on a phone).
  return `---\nname: ${name}\ndescription: ${description}\n---\n# Steps\n\nThe steps, in order.\n`;
}

const answer = (body) => ({ status: 200, body: typeof body === 'string' ? body : JSON.stringify(body) });
const net = JSON.parse(readFileSync(NET, 'utf8'));
for (const url of Object.keys(net)) if (url.includes(`/${REPO}/`) || url.endsWith(`/${REPO}`)) delete net[url];
net[`https://api.github.com/repos/${REPO}`] = answer({ full_name: REPO, default_branch: 'main' });
net[`https://api.github.com/repos/${REPO}/commits/main`] = answer({ sha: COMMIT });
net[`https://api.github.com/repos/${REPO}/git/trees/${COMMIT}?recursive=1`] = answer({
  sha: COMMIT,
  truncated: false,
  tree: Object.keys(SKILLS).map((path) => ({ path, mode: '100644', type: 'blob', sha: path })),
});
for (const [path, text] of Object.entries(SKILLS)) {
  net[`https://raw.githubusercontent.com/${REPO}/${COMMIT}/${path}`] = answer(text);
  net[`https://api.github.com/repos/${REPO}/commits?sha=${COMMIT}&path=${path}&per_page=1`] = answer([{ commit: { committer: { date: DATE } } }]);
}
writeFileSync(NET, JSON.stringify(net, null, 1));

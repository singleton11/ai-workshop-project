import { openGitHubOwner } from '/workspaces/ai-workshop-project/src/core/github.ts';
const t0 = Date.now();
const org = await openGitHubOwner('https://github.com/' + process.argv[2], { fetch, token: process.env.GITHUB_TOKEN }, (l) => console.log(((Date.now() - t0) / 1000).toFixed(1) + 's', JSON.stringify({ r: l.repositories, s: l.search })));
console.log('listed', org.listed, 'to scan', org.repositories.length, org.warnings, ((Date.now() - t0) / 1000).toFixed(1) + 's');

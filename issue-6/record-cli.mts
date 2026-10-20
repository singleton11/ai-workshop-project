// The real `run` (as src/cli.ts wires it) over live GitHub; every bugfix-workflow/SKILL.md raw read answers 500.
const root = process.argv[2];
const { run } = await import(`${root}/src/commands.ts`);
const { openGitHub } = await import(`${root}/src/core/github.ts`);
const { DEFAULT_RULES } = await import(`${root}/src/core/rules.ts`);
const faulty = async (url: string, init?: RequestInit) =>
  url.startsWith('https://raw.githubusercontent.com/') && url.endsWith('/bugfix-workflow/SKILL.md') ? new Response('injected', { status: 500 }) : fetch(url, init);
process.exitCode = await run(process.argv.slice(3), {
  open: (input: string) => openGitHub(input, { fetch: faulty, token: process.env.GITHUB_TOKEN }),
  print: (t: string) => console.log(t), error: (t: string) => console.error(t),
  rules: { load: async () => ({ path: '<default rules>', text: DEFAULT_RULES }), peek: async () => ({}) },
});

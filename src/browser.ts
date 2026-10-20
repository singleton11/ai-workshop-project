// The browser entry: the same commands, printed into the page, over live GitHub without a
// token. No Node APIs here.
import { run, type RulesStore } from './commands.ts';
import { AtlasError } from './core/errors.ts';
import { openGitHub, openGitHubOwner, parseGitHubOwnerUrl, type Fetch } from './core/github.ts';
import { DEFAULT_RULES } from './core/rules.ts';

/** No file in the browser: the default rules, built in. */
const builtInRules: RulesStore = {
  load: async (explicit) => {
    if (explicit) throw new AtlasError('--rules needs a file; there are no files here');
    return { path: '<default rules>', text: DEFAULT_RULES };
  },
  peek: async () => ({}),
};

export type BrowserOptions = {
  /** Live GitHub; the page's own fetch by default. */
  fetch?: Fetch;
};

export function createBrowserBackend(options: BrowserOptions = {}) {
  const live = options.fetch ?? ((url, init) => fetch(url, init));
  const open = (input: string) =>
    parseGitHubOwnerUrl(input) ? openGitHubOwner(input, { fetch: live }) : openGitHub(input, { fetch: live });

  return {
    /** Runs a typed command line, such as `skill-atlas scan <URL>`, and returns what it printed. */
    async run(commandLine: string): Promise<string> {
      const output: string[] = [];
      const write = (text: string) => output.push(text);
      try {
        await run(words(commandLine), { open, print: write, error: write, rules: builtInRules });
      } catch (error) {
        write(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
      }
      return output.join('\n');
    },
  };
}

/** The words of a command line; the leading `$` and `skill-atlas` are optional. */
function words(commandLine: string): string[] {
  const words = commandLine.trim().split(/\s+/).filter(Boolean);
  if (words[0] === '$') words.shift();
  if (words[0] === 'skill-atlas') words.shift();
  return words;
}

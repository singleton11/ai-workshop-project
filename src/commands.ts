// The skill-atlas commands. The same code serves the Node CLI and the browser
// terminal: everything that differs between them comes in through the context.
import { AtlasError } from './core/errors.ts';
import { skillLink, type Repository, type Skill } from './core/model.ts';
import { scanOrganization, type Organization, type OrganizationResult } from './core/organization.ts';
import { DEFAULT_RULES, parseRules } from './core/rules.ts';
import { scan, type Source } from './core/scan.ts';

/** Where the rules come from: a file for the CLI, the defaults in the browser. spec/rules.md. */
export type RulesStore = {
  /** The rules for a scan: `explicit` if given, else the user's file, created on the first scan. */
  load(explicit: string | undefined, note: (text: string) => void): Promise<{ path: string; text: string }>;
  /** The user's rules file, without creating it; no path where there is no file at all. */
  peek(): Promise<{ path?: string; text?: string }>;
};

export type Context = {
  /** Opens what the user asked to scan: a repository, or an organization's repositories. */
  open(input: string): Promise<Source | Organization>;
  print(text: string): void;
  /** Errors and warnings. */
  error(text: string): void;
  rules: RulesStore;
  /** Starts the web interface and returns its address; only the Node CLI has one. spec/web.md. */
  serve?(port: number): Promise<string>;
};

const usage = `Usage: skill-atlas <command>

  scan [--rules <file>] <GitHub URL | directory>   find every skill in a repository, or in all of an organization's, and print it
  rules [--defaults]                               show the rules file: what is a skill, and what is not
  serve [--port <n>]                               open the catalog in a browser, at http://localhost:4173/
  help                                             show this help`;

/** Runs one command; returns its exit code. */
export async function run(args: string[], context: Context): Promise<number> {
  const [command = 'help', ...rest] = args;
  try {
    if (command === 'scan') await scanCommand(rest, context);
    else if (command === 'rules') await rulesCommand(rest, context);
    else if (command === 'serve') await serveCommand(rest, context);
    else if (command === 'help') context.print(usage);
    else throw new AtlasError(`Unknown command: ${command}\n\n${usage}`);
    return 0;
  } catch (error) {
    if (!(error instanceof AtlasError)) throw error;
    context.error(error.message);
    return 1;
  }
}

async function scanCommand(args: string[], context: Context) {
  const usage = 'Usage: skill-atlas scan [--rules <file>] <GitHub URL | directory>';
  let explicit: string | undefined;
  const inputs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--rules') inputs.push(args[i]);
    else if (i + 1 < args.length && explicit === undefined) explicit = args[++i];
    else throw new AtlasError(usage);
  }
  if (inputs.length !== 1) throw new AtlasError(usage);
  // The rules first: a broken rules file stops the scan before anything is fetched.
  const file = await context.rules.load(explicit, context.error);
  const rules = parseRules(file.text, file.path);
  const opened = await context.open(inputs[0]);
  if ('repositories' in opened) return printOrganization(await scanOrganization(opened, rules), context);
  const result = await scan(opened, rules);
  printRepository(result.repository, result.skills, context);
  for (const warning of result.warnings) context.error(`warning: ${warning}`);
}

async function rulesCommand(args: string[], context: Context) {
  if (args.length === 1 && args[0] === '--defaults') return context.print(DEFAULT_RULES.trimEnd());
  if (args.length !== 0) throw new AtlasError('Usage: skill-atlas rules [--defaults]');
  const { path, text } = await context.rules.peek();
  if (!path) context.print('# the default rules; they cannot be changed here');
  else if (text === undefined) context.print(`# ${path} does not exist yet: the first scan creates it with these defaults`);
  else context.print(`# ${path}`);
  context.print((text ?? DEFAULT_RULES).trimEnd());
}

async function serveCommand(args: string[], context: Context) {
  const usage = 'Usage: skill-atlas serve [--port <n>]';
  let port = 4173;
  if (args.length === 2 && args[0] === '--port' && /^\d+$/.test(args[1]) && Number(args[1]) <= 65535) port = Number(args[1]);
  else if (args.length !== 0) throw new AtlasError(usage);
  if (!context.serve) throw new AtlasError('serve runs only from the command line');
  context.print(`Skill Atlas: ${await context.serve(port)}`);
}

/** `<owner>/<repo> · N skills`, then each skill's name, first sentence and link. */
function printRepository(repository: Repository, skills: Skill[], { print }: Context) {
  print(`${repository.id} · ${skills.length} ${skills.length === 1 ? 'skill' : 'skills'}`);
  for (const skill of skills) {
    print(skill.description ? `${skill.name} — ${firstSentence(skill.description)}` : skill.name);
    print(`  ${skillLink(repository, skill)}`);
    if (skill.copies.length > 0) print(`  also in ${skill.copies.join(', ')}`);
  }
}

/** `<owner> · N skills in M of K repositories`, then each repository with skills, as for one. */
function printOrganization(result: OrganizationResult, context: Context) {
  const skills = result.repositories.reduce((sum, repository) => sum + repository.skills.length, 0);
  context.print(`${result.owner.id} · ${organizationSummary(skills, result.repositories.length, result.listed)}`);
  for (const { repository, skills } of result.repositories) {
    context.print('');
    printRepository(repository, skills, context);
  }
  for (const { repository, warnings } of result.repositories) for (const warning of warnings) context.error(`warning: ${repository.id}: ${warning}`);
  for (const warning of result.warnings) context.error(`warning: ${warning}`);
}

/** `N skills in M of K repositories`: the CLI's and the page's. */
export function organizationSummary(skills: number, withSkills: number, listed: number): string {
  return `${skills} ${skills === 1 ? 'skill' : 'skills'} in ${withSkills} of ${listed} ${listed === 1 ? 'repository' : 'repositories'}`;
}

export function firstSentence(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return /^.*?[.!?](?=\s|$)/.exec(line)?.[0] ?? line;
}

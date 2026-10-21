// The skill-atlas commands. The same code serves the Node CLI and the browser
// terminal: everything that differs between them comes in through the context.
import { clusterSkills, type Ask } from './core/cluster.ts';
import { AtlasError } from './core/errors.ts';
import { skillLink, updatedDay, type Repository, type Skill } from './core/model.ts';
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
  /** Asks the model that groups skills by topic; only the Node CLI has one. spec/clustering.md. */
  cluster?: Ask;
  /** Set when `print` goes to a terminal: the list is laid out for reading there. spec/cli.md. */
  terminal?: Terminal;
};

/** A terminal `columns` wide; `color`, unless `NO_COLOR` or `TERM=dumb` say otherwise. */
export type Terminal = { columns: number; color: boolean };

const usage = `Usage: skill-atlas <command>

  scan [--rules <file>] [--filter <text>] [--cluster] <GitHub URL | directory>
                                  find every skill in a repository or organization; --filter keeps
                                  skills whose name, description or path contains the text;
                                  --cluster groups them by topic, with claude -p and a small model
  rules [--defaults]              show the rules file: what is a skill, and what is not
  serve [--port <n>]              open the catalog in a browser, at http://localhost:4173/
  help                            show this help`;

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
  const usage = 'Usage: skill-atlas scan [--rules <file>] [--filter <text>] [--cluster] <GitHub URL | directory>';
  let explicit: string | undefined;
  let filter: string | undefined;
  let cluster = false;
  const inputs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--rules' && i + 1 < args.length && explicit === undefined) explicit = args[++i];
    else if (args[i] === '--filter' && i + 1 < args.length && filter === undefined) filter = args[++i];
    else if (args[i] === '--cluster' && !cluster) cluster = true;
    else if (args[i] === '--rules' || args[i] === '--filter' || args[i] === '--cluster') throw new AtlasError(usage);
    else inputs.push(args[i]);
  }
  if (inputs.length !== 1) throw new AtlasError(usage);
  const ask = cluster ? context.cluster : undefined;
  if (cluster && !ask) throw new AtlasError('--cluster runs only from the command line');
  // The rules first: a broken rules file stops the scan before anything is fetched.
  const file = await context.rules.load(explicit, context.error);
  const rules = parseRules(file.text, file.path);
  const text = filter?.trim().toLowerCase() ?? '';
  const opened = await context.open(inputs[0]);
  if ('repositories' in opened) return printOrganization(await scanOrganization(opened, rules), context, text, ask);
  const result = await scan(opened, rules);
  const skills = text ? result.skills.filter((skill) => matches(skill, text)) : result.skills;
  // Grouped before anything is printed: a clustering that fails prints nothing but its error.
  const topics = ask && (await topicsOf(skills.map((skill) => ({ repository: result.repository, skill })), ask));
  printRepository(result.repository, skills, text ? result.skills.length : undefined, context, topics);
  for (const warning of result.warnings) context.error(`warning: ${warning}`);
  // What was read before the scan stopped is printed above; the error still makes it a failure.
  if (result.error !== undefined) throw new AtlasError(`scan incomplete: ${result.error}`);
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

/** `--filter`: the name, the description or the path contains the text, in any letter case. */
function matches(skill: Skill, text: string): boolean {
  return [skill.name, skill.description, skill.path].some((field) => field.toLowerCase().includes(text));
}

/**
 * `<owner>/<repo> · N skills` (`N of M skills` when filtered), then each skill's name and first
 * sentence; when it last changed, if that is known, and its link. In a terminal, an empty line
 * before each skill, the line with the name cut to the terminal's width, and colors.
 */
function printRepository(repository: Repository, skills: Skill[], total: number | undefined, context: Context, topics?: Topic[]) {
  const { print, terminal } = context;
  const count = total === undefined ? `${skills.length} ${skills.length === 1 ? 'skill' : 'skills'}` : `${skills.length} of ${total} skills`;
  const style = styles(terminal);
  print(`${style.bold(repository.id)} ${style.dim(`· ${count}`)}`);
  if (topics) printTopics(topics, context);
  else for (const skill of skills) printSkill(repository, skill, context);
}

/** Its name and first sentence; when it last changed, if that is known, and its link; its copies. */
function printSkill(repository: Repository, skill: Skill, { print, terminal }: Context) {
  const style = styles(terminal);
  if (terminal) print('');
  print(nameLine(skill, terminal, style));
  const day = updatedDay(skill);
  print(`  ${style.dim(`${day ? `updated ${day} · ` : ''}${skillLink(repository, skill)}`)}`);
  if (skill.copies.length > 0) print(`  ${style.dim(`also in ${skill.copies.join(', ')}`)}`);
}

/** A skill and the repository it is in: an organization's topics mix repositories. */
type Listed = { repository: Repository; skill: Skill };

/** A topic and its skills, by name, then id. */
type Topic = { topic: string; skills: Listed[] };

/** The skills, grouped by the model: the largest topic first. spec/clustering.md. */
async function topicsOf(listed: Listed[], ask: Ask): Promise<Topic[]> {
  const byId = new Map(listed.map((entry) => [entry.skill.id, entry]));
  const clusters = await clusterSkills(listed.map(({ skill }) => skill), ask);
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return clusters.map(({ topic, skills }) => ({
    topic,
    skills: skills.map((id) => byId.get(id)!).sort((a, b) => compare(a.skill.name, b.skill.name) || compare(a.skill.id, b.skill.id)),
  }));
}

/** After an empty line, `## <topic> · N skills`, then its skills. */
function printTopics(topics: Topic[], context: Context) {
  for (const { topic, skills } of topics) {
    context.print('');
    context.print(`## ${topic} · ${skills.length} ${skills.length === 1 ? 'skill' : 'skills'}`);
    for (const { repository, skill } of skills) printSkill(repository, skill, context);
  }
}

const plain = (text: string) => text;

/** ANSI colors in a terminal that has them; elsewhere, the text as it is. */
function styles(terminal: Terminal | undefined) {
  if (!terminal?.color) return { bold: plain, dim: plain, name: plain };
  const sgr = (code: string) => (text: string) => `\x1b[${code}m${text}\x1b[0m`;
  return { bold: sgr('1'), dim: sgr('2'), name: sgr('1;36') };
}

/**
 * `<name> — <first sentence>`, or the name alone without a description. In a terminal, cut to its
 * width: the sentence first; a name with no room left for any of it, the name alone, cut too.
 */
function nameLine(skill: Skill, terminal: Terminal | undefined, style: ReturnType<typeof styles>): string {
  const summary = skill.description ? firstSentence(skill.description) : '';
  if (!terminal) return summary ? `${skill.name} — ${summary}` : skill.name;
  const room = terminal.columns - columnsOf(skill.name) - 3;
  if (!summary || room < 1) return style.name(fit(skill.name, terminal.columns));
  return `${style.name(skill.name)} — ${fit(summary, room)}`;
}

/** The text, cut to `width` columns (at least 1) with `…` if wider. */
function fit(text: string, width: number): string {
  if (columnsOf(text) <= width) return text;
  let kept = '';
  let used = 0;
  for (const { segment } of graphemes.segment(text)) {
    const columns = graphemeColumns(segment);
    if (used + columns > Math.max(width, 1) - 1) break;
    kept += segment;
    used += columns;
  }
  return `${kept.trimEnd()}…`;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** The columns a terminal gives the text: 2 for a wide character (CJK, most emoji), 0 for a mark. */
function columnsOf(text: string): number {
  let columns = 0;
  for (const { segment } of graphemes.segment(text)) columns += graphemeColumns(segment);
  return columns;
}

function graphemeColumns(grapheme: string): number {
  if (/\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F|\p{Regional_Indicator}{2}/u.test(grapheme)) return 2;
  const code = grapheme.codePointAt(0)!;
  if (/^[\p{Cc}\p{Cf}\p{Mn}\p{Me}]/u.test(grapheme)) return 0;
  return isWide(code) ? 2 : 1;
}

/** East Asian Wide and Fullwidth (Unicode's EastAsianWidth.txt, W and F), emoji aside. */
function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) || // Hangul Jamo initials
    (code >= 0x2e80 && code <= 0x303e) || // CJK radicals, Kangxi, ideographic punctuation and space
    (code >= 0x3041 && code <= 0x33ff) || // Hiragana, Katakana, Bopomofo, Hangul compatibility, CJK symbols
    (code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
    (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
    (code >= 0xa000 && code <= 0xa4cf) || // Yi
    (code >= 0xa960 && code <= 0xa97f) || // Hangul Jamo Extended-A
    (code >= 0xac00 && code <= 0xd7a3) || // Hangul syllables
    (code >= 0xf900 && code <= 0xfaff) || // CJK compatibility ideographs
    (code >= 0xfe10 && code <= 0xfe19) || // vertical forms
    (code >= 0xfe30 && code <= 0xfe6f) || // CJK compatibility forms, small forms
    (code >= 0xff00 && code <= 0xff60) || // fullwidth forms
    (code >= 0xffe0 && code <= 0xffe6) || // fullwidth signs
    (code >= 0x16fe0 && code <= 0x16fe4) || // ideographic symbols
    (code >= 0x17000 && code <= 0x18aff) || // Tangut
    (code >= 0x1b000 && code <= 0x1b2ff) || // Kana supplement, extended, Nushu
    (code >= 0x1f200 && code <= 0x1f251) || // enclosed ideographic supplement
    (code >= 0x20000 && code <= 0x3fffd) // CJK Extensions B and later
  );
}

/**
 * `<owner> · N skills in M of K repositories`, then each repository with skills, as for one; then
 * `scan incomplete: <owner>/<repo>: <message>` for each repository that stopped partway.
 */
async function printOrganization(result: OrganizationResult, context: Context, filter = '', ask?: Ask) {
  const repositories = result.repositories
    .map((scanResult) => ({
      scanResult,
      skills: filter ? scanResult.skills.filter((skill) => matches(skill, filter)) : scanResult.skills,
    }))
    .filter(({ skills }) => skills.length > 0);
  const skills = repositories.reduce((sum, repository) => sum + repository.skills.length, 0);
  // One set of topics for the whole organization, its repositories mixed.
  const topics = ask && (await topicsOf(repositories.flatMap(({ scanResult, skills }) =>
    skills.map((skill) => ({ repository: scanResult.repository, skill }))), ask));
  const style = styles(context.terminal);
  context.print(`${style.bold(result.owner.id)} ${style.dim(`· ${organizationSummary(skills, repositories.length, result.listed)}`)}`);
  if (topics) printTopics(topics, context);
  else for (const { scanResult, skills } of repositories) {
    context.print('');
    printRepository(scanResult.repository, skills, filter ? scanResult.skills.length : undefined, context);
  }
  for (const { repository, warnings } of result.repositories) for (const warning of warnings) context.error(`warning: ${repository.id}: ${warning}`);
  for (const warning of result.warnings) context.error(`warning: ${warning}`);
  // A repository that stopped partway is printed with what it read, filtered out or not; the
  // organization scan is still a failure, as for one repository.
  const incomplete = result.repositories.filter(({ error }) => error !== undefined);
  if (incomplete.length > 0) {
    throw new AtlasError(incomplete.map(({ repository, error }) => `scan incomplete: ${repository.id}: ${error}`).join('\n'));
  }
}

/** `N skills in M of K repositories`: the CLI's and the page's. */
export function organizationSummary(skills: number, withSkills: number, listed: number): string {
  return `${skills} ${skills === 1 ? 'skill' : 'skills'} in ${withSkills} of ${listed} ${listed === 1 ? 'repository' : 'repositories'}`;
}

export function firstSentence(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return /^.*?[.!?](?=\s|$)/.exec(line)?.[0] ?? line;
}

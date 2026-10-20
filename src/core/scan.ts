import { AtlasError } from './errors.ts';
import { compare, findSkills, type Candidate } from './find.ts';
import { sortSkills, type Repository, type Skill } from './model.ts';
import { parseSkill } from './parse.ts';
import type { Rules } from './rules.ts';

/** A repository to scan: its files, and how to read them. */
export type Source = {
  repository: Repository;
  /** Every regular file path, relative to the repository root. */
  paths: string[];
  /** Every symbolic link's path, relative to the repository root. */
  links: string[];
  /** What listing the files had to leave out. */
  warnings: string[];
  /** What stopped the listing before it ended; the files listed before it are still scanned. */
  error?: string;
  /** The file's bytes, or undefined if it is not there. */
  read(path: string): Promise<Uint8Array | undefined>;
  /** A symbolic link's target, as the link says it, or undefined if it is not there. */
  readLink(path: string): Promise<string | undefined>;
};

export type ScanResult = {
  repository: Repository;
  skills: Skill[];
  warnings: string[];
  /** What stopped the scan before it ended: the skills and warnings are those found before it. */
  error?: string;
};

/**
 * fetch → find (rules) → parse. Nothing is stored: the result is all there is. A failure once the
 * repository is open does not lose what was read: it is the result's `error`.
 */
export async function scan(source: Source, rules: Rules): Promise<ScanResult> {
  // Everything is read at the same time: on GitHub, each one is a request.
  const links = await readAll(source.links, source.readLink);
  const targets = new Map<string, string>();
  for (const [link, target] of links.read) if (target !== undefined) targets.set(link, target);
  const found = findSkills(source.paths, targets, rules);
  const files = [...new Set(found.candidates.map((candidate) => candidate.file))];
  const read = await readAll(files, source.read);
  // A file that could not be read is not in `texts`; one that is not there is, as undefined.
  const texts = new Map<string, string | undefined>();
  for (const [file, bytes] of read.read) texts.set(file, normalize(bytes));
  const error = source.error ?? links.error ?? read.error;

  const warnings = [...source.warnings, ...found.warnings];
  // Identical SKILL.md files are one skill.
  const groups = new Map<string, Candidate[]>();
  for (const candidate of found.candidates) {
    const text = texts.get(candidate.file);
    if (text === undefined) continue;
    groups.set(text, [...(groups.get(text) ?? []), candidate]);
  }
  for (const file of files.sort(compare)) {
    if (texts.has(file) && texts.get(file) === undefined) warnings.push(`${file}: listed, but not found at the scanned commit; skipped`);
  }

  const skills: Skill[] = [];
  const parseWarnings: string[] = [];
  for (const [text, candidates] of groups) {
    const [main, ...copies] = candidates.map((candidate) => candidate.path).sort(byMainPath);
    const parsed = parseSkill(text);
    if (parsed.warning) parseWarnings.push(`${main}: ${parsed.warning}`);
    skills.push({
      id: `${source.repository.id}:${main}`,
      repository: source.repository.id,
      path: main,
      name: parsed.name ?? main.split('/').at(-2) ?? source.repository.name,
      description: parsed.description,
      commit: source.repository.commit,
      copies,
      properties: parsed.properties,
      body: parsed.body,
    });
  }
  warnings.push(...parseWarnings.sort(compare));
  if (rules.warnings.sameName) warnings.push(...sameNames(skills));
  return { repository: source.repository, skills: sortSkills(skills), warnings, ...(error === undefined ? {} : { error }) };
}

/**
 * Reads every path at the same time. A path whose read fails is left out of `read`; the first
 * failure, in path order, is the `error`. Only a failure explained to the user is caught.
 */
async function readAll<T>(paths: string[], read: (path: string) => Promise<T>): Promise<{ read: Map<string, T>; error?: string }> {
  const results = new Map<string, T>();
  const failures = new Map<string, string>();
  await Promise.all(
    paths.map(async (path) => {
      try {
        results.set(path, await read(path));
      } catch (error) {
        if (!(error instanceof AtlasError)) throw error;
        failures.set(path, error.message);
      }
    }),
  );
  const [first] = [...failures.keys()].sort(compare);
  return { read: results, error: first === undefined ? undefined : failures.get(first) };
}

/** Without a UTF-8 BOM, and with LF line endings: what makes two copies identical. */
function normalize(bytes: Uint8Array | undefined): string | undefined {
  if (!bytes) return undefined;
  return new TextDecoder().decode(bytes).replace(/\r\n/g, '\n');
}

/** The shortest path first; on a tie, code-unit order. */
function byMainPath(a: string, b: string): number {
  return a.length - b.length || compare(a, b);
}

function sameNames(skills: Skill[]): string[] {
  const byName = new Map<string, string[]>();
  for (const skill of skills) byName.set(skill.name, [...(byName.get(skill.name) ?? []), skill.path]);
  return [...byName]
    .filter(([, paths]) => paths.length > 1)
    .sort(([a], [b]) => compare(a, b))
    .map(([name, paths]) => `${name}: ${paths.length} different skills share this name: ${paths.sort(compare).join(', ')}`);
}

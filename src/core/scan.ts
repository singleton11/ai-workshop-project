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
  /** When the file last changed, ISO 8601 in UTC, or undefined if that is not known. */
  updated(path: string): Promise<string | undefined>;
};

export type ScanResult = {
  repository: Repository;
  skills: Skill[];
  warnings: string[];
  /** What stopped the scan before it ended: the skills and warnings are those found before it. */
  error?: string;
};

/**
 * fetch → find (rules) → parse. Nothing is stored: the result is all there is.
 * `found` hears of each skill as soon as it is certain and its date is read, before the scan is
 * done, in main path order: its id, name, main path and date are the result's; its copies are not
 * there yet. A failure once the repository is open does not lose what was read: it is the result's
 * `error`.
 */
export async function scan(source: Source, rules: Rules, found?: (skill: Skill) => void): Promise<ScanResult> {
  // Everything is read at the same time: on GitHub, each one is a request.
  const links = await readAll(source.links, source.readLink);
  const targets = new Map<string, string>();
  for (const [link, target] of links.read) if (target !== undefined) targets.set(link, target);
  const listed = findSkills(source.paths, targets, rules);
  // Identical SKILL.md files are one skill, at the first of their paths in this order: a skill is
  // certain once its path and every path before it are read.
  const candidates = [...listed.candidates].sort((a, b) => byMainPath(a.path, b.path));
  const files = [...new Set(candidates.map((candidate) => candidate.file))];
  const texts = new Map<string, string | undefined>();
  const fileErrors = new Map<string, string>();
  const byText = new Map<string, Skill>();
  const skills: Skill[] = [];
  const parseWarnings: string[] = [];
  const dateErrors = new Map<string, string>();
  // Each skill is heard of once its date is in, in the order the skills became certain.
  let heard = Promise.resolve();
  let next = 0;
  const advance = () => {
    for (; next < candidates.length && texts.has(candidates[next].file); next++) {
      const { path, file } = candidates[next];
      const text = texts.get(file);
      // A missing file or an unreadable one is left out. The latter still determines `error` below.
      if (text === undefined) continue;
      const known = byText.get(text);
      if (known) {
        known.copies.push(path);
        continue;
      }
      const parsed = parseSkill(text);
      if (parsed.warning) parseWarnings.push(`${path}: ${parsed.warning}`);
      const skill: Skill = {
        id: `${source.repository.id}:${path}`,
        repository: source.repository.id,
        path,
        name: parsed.name ?? path.split('/').at(-2) ?? source.repository.name,
        description: parsed.description,
        commit: source.repository.commit,
        updated: '',
        copies: [],
        properties: parsed.properties,
        body: parsed.body,
      };
      byText.set(text, skill);
      skills.push(skill);
      // The file read, not the path: a path through a symbolic link has no history of its own.
      const date = observed(readDate(source, file, dateErrors));
      heard = observed(heard.then(async () => {
        skill.updated = (await date) ?? '';
        found?.({ ...skill, copies: [] });
      }));
    }
  };
  await Promise.all(
    files.map(async (file) => {
      try {
        texts.set(file, normalize(await source.read(file)));
      } catch (error) {
        if (!(error instanceof AtlasError)) throw error;
        texts.set(file, undefined);
        fileErrors.set(file, error.message);
      }
      advance();
    }),
  );
  await heard;

  const [firstFailedFile] = [...fileErrors.keys()].sort(compare);
  const [firstFailedDate] = [...dateErrors.keys()].sort(compare);
  const error = source.error ?? links.error ??
    (firstFailedFile === undefined ? undefined : fileErrors.get(firstFailedFile)) ??
    (firstFailedDate === undefined ? undefined : dateErrors.get(firstFailedDate));
  const warnings = [...source.warnings, ...listed.warnings];
  for (const file of files.sort(compare)) {
    if (texts.has(file) && texts.get(file) === undefined && !fileErrors.has(file)) {
      warnings.push(`${file}: listed, but not found at the scanned commit; skipped`);
    }
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

/** When the file last changed; a failure leaves it unknown and goes into `errors`. */
async function readDate(source: Source, file: string, errors: Map<string, string>): Promise<string | undefined> {
  try {
    return await source.updated(file);
  } catch (error) {
    if (!(error instanceof AtlasError)) throw error;
    errors.set(file, error.message);
    return undefined;
  }
}

/**
 * The promise, its rejection handled from now on, yet still thrown to whoever awaits it. A cancelled
 * scan rejects every date being read: the first rejection stops `heard`, so the dates after it would
 * never be awaited, and an unhandled rejection ends the process; so would `heard` itself, once
 * reading a file has failed the scan before it is awaited.
 */
function observed<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => {});
  return promise;
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

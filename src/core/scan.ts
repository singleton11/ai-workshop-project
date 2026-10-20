import { compare, findSkills } from './find.ts';
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
  /** The file's bytes, or undefined if it is not there. */
  read(path: string): Promise<Uint8Array | undefined>;
  /** A symbolic link's target, as the link says it, or undefined if it is not there. */
  readLink(path: string): Promise<string | undefined>;
};

export type ScanResult = { repository: Repository; skills: Skill[]; warnings: string[] };

/**
 * fetch → find (rules) → parse. Nothing is stored: the result is all there is.
 * `found` hears of each skill as soon as it is certain, before the scan is done: its id, name and
 * main path are the result's, its copies those read so far. Not after the scan fails.
 */
export async function scan(source: Source, rules: Rules, found?: (skill: Skill) => void): Promise<ScanResult> {
  // Everything is read at the same time: on GitHub, each one is a request.
  const targets = new Map<string, string>();
  await Promise.all(
    source.links.map(async (link) => {
      const target = await source.readLink(link);
      if (target !== undefined) targets.set(link, target);
    }),
  );
  const listed = findSkills(source.paths, targets, rules);
  // Identical SKILL.md files are one skill, at the first of their paths in this order: a skill is
  // certain once its path and every path before it are read.
  const candidates = [...listed.candidates].sort((a, b) => byMainPath(a.path, b.path));
  const files = [...new Set(candidates.map((candidate) => candidate.file))];
  const texts = new Map<string, string | undefined>();
  const byText = new Map<string, Skill>();
  const skills: Skill[] = [];
  const parseWarnings: string[] = [];
  let next = 0;
  let failed = false;
  const advance = () => {
    for (; !failed && next < candidates.length && texts.has(candidates[next].file); next++) {
      const { path, file } = candidates[next];
      const text = texts.get(file);
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
        copies: [],
        properties: parsed.properties,
        body: parsed.body,
      };
      byText.set(text, skill);
      skills.push(skill);
      found?.({ ...skill, copies: [] });
    }
  };
  await Promise.all(
    files.map(async (file) => {
      try {
        texts.set(file, normalize(await source.read(file)));
      } catch (error) {
        failed = true; // the rest is not heard of
        throw error;
      }
      advance();
    }),
  );

  const warnings = [...source.warnings, ...listed.warnings];
  for (const file of files.sort(compare)) {
    if (texts.get(file) === undefined) warnings.push(`${file}: listed, but not found at the scanned commit; skipped`);
  }
  warnings.push(...parseWarnings.sort(compare));
  if (rules.warnings.sameName) warnings.push(...sameNames(skills));
  return { repository: source.repository, skills: sortSkills(skills), warnings };
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

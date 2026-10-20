import { judge, type Rules } from './rules.ts';

/** Where agents keep a repository's own skills: the only folders walked when a tree is too large. */
export const SKILL_ROOTS = ['.agents/skills', '.claude/skills', '.github/skills', 'agent/skills'];

/** A SKILL.md the rules accept: the path it is listed at, and the file it reads. */
export type Candidate = { path: string; file: string };

export type Found = { candidates: Candidate[]; warnings: string[] };

/**
 * Every SKILL.md, in any letter case, that the rules accept, at its own path and at every path a
 * symbolic link gives it. `targets` has each link's target, as the link says it.
 */
export function findSkills(files: string[], targets: Map<string, string>, rules: Rules): Found {
  const links = resolveLinks(files, targets);
  const candidates: Candidate[] = [];
  const reached = new Set<string>(); // files a link accepted by the rules reaches: no warning for them
  for (const resolved of links.resolved.values()) {
    for (const [path, file] of resolved) {
      if (!isSkillFile(path) || judge(rules, path).kind !== 'skill') continue; // a link the rules reject is ignored
      candidates.push({ path, file });
      reached.add(file);
    }
  }
  const warnings: string[] = [];
  for (const file of [...files].sort(compare)) {
    if (!isSkillFile(file)) continue;
    const verdict = judge(rules, file);
    if (verdict.kind === 'skill') candidates.push({ path: file, file });
    else if (reached.has(file)) continue;
    else if (verdict.kind === 'test-data' && rules.warnings.testData) warnings.push(`${file}: test data (matches "${verdict.pattern}")`);
    else if (verdict.kind === 'not-a-skill' && rules.warnings.notASkill) warnings.push(`${file}: not a skill (matches no skills pattern)`);
  }
  // A broken link only matters where a skill could be.
  for (const [link, problem] of links.broken) {
    const couldBeSkill = isSkillFile(link) ? judge(rules, link) : judge(rules, `${link}/SKILL.md`);
    if (couldBeSkill.kind === 'skill') warnings.push(`${link}: symbolic link ${problem}; skipped`);
  }
  return { candidates: candidates.sort((a, b) => compare(a.path, b.path)), warnings };
}

/** Named SKILL.md, in any letter case. */
export function isSkillFile(path: string): boolean {
  return path.split('/').at(-1)?.toLowerCase() === 'skill.md';
}

/** Code-unit order, whatever the locale. */
export function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

type Links = {
  /** For each link that works: every path it gives → the file that path reads. */
  resolved: Map<string, Map<string, string>>;
  /** For each link that does not: why. */
  broken: Map<string, string>;
};

type Target = { file: string } | { directory: string } | { problem: string };

function resolveLinks(files: string[], targets: Map<string, string>): Links {
  const fileSet = new Set(files);
  const directories = new Set<string>();
  for (const file of files) {
    const segments = file.split('/');
    for (let i = 1; i < segments.length; i++) directories.add(segments.slice(0, i).join('/'));
  }
  const memo = new Map<string, Target>();
  const visiting = new Set<string>();

  /** Where a path really is, following every link on the way. */
  function locate(path: string): Target {
    const segments = path.split('/');
    let real = '';
    for (let i = 0; i < segments.length; i++) {
      const next = real ? `${real}/${segments[i]}` : segments[i];
      if (targets.has(next)) {
        const target = follow(next);
        if ('problem' in target) return target;
        if ('file' in target) return i === segments.length - 1 ? target : { problem: 'points at nothing' };
        real = target.directory;
      } else real = next;
    }
    if (fileSet.has(real)) return { file: real };
    if (directories.has(real)) return { directory: real };
    return { problem: 'points at nothing' };
  }

  function follow(link: string): Target {
    const known = memo.get(link);
    if (known) return known;
    if (visiting.has(link)) return { problem: 'is a loop' };
    visiting.add(link);
    const target = targets.get(link) ?? '';
    const parent = link.split('/').slice(0, -1).join('/');
    const joined = normalize(parent ? `${parent}/${target}` : target);
    const result = target.startsWith('/') || joined === undefined ? { problem: 'points outside the repository' } : locate(joined);
    visiting.delete(link);
    memo.set(link, result);
    return result;
  }

  const resolved = new Map<string, Map<string, string>>();
  const broken = new Map<string, string>();
  for (const link of [...targets.keys()].sort(compare)) {
    const target = follow(link);
    if ('problem' in target) {
      broken.set(link, target.problem);
      continue;
    }
    const paths = new Map<string, string>();
    if ('file' in target) paths.set(link, target.file);
    else for (const file of files) if (file.startsWith(`${target.directory}/`)) paths.set(`${link}${file.slice(target.directory.length)}`, file);
    resolved.set(link, paths);
  }
  return { resolved, broken };
}

/** `a/./b/../c` → `a/c`; undefined if it climbs out of the repository. */
function normalize(path: string): string | undefined {
  const out: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (out.length === 0) return undefined;
      out.pop();
    } else out.push(segment);
  }
  return out.join('/');
}

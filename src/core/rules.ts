import { isMap, isScalar, isSeq, LineCounter, parseDocument, type Node } from 'yaml';
import { AtlasError } from './errors.ts';

/** Which SKILL.md files are skills: spec/rules.md. */
export type Rules = {
  skills: Pattern[];
  testData: Pattern[];
  warnings: { notASkill: boolean; testData: boolean; sameName: boolean };
};

/** A glob as the user wrote it, and what it matches. */
export type Pattern = { text: string; regex: RegExp };

/** What the rules say about one SKILL.md path. */
export type Verdict = { kind: 'skill' } | { kind: 'test-data'; pattern: string } | { kind: 'not-a-skill' };

/** The rules file written on the first scan. */
export const DEFAULT_RULES = `# skill-atlas rules: which SKILL.md files are skills. Edit freely.
# Patterns are globs on a SKILL.md's path from the scanned folder, in any letter case:
#   *  any part of one folder name     **  any number of folders, none included
# A SKILL.md is a skill if it matches a \`skills\` pattern and no \`test-data\` pattern.
version: 1
skills:
  - SKILL.md                 # the repository root
  - "**/skills/**/SKILL.md"  # under a skills folder, at any depth
test-data:
  - "**/test/**"
  - "**/tests/**"
  - "**/testdata/**"
  - "**/test-data/**"
  - "**/test_data/**"
  - "**/__tests__/**"
  - "**/fixture/**"
  - "**/fixtures/**"
  - "**/testresources/**"
  - "**/__snapshots__/**"
  - "**/node_modules/**"
  - "**/vendor/**"
  - "**/third_party/**"
warnings:
  not-a-skill: true   # a SKILL.md that matches no \`skills\` pattern
  test-data: true     # a SKILL.md that matches a \`test-data\` pattern
  same-name: true     # different skills with the same name
`;

const WARNINGS = { 'not-a-skill': 'notASkill', 'test-data': 'testData', 'same-name': 'sameName' } as const;
const KEYS = new Set(['version', 'skills', 'test-data', 'warnings']);

/** The rules in a rules file's text; a problem is `<path>:<line>: <problem>`. */
export function parseRules(text: string, path: string): Rules {
  const lines = new LineCounter();
  const document = parseDocument(text, { lineCounter: lines, prettyErrors: false });
  const fail = (offset: number | undefined, problem: string): never => {
    const line = offset === undefined ? 1 : lines.linePos(offset).line;
    throw new AtlasError(`${path}:${line}: ${problem}`);
  };
  const [error] = document.errors;
  if (error) fail(error.pos[0], `malformed YAML: ${error.message.split('\n')[0]}`);
  const defaults = path === DEFAULT_PATH ? undefined : parseRules(DEFAULT_RULES, DEFAULT_PATH);
  const rules: Rules = defaults
    ? { skills: defaults.skills, testData: defaults.testData, warnings: { ...defaults.warnings } }
    : { skills: [], testData: [], warnings: { notASkill: true, testData: true, sameName: true } };
  const root = document.contents;
  if (root === null || (isScalar(root) && root.value === null)) return rules; // an empty file
  if (!isMap(root)) return fail(root.range?.[0], 'the rules are not a mapping');
  for (const pair of root.items) {
    const keyNode = pair.key as Node | null;
    const key = isScalar(keyNode) ? String(keyNode.value) : '';
    const at = keyNode?.range?.[0];
    const value = pair.value as Node | null;
    if (!KEYS.has(key)) fail(at, `unknown key "${key}"`);
    if (key === 'version') {
      if (!isScalar(value) || value.value !== 1) fail(value?.range?.[0] ?? at, 'version must be 1');
    } else if (key === 'warnings') {
      if (!isMap(value)) return fail(value?.range?.[0] ?? at, 'warnings must be a mapping');
      for (const item of value.items) {
        const name = isScalar(item.key) ? String(item.key.value) : '';
        const itemAt = (item.key as Node | null)?.range?.[0];
        if (!Object.hasOwn(WARNINGS, name)) fail(itemAt, `unknown warning "${name}"`);
        const flag = item.value as Node | null;
        if (!isScalar(flag) || typeof flag.value !== 'boolean') fail(flag?.range?.[0] ?? itemAt, `${name} must be true or false`);
        rules.warnings[WARNINGS[name as keyof typeof WARNINGS]] = (flag as { value: boolean }).value;
      }
    } else {
      if (!isSeq(value)) return fail(value?.range?.[0] ?? at, `${key} must be a list of patterns`);
      const patterns = value.items.map((item) => {
        const node = item as Node | null;
        if (!isScalar(node) || typeof node.value !== 'string' || !node.value.trim()) {
          return fail(node?.range?.[0] ?? at, `${key}: a pattern must be a non-empty string`);
        }
        const problem = globProblem(node.value);
        if (problem) fail(node.range?.[0], `${key}: bad pattern "${node.value}": ${problem}`);
        return { text: node.value, regex: globToRegex(node.value) };
      });
      if (key === 'skills') rules.skills = patterns;
      else rules.testData = patterns;
    }
  }
  return rules;
}

const DEFAULT_PATH = '<default rules>';

/** The rules in DEFAULT_RULES. */
export function defaultRules(): Rules {
  return parseRules(DEFAULT_RULES, DEFAULT_PATH);
}

/** A SKILL.md path, relative to the scanned folder: `test-data` wins over `skills`. */
export function judge(rules: Rules, path: string): Verdict {
  const testData = rules.testData.find((pattern) => pattern.regex.test(path));
  if (testData) return { kind: 'test-data', pattern: testData.text };
  return rules.skills.some((pattern) => pattern.regex.test(path)) ? { kind: 'skill' } : { kind: 'not-a-skill' };
}

/** Only `*`, `**` and `?` are special; anything that looks like more is an error, not a surprise. */
function globProblem(glob: string): string | undefined {
  if (/[[\]{}\\]/.test(glob)) return 'only *, ** and ? are supported';
  if (glob.startsWith('/')) return 'paths are relative to the scanned folder; drop the leading /';
  if (/\*\*\*/.test(glob) || /[^/]\*\*|\*\*[^/]/.test(glob)) return '** must be a whole folder name';
  return undefined;
}

function globToRegex(glob: string): RegExp {
  let source = '';
  const segments = glob.split('/');
  segments.forEach((segment, index) => {
    const last = index === segments.length - 1;
    if (segment === '**') {
      source += last ? '.*' : '(?:[^/]+/)*';
      return;
    }
    source += segment.replace(/[.+^$()|]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
    if (!last) source += '/';
  });
  return new RegExp(`^${source}$`, 'i');
}

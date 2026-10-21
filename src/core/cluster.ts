// Skills grouped by topic: a small model reads each skill and names the groups. The core builds the
// question and checks the answer; who asks the model comes in from the client. spec/clustering.md.
import { AtlasError } from './errors.ts';

/** What the model reads of a skill: its id, to answer with, and what it says. */
export type ClusterInput = { id: string; name: string; description: string; body: string };

/** A topic and its skills' ids, as given. */
export type Cluster = { topic: string; skills: string[] };

/** Asks the model; resolves to its answer, as text. Once `signal` is aborted, the question is dropped. */
export type Ask = (prompt: string, signal?: AbortSignal) => Promise<string>;

/** Of each skill's body, only the start: enough to tell what it is about, and a prompt that stays small. */
export const BODY_LIMIT = 1500;

/** The topic of the skills the model left out. */
export const OTHER = 'Other';

/**
 * The skills, in topics: each skill in exactly one, the largest topic first, then by topic in
 * code-unit order. No skills, no question. An answer that is not the JSON asked for is an error.
 */
export async function clusterSkills(skills: ClusterInput[], ask: Ask, signal?: AbortSignal): Promise<Cluster[]> {
  if (skills.length === 0) return [];
  return clustersFrom(await ask(clusterPrompt(skills), signal), skills.map((skill) => skill.id));
}

export function clusterPrompt(skills: ClusterInput[]): string {
  const items = skills.map(({ id, name, description, body }) => ({
    id,
    name,
    description,
    body: body.length > BODY_LIMIT ? `${body.slice(0, BODY_LIMIT)}…` : body,
  }));
  return `Group these agent skills by topic: what each one helps with, from its name, description and body.
Use 2 to 8 topics. Give each topic a short Title Case name of 1 to 4 words. Put every skill id in exactly one topic.
Answer with JSON only, no prose and no code fence: [{"topic": "<name>", "skills": ["<id>", …]}, …]

Skills (JSON):
${JSON.stringify(items, null, 1)}
`;
}

/**
 * The model's answer, checked: unknown ids and a second mention of an id are dropped, the skills
 * left out go to `Other`, and empty topics are gone; topics with the same name are one.
 */
export function clustersFrom(answer: string, ids: string[]): Cluster[] {
  const parsed = parseAnswer(answer);
  const known = new Set(ids);
  const placed = new Set<string>();
  const topics = new Map<string, string[]>();
  for (const { topic, skills } of parsed) {
    const name = topic.replace(/\s+/g, ' ').trim() || OTHER;
    const members = topics.get(name) ?? [];
    for (const id of skills) {
      if (!known.has(id) || placed.has(id)) continue;
      placed.add(id);
      members.push(id);
    }
    topics.set(name, members);
  }
  const left = ids.filter((id) => !placed.has(id));
  if (left.length > 0) topics.set(OTHER, [...(topics.get(OTHER) ?? []), ...left]);
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return [...topics]
    .filter(([, members]) => members.length > 0)
    .map(([topic, members]) => ({ topic, skills: members }))
    .sort((a, b) => b.skills.length - a.skills.length || compare(a.topic, b.topic));
}

/** `[{ topic, skills }]`, in a code fence or after some words too: small models add them. */
function parseAnswer(answer: string): { topic: string; skills: string[] }[] {
  const start = answer.indexOf('[');
  const end = answer.lastIndexOf(']');
  let value: unknown;
  try {
    value = start === -1 ? undefined : JSON.parse(answer.slice(start, end + 1));
  } catch {
    value = undefined;
  }
  const valid = Array.isArray(value) && value.every((item) =>
    typeof item === 'object' && item !== null && typeof item.topic === 'string'
    && Array.isArray(item.skills) && item.skills.every((id: unknown) => typeof id === 'string'));
  if (!valid) throw new AtlasError(`Clustering failed: the model did not answer with topics: ${excerpt(answer)}`);
  return value as { topic: string; skills: string[] }[];
}

function excerpt(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > 120 ? `${line.slice(0, 120)}…` : line || '(nothing)';
}

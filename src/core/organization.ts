import { AtlasError, EmptyRepository, GitHubUnavailable } from './errors.ts';
import type { Rules } from './rules.ts';
import { scan, type ScanResult, type Source } from './scan.ts';

/** An organization or a user on GitHub: the owner of repositories. */
export type Owner = { id: string; url: string };

/** An owner's repositories, to scan one by one: spec/analysis.md. */
export type Organization = {
  owner: Owner;
  /** How many repositories it has, forks and archived ones left out. */
  listed: number;
  /** The listed repositories that may have skills, sorted by name; each is opened when it is scanned. */
  repositories: { id: string; open(): Promise<Source> }[];
  /** What listing the repositories had to leave out. */
  warnings: string[];
};

export type OrganizationResult = {
  owner: Owner;
  listed: number;
  /** The repositories with at least one skill, in the order they were listed; each with its own warnings. */
  repositories: ScanResult[];
  /** Everything else: the listing's, each failed repository's, and those of repositories without skills, `<repo>: <warning>`. */
  warnings: string[];
};

/** At most this many repositories are scanned at the same time: GitHub frowns on more. */
const AT_ONCE = 8;

/**
 * Each repository, as `scan` does it. A repository that fails is a warning and the rest go on;
 * an empty one has nothing to say. Rate limit, a rejected token or no network stops everything.
 * `scanned` hears of each repository as soon as it is done, in the order they finish: its place in
 * `organization.repositories`, and its result, or undefined if it failed or is empty.
 */
export async function scanOrganization(
  organization: Organization,
  rules: Rules,
  scanned?: (index: number, result: ScanResult | undefined) => void,
): Promise<OrganizationResult> {
  const results: (ScanResult | string | undefined)[] = [];
  let next = 0;
  let stopped = false;
  async function worker() {
    while (next < organization.repositories.length) {
      const index = next++;
      const repository = organization.repositories[index];
      try {
        results[index] = await scan(await repository.open(), rules);
      } catch (error) {
        if (error instanceof GitHubUnavailable || !(error instanceof AtlasError)) {
          next = organization.repositories.length; // the other workers stop too
          stopped = true; // and what they still finish is not heard of
          throw error;
        }
        results[index] = error instanceof EmptyRepository ? undefined : `${repository.id}: ${error.message}; skipped`;
      }
      const result = results[index];
      if (!stopped) scanned?.(index, typeof result === 'string' ? undefined : result);
    }
  }
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, organization.repositories.length) }, worker));

  const repositories: ScanResult[] = [];
  const warnings = [...organization.warnings];
  for (const result of results) {
    if (typeof result === 'string') warnings.push(result);
    else if (result && result.skills.length > 0) repositories.push(result);
    else if (result) warnings.push(...result.warnings.map((warning) => `${result.repository.id}: ${warning}`));
  }
  return { owner: organization.owner, listed: organization.listed, repositories, warnings };
}

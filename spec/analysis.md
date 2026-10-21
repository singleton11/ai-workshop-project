# Repository analysis

## Input

A **GitHub repository** URL, a **GitHub organization**'s URL (`https://github.com/<owner>`, a user's
too: [below](#an-organization)), or a local directory

## Output

Every `SKILL.md`: **name**, **description**, **link**, **last updated**

## Architecture

Core: fetch → find ([rules](rules.md)) → parse. The rules are an input to the core; the core never
reads or writes the rules file. CLI: a *thin client*; it loads the rules, or creates them.
Skill: id = `repo:path`, name, description, commit, last updated, the other front matter keys, the body.
Web: a thin client too, [web.md](web.md).

## Details

- **GitHub API**, no clone; *under 5 s* for intellij-community
- The name: front matter, else the directory
- The link pins the *scanned commit*
- **Last updated**: when the skill's `SKILL.md` last changed, ISO 8601 in UTC. On GitHub, the
  committer date of the last commit that changed the main path's file, up to the scanned commit
  (`GET /repos/<owner>/<repo>/commits?sha=<commit>&path=<file>&per_page=1`): one more API request
  per skill, not per copy. A main path through a symbolic link is dated by the file it leads to,
  since the link's path has no history of its own. In a local directory, the last commit that
  changed the file if Git has it and it has not changed since, else the file's modification time.
  No commit found → no date (empty).
- Malformed front matter → a *warning*, the scan goes on; so is one that refers to itself
  (`a: &m { self: *m }`)
- Unreachable repository → a clear message, exit code 1
- **An error partway does not lose what was read.** Once the repository and its commit are known,
  a failure (rate limit, no network, a connection that drops while an answer downloads, a GitHub
  error) while listing or reading the files ends the scan with that *error*, but the skills read
  before it are kept, with their warnings. Code search
  keeps the pages before the one that failed; a tree folder that fails adds nothing, the others do;
  a `SKILL.md` or link that cannot be read is left out, not warned about as missing; a skill whose
  date cannot be read is kept, without a date. After a failed
  code search, no symbolic links are looked for: they could point at a file it did not reach.
  The error is the first one: the listing's, else a link's, else a file's, else a date's, in path order.
  Before the commit is known there is nothing to keep: the error is all there is.

## An organization

`https://github.com/<owner>`, with or without the scheme, a trailing slash, a query or a fragment: every repository
the organization, or the user, owns is scanned, each as on its own, with the same rules.

- Forks and archived repositories are left out: a fork's skills are its upstream's, an archived
  repository's are no longer kept. *listed* counts the repositories that are left.
- Without `GITHUB_TOKEN`, each listed repository is listed through its tree; at 60 requests an hour,
  that is enough for a small organization only. With it, **one code search** over the owner
  (`filename:SKILL.md org:<owner>`, `user:` for a user) finds the `SKILL.md` files, and only the
  repositories it finds one in are opened: no request for the others. If the search cannot list
  them all (more than 1000 results, or GitHub says they are incomplete), a *warning*, and every
  listed repository is listed through its tree instead.
- The result: the repositories with at least one skill, sorted by name in any letter case, then
  code-unit order; each with its skills and warnings as for one repository.
- A repository that fails (it went away, an answer GitHub cannot give) is a *warning*,
  `<owner>/<repo>: <message>; skipped`, and the scan goes on; an empty one (no commit) is skipped
  without one. The warnings of a repository without skills are kept, `<owner>/<repo>: <warning>`.
- A repository scan that stops partway keeps its successfully read skills and warnings. If it has
  skills, its partial error stays with it (the CLI then fails: [cli](cli.md#output)); with no
  skills, its error is an organization warning.
- Rate limit, a rejected token or no network **stops** the scan: a clear message, exit code 1,
  nothing printed; every other repository would fail the same way.
- An unknown owner → `Organization or user not found: https://github.com/<owner>`, exit code 1.
- At most 8 repositories are scanned at the same time.

## What is a skill

A `SKILL.md`, in any letter case, that the [rules](rules.md) accept. By default:

- at the repository root: named from its front matter, else after the repository, or
- under a `skills` folder, at any depth: `.claude/skills/x`, `.cursor/skills/x`,
  `agent/skills/x`, `skills/x`, `libs/foo/.junie/skills/x`.
  A skill inside another skill is its own skill: `.claude/skills/a/examples/b` is `b`.

Not a skill: a `SKILL.md` that matches no `skills` pattern (`plugins/foo/resources/agent/SKILL.md`),
or that is test data. Each one gets a *warning*; the rules can turn each kind of warning off.

Paths are taken from the scanned folder. With the default rules, scanning skill-atlas itself
finds only the agent skills it keeps for working on it, in `.agents/skills/`, plus test-data
warnings for `fixture/`; scanning `./fixture` finds its skills.

## Duplicates

The [rules](rules.md) come first: only `SKILL.md` files they accept take part.
A copy in test data, or in a place that is not a skill, is neither listed nor shown as a copy.

- Two skills are **identical** if their `SKILL.md` bytes match once a UTF-8 BOM is removed
  and CRLF is turned into LF. Other files in the skill's folder are not compared.
- Identical skills are **one skill**. Its main path is the shortest one; on a tie, the one
  that sorts first (code-unit order). The link and the id use the main path; the other paths
  are its `copies`, in the same order. Because of this, a new, shorter copy changes the id.
  A path through a symbolic link counts like any other: if it is the shortest, it is the main path.
- Its name: the front matter, else the main path's folder. A front matter warning is given
  once, for the main path.
- A **symbolic link** to a file or folder in the repository is a copy of its target.
  The rules check the *link's* path:
     - a link the rules accept, with a target they don't (`.claude/skills/foo → ../../plugins/foo/agent`),
       is listed at the link's path, and its target gets no "not a skill" or "test data" warning;
     - a link the rules reject is ignored, without a warning;
     - a link that points outside the repository, at nothing, or around in a loop gets a *warning* and is skipped.
  A link's target is what the link says (on GitHub, a mode `120000` entry's content); what the target
  is, a file or a folder, comes from the file tree. With `GITHUB_TOKEN`, code search finds the files
  but not the links; the links are looked for in `.agents/skills`, `.claude/skills`, `.github/skills`,
  `agent/skills` and every outermost `skills` folder search found a skill in, not in the whole tree
  (alone, it takes seconds on intellij-community). A link elsewhere is found without a token only.
- **Same name, different content:** each group is listed, plus one warning per name:
  `<name>: N different skills share this name: <main paths>`. N counts groups, not files.
  `warnings.same-name: false` in the rules turns it off.
- Copies may be in different subprojects: `libs/a/.claude/skills/x` and `libs/b/.claude/skills/x`
  are one skill if they are identical.
- `SKILL.md` and `skill.md` in the same folder follow the same rules; there is no special case.

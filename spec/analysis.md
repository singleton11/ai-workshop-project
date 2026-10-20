# Repository analysis

## Input

A **GitHub repository** URL, or a local directory

## Output

Every `SKILL.md`: **name**, **description**, **link**

## Architecture

Core: fetch → find ([rules](rules.md)) → parse. The rules are an input to the core; the core never
reads or writes the rules file. CLI: a *thin client*; it loads the rules, or creates them.
Skill: id = `repo:path`, name, description, commit

## Details

- **GitHub API**, no clone; *under 5 s* for intellij-community
- The name: front matter, else the directory
- The link pins the *scanned commit*
- Malformed front matter → a *warning*, the scan goes on
- Unreachable repository → a clear message, exit code 1

## What is a skill

A `SKILL.md`, in any letter case, that the [rules](rules.md) accept. By default:

- at the repository root: named from its front matter, else after the repository, or
- under a `skills` folder, at any depth: `.claude/skills/x`, `.cursor/skills/x`,
  `agent/skills/x`, `skills/x`, `libs/foo/.junie/skills/x`.
  A skill inside another skill is its own skill: `.claude/skills/a/examples/b` is `b`.

Not a skill: a `SKILL.md` that matches no `skills` pattern (`plugins/foo/resources/agent/SKILL.md`),
or that is test data. Each one gets a *warning*; the rules can turn each kind of warning off.

Paths are taken from the scanned folder. With the default rules, scanning skill-atlas itself
finds 0 skills plus test-data warnings for `fixture/`; scanning `./fixture` finds its skills.

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

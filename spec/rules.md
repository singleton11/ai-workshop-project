# Rules

Which `SKILL.md` files are skills is set by **rules**: patterns the user can edit.
The rules are written once, on the first scan, and are never rewritten after that.

## Where they are

1. `--rules <file>`: this file, for this run only. It is never created; a missing file is an error.
2. Else `$SKILL_ATLAS_RULES`.
3. Else `$XDG_CONFIG_HOME/skill-atlas/rules.yaml`, by default `~/.config/skill-atlas/rules.yaml`
   (`%APPDATA%\skill-atlas\rules.yaml` on Windows).

## The first scan

- If there is no rules file in 2 or 3, the default rules are written there and stderr says once:
  `created <path> with the default rules; edit it to change what is a skill`.
  The scan goes on with these rules.
- The file is written all at once (temporary file → hard link), and an existing file is never
  overwritten, even by two first scans at the same moment.
- If the file cannot be written (read-only home, no home): a *warning*, and the scan uses the defaults.
- `rules` never creates it: it shows the file, or says it does not exist yet and shows the defaults.
- `help` and an unknown command write nothing.

## The defaults

```yaml
# skill-atlas rules: which SKILL.md files are skills. Edit freely.
# Patterns are globs on a SKILL.md's path from the scanned folder, in any letter case:
#   *  any part of one folder name     **  any number of folders, none included
# A SKILL.md is a skill if it matches a `skills` pattern and no `test-data` pattern.
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
  - "**/integration-tests/**"
warnings:
  not-a-skill: true   # a SKILL.md that matches no `skills` pattern
  test-data: true     # a SKILL.md that matches a `test-data` pattern
  same-name: true     # different skills with the same name
```

## How they apply

- Only files named `SKILL.md`, in any letter case, are ever considered. The rules decide which of them are skills.
- `test-data` wins over `skills`. To bring a folder back, delete its pattern.
- Letter case never matters, neither in the patterns nor in the paths.
- Only `*` (any part of one folder name), `**` (a whole folder name: any number of folders) and `?`
  (one character) are special. `[`, `]`, `{`, `}`, `\` and a leading `/` are errors, not surprises.
- A key left out keeps its default. `[]` means "none": `skills: []` finds 0 skills,
  and `test-data: []` treats nothing as test data.
- A symbolic link's path is checked by the rules on its own: a link at `.junie/skills/x`
  is a copy only if `.junie/skills/x/SKILL.md` is a skill.
- Every warning names the pattern behind it, so the user knows which line to edit:
  `warning: plugins/foo/resources/agent/SKILL.md: not a skill (matches no skills pattern)`
  `warning: src/test/.claude/skills/x/SKILL.md: test data (matches "**/test/**")`
- A broken symbolic link is only warned about where a skill could be: the link itself is a
  `SKILL.md` the rules accept, or `<link>/SKILL.md` would be.

## A broken rules file

Unknown key, wrong type, bad glob, `version` other than 1, malformed YAML:
`<path>:<line>: <problem>`, exit code 1, nothing is scanned. The defaults are **not** used instead,
because a scan the user did not ask for is worse than an error.

## New defaults in a later version

The user's file is kept as it is. `skill-atlas rules --defaults` prints the current defaults,
to compare with the file.

## In the browser

No file: the defaults are built in. `rules` prints them and says they cannot be changed there.

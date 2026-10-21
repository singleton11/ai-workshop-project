# Command line
`./skill-atlas scan [--rules <file>] [--filter <text>] [--cluster] <GitHub URL | directory>`: a repository, or
with `https://github.com/<owner>`, every repository of an [organization](analysis.md#an-organization).
`--filter <text>` keeps the skills whose name, description or path contains the text, in any letter
case, as the [web](web.md) filter box does; the first line says `N of M skills`. No match is not an
error: `0 of M skills`, exit code 0. Warnings are not filtered. An empty text keeps every skill.
`--cluster` groups the skills by topic, with `claude -p` and a small model: [clustering](clustering.md),
[below](#by-topic).
`./skill-atlas rules [--defaults]`: the rules file's path and content, or the current defaults.
`…/tree/<commit | branch | tag>` scans that ref instead of the default branch, always through the
file tree: code search sees only the default branch. An unknown ref → a clear message, exit code 1.
Prints the result **at once**; a scan's result is *never stored*. The only file skill-atlas
writes is the [rules](rules.md) file, on the first scan.
`GITHUB_TOKEN`, optional: a higher GitHub rate limit.
A scan that stopped partway ([analysis](analysis.md#details)) prints the skills it read, as usual
(`--filter` too), and its warnings; then `scan incomplete: <message>` on *stderr*, exit code 1.
## Output
```
JetBrains/kotlin · 6 skills
build-tools-bump-gradle-api — Bumps the Gradle API…
  updated 2026-03-14 · https://github.com/JetBrains/kotlin/blob/<commit>/…
```
- Sorted by **name**; the description's *first sentence*
- `updated <YYYY-MM-DD> · ` before the link: the day the skill [last changed](analysis.md#details),
  in UTC; left out when it is not known
- With `--filter`: `JetBrains/kotlin · 2 of 6 skills`, then only those two
- `also in <paths>` for identical copies and symbolic links, main path first; warnings go to *stderr*

An organization: a first line with the totals, then each repository with skills as above, after an
empty line. Its warnings are `warning: <owner>/<repo>: <warning>`. A repository that stopped partway
with skills is printed with them; after the warnings, `scan incomplete: <owner>/<repo>: <message>` on
*stderr* for each such repository, `--filter` or not, and exit code 1.
```
JetBrains · 8 skills in 2 of 412 repositories

JetBrains/koog · 2 skills
…

JetBrains/kotlin · 6 skills
…
```

With `--filter`, the organization totals and repository blocks count only matching skills; repositories
with no matches are omitted. Warnings and the total number of listed repositories are not filtered.

## By topic

With `--cluster`, the first line is the same; then each topic, after an empty line, as
`## <topic> · N skills`, and its skills as above. `--filter` comes first: only the matching skills
are clustered, and with none, the model is not asked. An organization's skills are clustered
together: a topic can hold skills of several repositories, each with its own link.
```
anthropics/skills · 19 skills

## File Formats · 4 skills
docx — Use this skill whenever the user wants to create, read, edit, or manipulate Word documents…
  updated 2026-07-17 · https://github.com/anthropics/skills/blob/<commit>/skills/docx/SKILL.md
…

## Web Development · 4 skills
…
```
A scan that stopped partway clusters the skills it read, then fails as usual. Clustering that fails
([clustering](clustering.md#claude-code)) prints nothing but its error, exit code 1.

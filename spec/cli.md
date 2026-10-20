# Command line
`./skill-atlas scan [--rules <file>] <GitHub URL | directory>`
`./skill-atlas rules [--defaults]`: the rules file's path and content, or the current defaults.
`…/tree/<commit | branch | tag>` scans that ref instead of the default branch, always through the
file tree: code search sees only the default branch. An unknown ref → a clear message, exit code 1.
Prints the result **at once**; a scan's result is *never stored*. The only file skill-atlas
writes is the [rules](rules.md) file, on the first scan.
`GITHUB_TOKEN`, optional: a higher GitHub rate limit.
## Output
```
JetBrains/kotlin · 6 skills
build-tools-bump-gradle-api — Bumps the Gradle API…
  https://github.com/JetBrains/kotlin/blob/<commit>/…
```
- Sorted by **name**; the description's *first sentence*
- `also in <paths>` for identical copies and symbolic links, main path first; warnings go to *stderr*

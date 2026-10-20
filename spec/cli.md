# Command line
`./skill-atlas scan <GitHub URL | directory>`
`…/tree/<commit | branch | tag>` scans that ref instead of the default branch, always through the
file tree: code search sees only the default branch. An unknown ref → a clear message, exit code 1.
Prints the result **at once**; *nothing is stored*.
`GITHUB_TOKEN`, optional: a higher GitHub rate limit.
## Output
```
JetBrains/kotlin · 6 skills
build-tools-bump-gradle-api — Bumps the Gradle API…
  https://github.com/JetBrains/kotlin/blob/<commit>/…
```
- Sorted by **name**; the description's *first sentence*
- `also in <paths>` for copies; warnings go to *stderr*

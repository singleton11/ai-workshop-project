# Skill Atlas

Every agent skill in a repository: `./skill-atlas scan` finds each `SKILL.md` and prints its name,
description and link.

```console
$ npm ci
$ ./skill-atlas scan https://github.com/JetBrains/kotlin
JetBrains/kotlin · 6 skills
…
build-tools-bump-gradle-api — Bumps the Gradle API version that Kotlin Gradle plugins are compiled against in the Kotlin compiler repository.
  https://github.com/JetBrains/kotlin/blob/5ab6270ab772d113e8ad52ebfcaa0109c522ae00/.claude/skills/build-tools-bump-gradle-api/SKILL.md
…
```

Set `GITHUB_TOKEN` for a higher GitHub rate limit. What is a skill, and what is test data, is set by
[rules](spec/rules.md): the first scan writes them to `~/.config/skill-atlas/rules.yaml`, yours to edit;
`./skill-atlas rules` shows them. `npm test` runs the tests.

`npm run test:e2e` scans real repositories, each pinned to a commit, and compares the output with
[tests/e2e/snapshots/](tests/e2e/snapshots/). It needs the network and, for the rate limit,
`GITHUB_TOKEN` (`GITHUB_TOKEN=$(gh auth token) npm run test:e2e`). After an intended change in the
output, or a new commit in [the test](tests/e2e/real-repositories.test.ts), `npm run test:e2e:update`
rewrites the snapshots; review them with `git diff`.

- [spec/](spec/): what it does. [AGENTS.md](AGENTS.md): the definition of done.
- [fixture/](fixture/README.md): a small repository for the tests.

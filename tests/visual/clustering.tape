# The CLI part of the issue #17 demo: scan --cluster groups the skills by topic.
# Run from the repository root through `npm run test:visual`; screenshots for Argos, video always.
Output tests/visual/results/cli-clustering.mp4
Set Shell bash
Set FontFamily "DejaVu Sans Mono"
Set FontSize 18
Set Width 1280
Set Height 800
Set Padding 28
Set LineHeight 1.25
Set Theme "Catppuccin Mocha"
Set TypingSpeed 0
Set CursorBlink false
Set WindowBar Colorful

Hide
Type "export NODE_OPTIONS=--import=$PWD/.agents/skills/record-feature-video/scripts/flaky.mjs REPLAY=$PWD/tests/visual/net.json SKILL_ATLAS_RULES=$PWD/tests/visual/rules.yaml GITHUB_TOKEN= SKILL_ATLAS_CLAUDE=$PWD/.agents/skills/record-feature-video/scripts/claude.mjs CLAUDE_REPLAY=$PWD/tests/visual/claude.json PS1='$ ' && clear"
Enter
Sleep 1s
Show

Type "# --cluster: claude -p --model haiku groups the skills by topic (its answer replayed here)"
Enter
Type "./skill-atlas scan --cluster https://github.com/anthropics/skills 2>/dev/null | grep -e '^##' -e '^anthropics'"
Enter
Sleep 4s
Screenshot tests/visual/screenshots/cli-clustering.png
Sleep 2s

Hide
Type "clear"
Enter
Sleep 500ms
Show
Type "# --filter comes first: only the matching skills are clustered; each with its date and link, as usual"
Enter
Type "./skill-atlas scan --filter design --cluster https://github.com/anthropics/skills 2>/dev/null"
Enter
Sleep 4s
Screenshot tests/visual/screenshots/cli-clustering-filter.png
Sleep 3s

Hide
Type "clear"
Enter
Sleep 500ms
Show
Type "# No Claude Code: a clear error, nothing else printed, exit code 1"
Enter
Type "SKILL_ATLAS_CLAUDE=claude-not-installed ./skill-atlas scan --cluster https://github.com/anthropics/skills; echo exit $?"
Enter
Sleep 3s
Screenshot tests/visual/screenshots/cli-clustering-error.png
Sleep 2s

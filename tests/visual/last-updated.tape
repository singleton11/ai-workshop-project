# The CLI part of the issue #13 demo: each skill's line with its link says when it last changed.
# Run from the repository root through `npm run test:visual`; screenshots for Argos, video always.
Output tests/visual/results/cli-last-updated.mp4
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
Type "export NODE_OPTIONS=--import=$PWD/.agents/skills/record-feature-video/scripts/flaky.mjs REPLAY=$PWD/tests/visual/net.json SKILL_ATLAS_RULES=$PWD/tests/visual/rules.yaml GITHUB_TOKEN= PS1='$ ' && clear"
Enter
Sleep 1s
Show

Type "# Each skill: the day its SKILL.md last changed (UTC), then its link"
Enter
Type "./skill-atlas scan https://github.com/anthropics/skills 2>/dev/null | head -n 11"
Enter
Sleep 4s
Screenshot tests/visual/screenshots/cli-last-updated.png
Sleep 2s

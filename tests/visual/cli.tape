# The CLI part of the demo: a scan that stops partway prints the skills it read, then the error.
# Run from the repository root through `npm run test:visual`; screenshots for Argos, video always.
Output tests/visual/results/cli.mp4
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

Type "# Simulated: the connection drops after 6 SKILL.md files; the skills read so far are kept"
Enter
Type "DROP_AFTER=6 ./skill-atlas scan https://github.com/anthropics/skills 2>&1 | tail -n 12"
Enter
Sleep 4s
Screenshot tests/visual/screenshots/cli-partial-scan.png
Sleep 2s

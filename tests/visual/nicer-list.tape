# The CLI part of the issue #16 demo: in a terminal, the list is laid out for reading.
# Run from the repository root through `npm run test:visual`; screenshots for Argos, video always.
Output tests/visual/results/cli-nicer-list.mp4
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

Type "# In a terminal: a gap between skills, names in bold, the rest dimmed, long sentences cut to fit"
Enter
Type "./skill-atlas scan --filter claude https://github.com/anthropics/skills 2>/dev/null"
Enter
Sleep 4s
Screenshot tests/visual/screenshots/cli-nicer-list.png
Sleep 2s
Hide
Type "clear"
Enter
Show
Type "# Into a pipe or a file: the same plain lines as before"
Enter
Type "./skill-atlas scan --filter claude https://github.com/anthropics/skills 2>/dev/null | cat"
Enter
Sleep 4s
Screenshot tests/visual/screenshots/cli-nicer-list-piped.png
Sleep 2s

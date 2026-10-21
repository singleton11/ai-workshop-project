# The CLI part of the issue #36 demo: a URL copied from GitHub with ?tab=… or #… is that repository.
# Run from the repository root through `npm run test:visual`; screenshots for Argos, video always.
Output tests/visual/results/cli-url-query.mp4
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

Type "# A URL copied from GitHub's address bar: the query and the fragment are ignored"
Enter
Type "./skill-atlas scan 'https://github.com/anthropics/skills?tab=readme-ov-file' 2>/dev/null | head -n 3; echo exit ${PIPESTATUS[0]}"
Enter
Sleep 4s
Type "./skill-atlas scan 'https://github.com/anthropics/skills#readme' 2>/dev/null | head -n 3; echo exit ${PIPESTATUS[0]}"
Enter
Sleep 4s
Screenshot tests/visual/screenshots/cli-url-query.png
Sleep 2s

# The CLI part of the issue #25 demo: an unknown ref is named for the user, not with GitHub's API error.
# Run from the repository root through `npm run test:visual`; screenshots for Argos, video always.
Output tests/visual/results/cli-unknown-ref.mp4
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

Type "# A branch, tag or commit that does not exist: a clear message, exit code 1"
Enter
Type "./skill-atlas scan https://github.com/anthropics/skills/tree/no-such-ref; echo exit $?"
Enter
Sleep 4s
Screenshot tests/visual/screenshots/cli-unknown-ref.png
Sleep 2s

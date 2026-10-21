# The CLI part of the issue #27 demo: a Japanese description's first sentence ends at 。
# Run from the repository root through `npm run test:visual`; screenshots for Argos, video always.
Output tests/visual/results/cli-cjk-sentence.mp4
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

Type "# Japanese sentences end with 。 and no space: the line shows the first one only"
Enter
Type "./skill-atlas scan --filter 専門家 https://github.com/Keiji-Miyake/kanon-ag/tree/bb73035a46ca92da3b81b9bcadff5e7722fec1f0 2>/dev/null"
Enter
Sleep 4s
Screenshot tests/visual/screenshots/cli-cjk-sentence.png
Sleep 2s

# The CLI part of the issue #26 demo: in a terminal, CJK and emoji lines are cut to its width in
# columns, as ASCII ones are. Run from the repository root through `npm run test:visual`.
Output tests/visual/results/cli-wide-characters.mp4
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
Type "tests/visual/wide-characters.sh /tmp/wide && export SKILL_ATLAS_RULES=$PWD/tests/visual/rules.yaml PS1='$ ' && clear"
Enter
Sleep 1s
Show

Type "# CJK and emoji take two columns each: every line is cut at the edge with …, none wraps"
Enter
Type "./skill-atlas scan /tmp/wide"
Enter
Sleep 4s
Screenshot tests/visual/screenshots/cli-wide-characters.png
Sleep 2s

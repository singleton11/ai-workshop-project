# The CLI part of the issue #35 demo: with an empty HOME (and a relative XDG_CONFIG_HOME) the first scan
# writes nothing into the current directory: a warning, and the default rules. Run from the repository
# root through `npm run test:visual`; screenshots for Argos, video always.
Output tests/visual/results/cli-empty-home.mp4
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
Type "tests/visual/empty-home.sh /tmp/empty-home /tmp/project && export ATLAS=$PWD PS1='$ ' && unset SKILL_ATLAS_RULES XDG_CONFIG_HOME && cd /tmp/empty-home && clear"
Enter
Sleep 1s
Show

Type "# HOME is empty: the first scan warns and uses the default rules; this folder stays empty"
Enter
Type `HOME= $ATLAS/skill-atlas scan /tmp/project; echo "exit=$?"; find . -type f`
Enter
Sleep 3s
Screenshot tests/visual/screenshots/cli-empty-home.png
Sleep 2s
Hide
Type "clear"
Enter
Sleep 500ms
Show
Type "# A relative XDG_CONFIG_HOME is ignored, as the XDG spec says: still nothing written here"
Enter
Type `HOME= XDG_CONFIG_HOME=relcfg $ATLAS/skill-atlas scan /tmp/project; echo "exit=$?"; find . -type f`
Enter
Sleep 3s
Screenshot tests/visual/screenshots/cli-empty-home-relative.png
Sleep 2s

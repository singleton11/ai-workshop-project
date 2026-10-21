# The CLI part of the issue #21 demo: control characters in a SKILL.md are shown as �, so a
# repository cannot clear the terminal or fake a line. Run from the repository root through
# `npm run test:visual`; screenshots for Argos, video always.
Output tests/visual/results/cli-control-characters.mp4
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

# A local repository with hostile names, its files dated so the output is the same every run.
# YAML's double quotes turn \e into ESC, \a into BEL and \n into a newline.
Hide
Type "export SKILL_ATLAS_RULES=$PWD/tests/visual/rules.yaml GITHUB_TOKEN= PS1='$ ' H=/tmp/hostile && rm -rf $H && mkdir -p $H/skills/a $H/skills/b $H/skills/c"
Enter
Type `printf -- '---\nname: "\\e[2J\\e[Hgood-skill\\e]8;;https://evil.example\\a"\ndescription: Looks harmless.\n---\n' > $H/skills/a/SKILL.md`
Enter
Type `printf -- '---\nname: "real\\nfake — injected line"\ndescription: Second.\n---\n' > $H/skills/b/SKILL.md`
Enter
Type `printf -- '---\nname: aaa-first\ndescription: An ordinary skill, printed first.\n---\n' > $H/skills/c/SKILL.md`
Enter
Type "find $H -exec touch -d 2026-10-21T00:00:00Z {} + && clear"
Enter
Sleep 1s
Show

Type "# A repository's SKILL.md names: escape codes that clear the screen, and a newline"
Enter
Type "grep -h name: /tmp/hostile/skills/*/SKILL.md"
Enter
Sleep 2s
Screenshot tests/visual/screenshots/cli-control-characters-names.png
Sleep 1s
Type "# Each control character is shown as �: nothing is cleared, one skill is one name line"
Enter
Type "./skill-atlas scan /tmp/hostile"
Enter
Sleep 4s
Screenshot tests/visual/screenshots/cli-control-characters.png
Sleep 2s

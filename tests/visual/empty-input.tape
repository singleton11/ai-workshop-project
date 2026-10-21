# The CLI part of the issue #22 demo: `scan ""`, as `scan "$URL"` gives with URL unset, is the usage, not a scan.
# Run from the repository root through `npm run test:visual`; screenshots for Argos, video always.
Output tests/visual/results/cli-empty-input.mp4
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
Type "export NODE_OPTIONS=--import=$PWD/.agents/skills/record-feature-video/scripts/flaky.mjs REPLAY=$PWD/tests/visual/net.json SKILL_ATLAS_RULES=$PWD/tests/visual/rules.yaml GITHUB_TOKEN= PS1='$ ' && unset URL && clear"
Enter
Sleep 1s
Show

Type `# URL is not set, so scan "$URL" is scan "": the usage and exit code 1, not a scan of this directory`
Enter
Type `./skill-atlas scan "$URL"; echo "exit=$?"`
Enter
Sleep 3s
Screenshot tests/visual/screenshots/cli-empty-input.png
Sleep 2s
Hide
Type "clear"
Enter
Sleep 500ms
Show
Type "# With URL set, the same command scans it, as before"
Enter
Type "URL=https://github.com/anthropics/skills"
Enter
Type `./skill-atlas scan --filter claude "$URL" 2>/dev/null; echo "exit=$?"`
Enter
Sleep 4s
Screenshot tests/visual/screenshots/cli-empty-input-set.png
Sleep 2s

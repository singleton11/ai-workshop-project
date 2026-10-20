# The terminal part of the PR #7 video: before and after, the connection dropping after 6 files.
# In the work dir, with before/ (the commit before the feature) and after/ (the checkout): vhs cli.tape
Output cli.mp4
Set Shell bash
Set FontSize 18
Set Width 1280
Set Height 800
Set Padding 28
Set LineHeight 1.25
Set Theme "Catppuccin Mocha"
Set TypingSpeed 35ms
Set WindowBar Colorful

Hide
Type "export NODE_OPTIONS=--import=$PWD/flaky.mjs PS1='\[\e[32m\]$\[\e[0m\] ' && clear"
Enter
Sleep 1s
Show

Type "# DROP_AFTER=6 simulates the network dropping after 6 SKILL.md files"
Enter
Sleep 1s
Type "# Before PR #7: the scan fails and every skill read so far is lost"
Enter
Sleep 800ms
Type "DROP_AFTER=6 before/skill-atlas scan https://github.com/anthropics/skills; echo exit $?"
Sleep 500ms
Enter
Sleep 7s

Hide
Type "clear"
Enter
Show
Type "# After PR #7: the skills read before the drop are printed, then the error"
Enter
Sleep 800ms
Type "DROP_AFTER=6 after/skill-atlas scan https://github.com/anthropics/skills; echo exit $?"
Sleep 500ms
Enter
Sleep 9s

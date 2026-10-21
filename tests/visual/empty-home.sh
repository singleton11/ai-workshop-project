#!/bin/sh
# The issue #35 demo: an empty folder to run from, $1, and one skill to scan in $2. Fixed date, so
# every take is the same.
set -e
rm -rf "$1" "$2"
mkdir -p "$1" "$2/skills/notes"
printf -- '---\nname: notes\ndescription: Keep meeting notes. Next.\n---\n' > "$2/skills/notes/SKILL.md"
touch -d 2026-03-14T12:00:00Z "$2/skills/notes/SKILL.md"

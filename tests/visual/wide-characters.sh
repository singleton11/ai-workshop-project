#!/bin/sh
# The skills of the issue #26 demo, in $1: names and descriptions in CJK and emoji, and an ASCII one
# for comparison, each line wider than the terminal. Fixed dates, so every take is the same.
set -e
rm -rf "$1"
skill() {
  mkdir -p "$1/skills/$2"
  printf -- '---\nname: %s\ndescription: %s\n---\n' "$3" "$4" > "$1/skills/$2/SKILL.md"
  touch -d 2026-03-14T12:00:00Z "$1/skills/$2/SKILL.md"
}
skill "$1" ascii meeting-notes 'Keep notes of every meeting, decision and follow-up in the docs folder of this repository, sorted by date and by the team that owns them. Next.'
skill "$1" japanese 日本語のスキル '日本語の説明文はとても長いのでターミナルの幅を超えてしまいますが、この行は端で切られて三点リーダーで終わるべきです。'
skill "$1" korean 한국어-기술 '이 설명은 매우 길어서 터미널의 너비를 넘어서지만 끝에서 잘리고 말줄임표로 끝나야 합니다 그래서 한 줄에 맞도록 마지막 부분이 잘립니다. 다음 문장.'
skill "$1" chinese 中文技能 '这个描述非常长，超过了终端的宽度，所以应该在边缘被截断，并以省略号结尾，而不是换到下一行显示，就像英文的那一行一样，在同一列结束。'
skill "$1" emoji '🚀 release' 'Ship a release 📦 with notes and a changelog 📝, then tell the team 📣🎉 in the channel, with links to every pull request merged since the last one. Next.'

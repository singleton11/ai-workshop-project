#!/usr/bin/env bash
# stitch.sh <out.mp4> <clip>...: the clips as one 1280x800, 30 fps H.264 video, with a 0.6 s fade
# between them; and <out>.contact.png, 8 frames spread over it, to check it without a player.
set -euo pipefail
out=$1
shift
fade=0.6
inputs=()
filter=''
last=''
offset=0
i=0
for clip in "$@"; do
  inputs+=(-i "$clip")
  duration=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$clip")
  filter+="[$i:v]fps=30,scale=1280:800:force_original_aspect_ratio=decrease,pad=1280:800:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p,setpts=PTS-STARTPTS[c$i];"
  if [ "$i" -eq 0 ]; then
    last=c0
    offset=$duration
  else
    offset=$(awk -v a="$offset" -v f="$fade" 'BEGIN { printf "%.3f", a - f - 0.05 }')
    filter+="[$last][c$i]xfade=transition=fade:duration=$fade:offset=$offset[x$i];"
    last=x$i
    offset=$(awk -v a="$offset" -v d="$duration" 'BEGIN { printf "%.3f", a + d }')
  fi
  i=$((i + 1))
done
ffmpeg -v error -y "${inputs[@]}" -filter_complex "${filter%;}" -map "[$last]" \
  -c:v libx264 -crf 20 -preset slow -pix_fmt yuv420p -movflags +faststart "$out"
total=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$out")
ffmpeg -v error -y -i "$out" -vf "fps=8/$total,scale=640:-1,tile=4x2" -frames:v 1 "${out%.*}.contact.png"
echo "$out ($(printf '%.0f' "$total") s), ${out%.*}.contact.png"

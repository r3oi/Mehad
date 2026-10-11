#!/usr/bin/env bash
# The three idea stings for both logos: cues → sound → 16:9 + 1:1 with audio.
# usage: ./render_ideas.sh [mash-mehad risk-aim …]   (default: all six)
set -euo pipefail
cd "$(dirname "$0")"
LIST=${*:-"mash-mehad mash-aim risk-mehad risk-aim kapsul-mehad kapsul-aim"}
for B in $LIST; do
  node render.mjs "$B" 16x9 cues >/dev/null
  python3 tools/sound2.py "out/${B}_cues.json" "out/${B}.wav"
  node render.mjs "$B" 16x9 "out/${B}_16x9_silent.mp4" >/dev/null & node render.mjs "$B" 1x1 "out/${B}_1x1_silent.mp4" >/dev/null & wait
  for F in 16x9 1x1; do
    ffmpeg -y -loglevel error -i "out/${B}_${F}_silent.mp4" -i "out/${B}.wav" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 320k -ar 48000 -shortest -movflags +faststart "out/${B}_${F}.mp4"
    echo "done out/${B}_${F}.mp4"
  done
done

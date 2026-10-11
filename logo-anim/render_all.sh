#!/usr/bin/env bash
# Full render for one brand: cue sheet → sound → 16:9 and 1:1 masters with audio.
# usage: ./render_all.sh mehad
set -euo pipefail
cd "$(dirname "$0")"
B=${1:-mehad}
node render.mjs "$B" 16x9 cues
python3 tools/sound.py "out/${B}_cues.json" "out/${B}.wav"
for F in 16x9 1x1; do
  node render.mjs "$B" "$F" "out/${B}_${F}_silent.mp4"
  ffmpeg -y -loglevel error -i "out/${B}_${F}_silent.mp4" -i "out/${B}.wav" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 320k -ar 48000 -shortest -movflags +faststart "out/${B}_logo_${F}.mp4"
  echo "out/${B}_logo_${F}.mp4"
done

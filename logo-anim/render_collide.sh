#!/usr/bin/env bash
# AIM × "Collide" masters: 3840×2160 and 2160×2160 at 60 fps, rendered once on a transparent
# ground, then encoded as a lossless alpha MOV (+ a small VP9 alpha WebM) and as MP4s on a light
# and a dark ground.
set -euo pipefail
cd "$(dirname "$0")"
B=collide-aim; export SCALE=2 FPS=60 ALPHA=1
node render.mjs $B 16x9 cues >/dev/null
python3 tools/sound2.py out/${B}_cues.json out/${B}.wav
node render.mjs $B 16x9 work/${B}_16x9/ >/dev/null & node render.mjs $B 1x1 work/${B}_1x1/ >/dev/null & wait
for F in 16x9 1x1; do
  S=$([ $F = 1x1 ] && echo 2160x2160 || echo 3840x2160)
  ffmpeg -y -loglevel error -framerate 60 -i work/${B}_${F}/f%04d.png -i out/${B}.wav -map 0:v -map 1:a \
    -c:v png -pix_fmt rgba -c:a pcm_s16le -shortest out/${B}_${F}_alpha.mov
  # a small transparent copy (VP9 with alpha) for sharing; the MOV is the lossless master
  ffmpeg -y -loglevel error -framerate 60 -i work/${B}_${F}/f%04d.png -i out/${B}.wav -map 0:v -map 1:a \
    -c:v libvpx-vp9 -pix_fmt yuva420p -crf 12 -b:v 0 -row-mt 1 -deadline good -cpu-used 2 -c:a libopus -b:a 256k -shortest out/${B}_${F}_alpha.webm
  for G in light:FFFFFF dark:081615; do
    ffmpeg -y -loglevel error -f lavfi -i color=c=0x${G#*:}:s=$S:r=60 -framerate 60 -i work/${B}_${F}/f%04d.png -i out/${B}.wav \
      -filter_complex "[0][1]overlay=shortest=1,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[v]" -map "[v]" -map 2:a \
      -c:v libx264 -preset slow -crf 12 -tune animation -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv \
      -c:a aac -b:a 320k -ar 48000 -shortest -movflags +faststart out/${B}_${F}_${G%%:*}.mp4
  done
  echo "done ${B}_${F}"
done

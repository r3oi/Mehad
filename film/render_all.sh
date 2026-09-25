#!/bin/bash
# renders the full cut in 4 parallel segments, then concatenates
cd "$(dirname "$0")"
FLAG=${1:-}
node render.mjs video out/seg/a.mp4 0 22.4 $FLAG > out/seg/a.log 2>&1 &
node render.mjs video out/seg/b.mp4 22.4 44.8 $FLAG > out/seg/b.log 2>&1 &
node render.mjs video out/seg/c.mp4 44.8 67.2 $FLAG > out/seg/c.log 2>&1 &
node render.mjs video out/seg/d.mp4 67.2 89.5 $FLAG > out/seg/d.log 2>&1 &
wait
printf "file 'a.mp4'\nfile 'b.mp4'\nfile 'c.mp4'\nfile 'd.mp4'\n" > out/seg/list.txt
ffmpeg -y -loglevel error -f concat -safe 0 -i out/seg/list.txt -c copy out/video_silent.mp4 && echo RENDER_DONE

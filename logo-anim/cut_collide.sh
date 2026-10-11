#!/usr/bin/env bash
# AIM × "Collide" as two stand-alone pieces cut from the rendered 4K/60 frames (run render_collide.sh first):
#   intro  0.0–4.5s  the balls collide, the products burst out, and it holds on the mark
#   outro  3.5–7.0s  it opens on the mark, the products are pulled in, the balls part and vanish
# Each part gets its own sound from the cue list (events re-timed), then MP4 on light/dark + alpha WebM.
set -euo pipefail
cd "$(dirname "$0")"
B=collide-aim
for PART in intro:0:4.5 outro:3.5:3.5; do
  N=${PART%%:*}; T0=$(echo $PART | cut -d: -f2); D=${PART##*:}
  python3 - "$N" "$T0" "$D" <<'PY'
import json, sys
n, t0, d = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
c = json.load(open("out/collide-aim_cues.json"))
ev = [dict(e, t=round(e["t"] - t0, 4)) for e in c["events"] if (e["t"] < 4.4) == (n == "intro")]
json.dump({"dur": d, "events": ev}, open(f"out/collide-aim-{n}_cues.json", "w"), indent=1)
PY
  python3 tools/sound2.py out/${B}-${N}_cues.json out/${B}-${N}.wav
  FADE=$([ $N = intro ] && echo "afade=t=out:st=$(echo "$D - 0.3" | bc):d=0.3" || echo "afade=t=in:d=0.03")
  S0=$(echo "$T0 * 60 / 1" | bc); NF=$(echo "$D * 60 / 1" | bc)
  for F in 16x9 1x1; do
    S=$([ $F = 1x1 ] && echo 2160x2160 || echo 3840x2160)
    IN="-framerate 60 -start_number $S0 -i work/${B}_${F}/f%04d.png"
    for G in light:FFFFFF dark:081615; do
      ffmpeg -y -loglevel error -f lavfi -i color=c=0x${G#*:}:s=$S:r=60 $IN -i out/${B}-${N}.wav \
        -filter_complex "[0][1]overlay=shortest=1,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[v];[2]$FADE[a]" -map "[v]" -map "[a]" -frames:v $NF \
        -c:v libx264 -preset slow -crf 12 -tune animation -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv \
        -c:a aac -b:a 320k -ar 48000 -movflags +faststart out/${B}-${N}_${F}_${G%%:*}.mp4
    done
    ffmpeg -y -loglevel error $IN -i out/${B}-${N}.wav -filter_complex "[1]$FADE[a]" -map 0:v -map "[a]" -frames:v $NF \
      -c:v libvpx-vp9 -pix_fmt yuva420p -crf 12 -b:v 0 -row-mt 1 -deadline good -cpu-used 2 -c:a libopus -b:a 256k out/${B}-${N}_${F}_alpha.webm
    echo "done ${B}-${N}_${F}"
  done
done

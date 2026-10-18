#!/usr/bin/env bash
# Loudness-normalise the score (-14 LUFS, -1 dBTP) and mux it into both cuts.
#   tools/finalize.sh            (after tools/render-all.sh has produced out/video_*.mp4)
set -euo pipefail
cd "$(dirname "$0")/.."
python3 audio/score.py
# two-pass loudnorm
stats=$(ffmpeg -hide_banner -i audio/score.wav -af loudnorm=I=-14:TP=-1:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')
mi=$(echo "$stats" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['input_i'])")
mtp=$(echo "$stats" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['input_tp'])")
mlra=$(echo "$stats" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['input_lra'])")
mth=$(echo "$stats" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['input_thresh'])")
ffmpeg -y -loglevel error -i audio/score.wav -af "loudnorm=I=-14:TP=-1:LRA=11:measured_I=$mi:measured_TP=$mtp:measured_LRA=$mlra:measured_thresh=$mth:linear=true,aresample=48000" -c:a pcm_s24le audio/score_norm.wav
mkdir -p out/final
for tag in 16x9 9x16; do
  [ -s out/video_$tag.mp4 ] || { echo "missing out/video_$tag.mp4"; continue; }
  # master: the CRF 14 picture untouched + 320k AAC
  ffmpeg -y -loglevel error -i out/video_$tag.mp4 -i audio/score_norm.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 320k -ar 48000 -shortest -movflags +faststart \
    -metadata title="God's Eye View — First Light ($tag)" out/final/GodsEyeView_FirstLight_${tag}_master.mp4
  # delivery: lighter encode for posting/sharing
  ffmpeg -y -loglevel error -i out/video_$tag.mp4 -i audio/score_norm.wav -map 0:v -map 1:a -c:v libx264 -preset slow -crf 19 -tune grain -pix_fmt yuv420p \
    -colorspace bt709 -color_primaries bt709 -color_trc bt709 -c:a aac -b:a 256k -ar 48000 -shortest -movflags +faststart \
    -metadata title="God's Eye View — First Light ($tag)" out/final/GodsEyeView_FirstLight_${tag}.mp4
  echo "finalized $tag"
done
ls -la out/final

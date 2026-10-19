#!/usr/bin/env bash
# v2: sound design only (made to sit under a music track). Normalise the SFX
# mix to -16 LUFS, keep it as a stem, and mux share + master cuts.
set -euo pipefail
cd "$(dirname "$0")/.."
node tools/export-cues.mjs
python3 audio/sfx.py
stats=$(ffmpeg -hide_banner -i audio/sfx.wav -af loudnorm=I=-16:TP=-1.5:LRA=14:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')
g() { echo "$stats" | python3 -c "import json,sys;print(json.load(sys.stdin)['$1'])"; }
ffmpeg -y -loglevel error -i audio/sfx.wav -af "loudnorm=I=-16:TP=-1.5:LRA=14:measured_I=$(g input_i):measured_TP=$(g input_tp):measured_LRA=$(g input_lra):measured_thresh=$(g input_thresh):linear=true,aresample=48000" -c:a pcm_s24le audio/sfx_norm.wav
mkdir -p out/final_v2
cp audio/sfx_norm.wav out/final_v2/GodsEyeView_FirstLight_v2_SFX_stem.wav
for tag in 16x9 9x16; do
  v=out/v2_video_$tag.mp4
  [ -s "$v" ] || { echo "missing $v"; continue; }
  ffmpeg -y -loglevel error -i $v -i audio/sfx_norm.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 320k -shortest -movflags +faststart out/final_v2/GodsEyeView_FirstLight_v2_${tag}_master.mp4
  ffmpeg -y -loglevel error -i $v -c:v libx264 -preset slow -b:v 16M -maxrate 24M -bufsize 32M -pass 1 -passlogfile out/final_v2/p_$tag -an -f null /dev/null
  ffmpeg -y -loglevel error -i $v -i audio/sfx_norm.wav -map 0:v -map 1:a -c:v libx264 -preset slow -b:v 16M -maxrate 24M -bufsize 32M -pass 2 -passlogfile out/final_v2/p_$tag \
    -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 -c:a aac -b:a 256k -shortest -movflags +faststart out/final_v2/GodsEyeView_FirstLight_v2_${tag}.mp4
  rm -f out/final_v2/p_$tag*
  echo "finalized $tag"
done
ls -la out/final_v2

#!/usr/bin/env bash
# Render one format in 8 s chunks (skips chunks already on disk), then concat.
#   tools/render-all.sh 1920 1080 16x9
set -u
W=$1; H=$2; TAG=$3
CH=240; TOTAL=${4:-2850}
mkdir -p out/${PREFIX:-}chunks_$TAG
for ((s=0; s<TOTAL; s+=CH)); do
  e=$((s+CH)); f=out/${PREFIX:-}chunks_$TAG/c_$(printf %05d $s).mp4
  [ -s "$f" ] && continue
  e=$(( e > TOTAL ? TOTAL : e ))
  node tools/render.mjs --port ${PORT:-8766} --w $W --h $H --from $s --to $e --video "$f.tmp.mp4" --crf 14 --preset slow && mv "$f.tmp.mp4" "$f"
done
ls out/${PREFIX:-}chunks_$TAG/c_*.mp4 | sed "s|^|file '$PWD/|; s|$|'|" > out/${PREFIX:-}chunks_$TAG/list.txt
ffmpeg -y -loglevel error -f concat -safe 0 -i out/${PREFIX:-}chunks_$TAG/list.txt -c copy out/${PREFIX:-}video_$TAG.mp4 && echo "CONCAT OK $TAG"

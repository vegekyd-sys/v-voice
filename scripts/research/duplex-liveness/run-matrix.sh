#!/bin/bash
# bash run-matrix.sh <stimuli> <out> : sequential within a model, models in parallel.
S=$1;O=$2;D=$(dirname "$0")
one(){ node "$D/probe.mjs" "$@" "$S" "$O" 2>&1 | tail -1; sleep 1; }
for m in seeduplex grok qwen; do (
  for r in 1 2 3; do one $m monologue base $r; done
  for r in 1 2 3; do one $m monologue backchannel $r; done
  for r in 1 2 3; do one $m hesitate base $r; done
  for r in 1 2; do one $m shortq base $r; done
  for r in 1 2; do one $m tool base $r; done
  for r in 1 2; do one $m delegate base $r; done
  for r in 1 2; do one $m interrupt base $r; done
) & done; wait; echo MATRIX-DONE

#!/usr/bin/env bash
# Speak every benchmark question into voice/<id>.wav (macOS `say`, 48 kHz mono, a second of quiet after).
set -euo pipefail
cd "$(dirname "$0")"; mkdir -p voice
python3 - <<'PY'
import json, subprocess
for key, item in json.load(open('questions.json'))['questions'].items():
    subprocess.run(['say', '-v', 'Tingting', '-o', f'voice/{key}.aiff', item['say']], check=True)
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', f'voice/{key}.aiff', '-af', 'apad=pad_dur=1', '-ar', '48000', '-ac', '1', f'voice/{key}.wav'], check=True)
    subprocess.run(['rm', f'voice/{key}.aiff'])
PY
ls voice | wc -l

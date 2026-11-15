#!/usr/bin/env python3
"""Time from a caller's question to what the board shows, per explanation.

Reads a voice service's private call records (transcripts/*.jsonl and
transcripts/board-*.jsonl) and prints, for every lesson in the chosen calls:
  asked    the caller's words were recognised (final user transcript)
  title    the first thing the board drew for the question (title / photo)
  written  the script was written (lesson writer done)
  first    the illustrator's first piece for the script
  spoken   V's voice started on the script (first audio after the script was handed over)
All in seconds after `asked`. Run on V as root (the records are private):
  ssh v sudo -n python3 - DIR [CALL_ID_PREFIX|last] [N] < scripts/candidate/first-content.py
DIR is e.g. /var/lib/v-voice-candidates/board-20261112. Prints no words of the call.
"""
import datetime, glob, json, os, sys

root = sys.argv[1] if len(sys.argv) > 1 else '/var/lib/v-voice-candidates/board-20261112'
pick = sys.argv[2] if len(sys.argv) > 2 else 'last'
count = int(sys.argv[3]) if len(sys.argv) > 3 else 1
days = sorted(glob.glob(os.path.join(root, 'transcripts', '20*.jsonl')))[-2:]
boards = sorted(glob.glob(os.path.join(root, 'transcripts', 'board-20*.jsonl')))[-2:]

def ms(value):
    if isinstance(value, (int, float)): return value
    return datetime.datetime.fromisoformat(str(value).replace('Z', '+00:00')).timestamp() * 1000

calls = {}
for path in days + boards:
    for line in open(path, encoding='utf-8'):
        try: row = json.loads(line)
        except ValueError: continue
        sid = row.get('voiceSessionId')
        if not sid or row.get('type') in ('client.playback-stats',): continue
        row['at'] = ms(row['at'])
        calls.setdefault(sid, []).append(row)
order = sorted((rows for rows in calls.values() if any(r['type'] == 'call.created' for r in rows)), key=lambda rows: min(r['at'] for r in rows))
chosen = order[-count:] if pick == 'last' else [rows for rows in order if rows[0]['voiceSessionId'].startswith(pick)]
fmt = lambda value: '   -  ' if value is None else f'{value:6.1f}'
for rows in chosen:
    rows.sort(key=lambda r: r['at'])
    start = rows[0]['at']
    print(f"call {rows[0]['voiceSessionId'][:8]} {datetime.datetime.fromtimestamp(start / 1000).strftime('%m-%d %H:%M')}")
    print('   at  asked  title written  first spoken  (s after asked)')
    for lesson in (r for r in rows if r['type'] == 'board.lesson'):
        began = lesson['at'] - float(lesson.get('durationMs') or 0)
        asked = max((r['at'] for r in rows if r['type'] == 'transcript' and r.get('role') == 'user' and r.get('final') and r['at'] <= began), default=None)
        if asked is None: continue
        rel = lambda t: None if t is None else (t - asked) / 1000
        runs = [r for r in rows if r['type'] == 'board.run' and r.get('firstOpMs') is not None]
        opened = lambda r: r['at'] - float(r.get('durationMs') or 0) + float(r['firstOpMs'])
        title = min((opened(r) for r in runs if r.get('trigger') == 'user' and asked <= opened(r) < began + 1500), default=None)
        first = min((opened(r) for r in runs if r.get('trigger') != 'user' and opened(r) >= began), default=None)
        handed = min((r['at'] for r in rows if r['type'] == 'tool.delivered' and r['at'] >= lesson['at'] - 50), default=None)
        spoken = min((r['at'] for r in rows if r['type'] == 'audio.delivery' and r.get('phase') == 'first' and handed and r['at'] >= handed), default=None)
        ok = '' if str(lesson.get('ok')) in ('True', 'true') else '  (no script)'
        print(f"{(asked - start) / 1000:6.0f}  0.0 {fmt(rel(title))} {fmt(rel(lesson['at']))} {fmt(rel(first))} {fmt(rel(spoken))}{ok}")

"""Read private JSONL in place; emit aggregate metadata only, never text/IDs/args.

Usage: python3 scripts/research/voice-tool-aggregate.py DIRECTORY --start ISO --end ISO
Dates must have an explicit timezone; interval is [start, end).
"""
import argparse
import collections
import datetime as dt
import json
import math
from pathlib import Path

# Unknown names are counted as 'other', never copied from private input.
TOOLS = set('openclaw_agent_control read exec process memory_search web_search web_fetch feishu_calendar lark_read current_time show_content delegate_to_v send_task_updates cancel_task openclaw_tool end_call get_current_location set_speaker_volume look'.split())
PROVIDERS = {'seeduplex', 'grok', 'openai'}

def timestamp(value):
    date = dt.datetime.fromisoformat(value)
    if date.tzinfo is None:
        raise argparse.ArgumentTypeError('Explicit timezone required')
    return int(date.timestamp() * 1000)

def distribution(values):
    ordered = sorted(values)
    if not ordered:
        return {'n': 0, 'p50Ms': None, 'p95Ms': None}
    return {'n': len(ordered), 'p50Ms': ordered[math.ceil(len(ordered)*.5)-1], 'p95Ms': ordered[math.ceil(len(ordered)*.95)-1]}

def aggregate(paths, start, end):
    calls = collections.defaultdict(set)
    tools = collections.defaultdict(lambda: {'calls': 0, 'delivered': collections.Counter(), 'latency': []})
    pending, completed, backend, backend_done = {}, set(), {}, set()
    durations = collections.defaultdict(list)
    quality = collections.Counter()
    observed = []
    for path in sorted(paths):
        with path.open() as handle:
            for line in handle:
                try:
                    row = json.loads(line)
                except (ValueError, TypeError):
                    quality['malformedRows'] += 1
                    continue
                if not isinstance(row, dict) or not isinstance(row.get('at'), (int, float)):
                    quality['invalidRows'] += 1
                    continue
                at = row['at']
                if not start <= at < end:
                    continue
                if row.get('type') == 'record.gap':
                    quality['gapRecords'] += 1
                    continue
                provider = row.get('provider')
                if provider not in PROVIDERS:
                    continue
                owner = (row.get('captureId'), row.get('voiceSessionId'))
                key = (*owner, row.get('callId'))
                event = row.get('type')
                if event == 'call.created':
                    calls[provider].add(owner)
                    observed.append(at)
                elif event == 'tool.call':
                    if key in pending:
                        quality['duplicateCalls'] += 1
                        continue
                    name = row.get('name') if row.get('name') in TOOLS else 'other'
                    pending[key] = (provider, name, at)
                    tools[(provider, name)]['calls'] += 1
                elif event == 'tool.delivered':
                    if key in completed:
                        quality['duplicateDeliveries'] += 1
                        continue
                    completed.add(key)
                    if key not in pending:
                        quality['unpairedDeliveries'] += 1
                        continue
                    p, name, began = pending[key]
                    status = row.get('status') if row.get('status') in {'ok', 'error', 'cancelled'} else 'unknown'
                    tools[(p,name)]['delivered'][status] += 1
                    if at >= began:
                        tools[(p,name)]['latency'].append(at-began)
                    else:
                        quality['negativeDurations'] += 1
                elif event == 'backend.start-requested':
                    backend.setdefault(key,(provider,at))
                elif event == 'backend.completed':
                    if key in backend_done:
                        quality['duplicateBackendCompleted'] += 1
                        continue
                    backend_done.add(key)
                    if key in backend and at >= backend[key][1]:
                        durations[backend[key][0]].append(at-backend[key][1])
                    else:
                        quality['unpairedBackendCompleted'] += 1
    return {
        'schema': 'voice-tool-aggregate-v1',
        'interval': {'startEpochMs':start,'endExclusiveEpochMs':end},
        'firstCallAtEpochMs':min(observed) if observed else None,
        'lastCallAtEpochMs':max(observed) if observed else None,
        'callsByProvider': {p:len(v) for p,v in sorted(calls.items())},
        'tools': [{'provider':p,'name':name,'calls':v['calls'],'deliveredStatuses':dict(v['delivered']),
                   'notDeliveredInWindow':v['calls']-sum(v['delivered'].values()),'callToDelivered':distribution(v['latency'])}
                  for (p,name),v in sorted(tools.items())],
        'backendRequestedToCompleted':{p:distribution(v) for p,v in sorted(durations.items())},
        'quality':dict(quality),
        'limitations':['One node only; mixed running revisions and fixture/human calls cannot be separated by this log schema.',
                      'Tool delivered ok is transport/executor status, not semantic accuracy, audible answer, or side-effect completion.',
                      'Call-to-delivered includes wrapper overhead; delegate_to_v may deliver acceptance before backend completion.',
                      'Nearest-rank quantiles are descriptive only; sparse samples do not establish performance.',
                      'No transcript, result, arguments, owner, session, capture, call or task identifiers emitted.']}

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory',type=Path)
    parser.add_argument('--start',type=timestamp,required=True)
    parser.add_argument('--end',type=timestamp,required=True)
    args=parser.parse_args()
    if args.start >= args.end:
        parser.error('start must precede end')
    print(json.dumps(aggregate(args.directory.glob('*.jsonl'),args.start,args.end),ensure_ascii=False,indent=2))

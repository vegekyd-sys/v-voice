# report.py <label> [baseline-label]: the round as a table, and its numbers beside a baseline's.
#   speed   reply (caller done -> V's first sound), picture (-> first thing on the page, -> first content),
#           lesson (-> the lesson being spoken; how long the script took)
#   effect  what kinds of picture the pages were made of, and how alike the pages are
import json, sys, glob, os, statistics, collections, math, difflib
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'artifacts', 'board-bench')
questions = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'questions.json')))['questions']
asked = []
def load(label):
    turns = []; asked.clear()
    for name in sorted(glob.glob(os.path.join(root, label, '*.json'))):
        if name.endswith('report.json'): continue
        call = json.load(open(name))
        asked.extend(call['ids'])
        for index, turn in enumerate(call['turns']):
            # (By what was heard, not by order: a question the recogniser missed must not shift the rest.)
            score, key = max((difflib.SequenceMatcher(None, turn['ask'], questions[k]['say']).ratio(), k) for k in call['ids'])
            if score < .5: key = None
            turns.append({**turn, 'id': key, 'kind': questions.get(key, {}).get('kind', '?'), 'expect': questions.get(key, {}).get('tools'), 'group': call['group'], 'call': call['call']})
    return turns
def med(values):
    values = [v for v in values if isinstance(v, (int, float))]
    return (round(statistics.median(values)), max(values), len(values)) if values else None
def summary(turns):
    board = [t for t in turns if t['kind'] != 'legacy']
    pages = [p for t in turns for p in t['pages'] if p['types']]
    kinds = collections.Counter(k for p in pages for k in set(p['types']) if k not in ('photo',))
    shapes = collections.Counter(tuple(sorted(k for k in p['types'])) for p in pages)
    mains = [next((k for k in p['types'] if k not in ('photo', 'sticky', 'note')), '-') for p in pages]
    total = sum(kinds.values()) or 1
    lessons = [t for t in turns if t['kind'] == 'lesson']
    legacy = [t for t in turns if t['kind'] == 'legacy' and t['expect'] is not None]
    right = [t for t in legacy if (not t['expect'] and not [x for x in t['tools'] if x != 'explain_on_board'] and 'explain_on_board' not in t['tools']) or (t['expect'] and any(x in t['expect'] for x in t['tools']))]
    return {
        'turns': len(turns), 'questionsNotHeard': [k for k in asked if k not in [t['id'] for t in turns]],
        'speed': {'replyMs': med(t['replyMs'] for t in turns), 'paintMs': med(t['paintMs'] for t in board), 'contentMs': med(t['contentMs'] for t in board),
                  'lessonSpokenMs': med(t['lessonSpokenMs'] for t in lessons), 'lessonWriteMs': med(t['lessonWriteMs'] for t in lessons),
                  'legacyReplyMs': med(t['replyMs'] for t in legacy)},
        'effect': {'pages': len(pages), 'turnsWithoutPicture': sum(1 for t in board if not any(p['types'] for p in t['pages'])), 'boardTurns': len(board),
                   'kindsUsed': len(kinds), 'kinds': dict(kinds.most_common()),
                   # 1 = every kind used equally often; 0 = one kind only
                   'kindEvenness': round(-sum(c / total * math.log(c / total) for c in kinds.values()) / math.log(len(kinds)), 2) if len(kinds) > 1 else 0,
                   'distinctShapes': len(shapes), 'commonestShapeShare': round(shapes.most_common(1)[0][1] / len(pages), 2) if pages else None,
                   'sameMainAsPrevious': round(sum(1 for a, b in zip(mains, mains[1:]) if a == b) / max(1, len(mains) - 1), 2),
                   'pagesWithPhoto': sum(1 for p in pages if 'photo' in p['types']), 'marks': sum(p['marks'] for p in pages),
                   'photosFound': '%d/%d' % (sum(1 for t in turns for p in t['photos'] if p[1]), sum(len(t['photos']) for t in turns))},
        'function': {'lessonToolCalled': '%d/%d' % (sum(1 for t in lessons if 'explain_on_board' in t['tools']), len(lessons)),
                     'lessonOk': '%d/%d' % (sum(1 for t in lessons if t['lessonOk']), len(lessons)),
                     'legacyToolAsBefore': '%d/%d' % (len(right), len(legacy)), 'legacyWrong': [[t['id'], t['tools']] for t in legacy if t not in right],
                     'repliesCut': sum(t['cut'] for t in turns)}}
label = sys.argv[1]; turns = load(label)
ms = lambda v: '-' if v is None else '%.1f' % (v / 1000)
print('%-4s %-7s %6s %6s %7s %7s %7s  %-30s %s' % ('id', 'kind', 'reply', 'paint', 'content', 'lesson', 'script', 'tools', 'pages'))
for t in turns:
    print('%-4s %-7s %6s %6s %7s %7s %7s  %-30s %s' % (t['id'] or '?', t['kind'], ms(t['replyMs']), ms(t['paintMs']), ms(t['contentMs']), ms(t['lessonSpokenMs']), ms(t['lessonWriteMs']),
        ','.join(t['tools'])[:30], ' | '.join('+'.join(p['types']) for p in t['pages'] if p['types'])))
mine = summary(turns)
json.dump({'label': label, 'summary': mine, 'turns': turns}, open(os.path.join(root, label, 'report.json'), 'w'), ensure_ascii=False, indent=1)
print(json.dumps(mine, ensure_ascii=False, indent=1))
if len(sys.argv) > 2:
    base = summary(load(sys.argv[2]))
    print('\nagainst', sys.argv[2])
    for part in ('speed',):
        for key, value in mine[part].items():
            other = base[part].get(key)
            if value and other: print('  %-16s %6.1fs  was %6.1fs  (%+.1fs)' % (key, value[0] / 1000, other[0] / 1000, (value[0] - other[0]) / 1000))
    print('  legacy tools    ', mine['function']['legacyToolAsBefore'], ' was', base['function']['legacyToolAsBefore'])

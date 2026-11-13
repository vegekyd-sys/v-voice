# On V: the latest N calls of a candidate as one JSON list, a row per caller turn.
#   ssh v sudo python3 - <candidate> <N> < measure.py
# Times are milliseconds after the caller's words were final.
import json, sys, glob, datetime
root = "/var/lib/v-voice-candidates/%s/transcripts/" % sys.argv[1]
count = int(sys.argv[2]) if len(sys.argv) > 2 else 1
def rows(pattern, board=False):
    for name in sorted(glob.glob(root + pattern))[-3:]:
        if not board and "board-" in name: continue
        for line in open(name):
            try: event = json.loads(line)
            except Exception: continue
            if isinstance(event.get("at"), str): event["at"] = int(datetime.datetime.fromisoformat(event["at"].replace("Z", "+00:00")).timestamp() * 1000)
            yield event
calls = {}
for event in rows("20*.jsonl"): calls.setdefault(event.get("voiceSessionId"), []).append(event)
for event in rows("board-20*.jsonl", True): calls.setdefault(event.get("voiceSessionId"), []).append(event)
ids = sorted([key for key in calls if key and any(e["type"] == "call.created" for e in calls[key])], key=lambda key: min(e["at"] for e in calls[key]))[-count:]
out = []
for key in ids:
    events = sorted(calls[key], key=lambda e: e["at"])
    asks = [e for e in events if e["type"] == "transcript" and e.get("role") == "user" and e.get("final") and (e.get("text") or "").strip()]
    turns = []
    for index, ask in enumerate(asks):
        end = asks[index + 1]["at"] if index + 1 < len(asks) else events[-1]["at"] + 1
        span = [e for e in events if ask["at"] <= e["at"] < end]
        after = lambda e: e["at"] - ask["at"]
        first = lambda test: next((e for e in span if test(e)), None)
        tools = [e["name"] for e in span if e["type"] == "tool.call"]
        audio = first(lambda e: e["type"] == "audio.delivery" and e.get("phase") == "first")
        lesson = first(lambda e: e["type"] == "board.lesson")
        told = lesson and first(lambda e: e["type"] == "audio.delivery" and e.get("phase") == "first" and e["at"] >= lesson["at"])
        runs = [e for e in span if e["type"] == "board.run" and "heard" in e or e["type"] == "board.run" and e.get("reason") in ("drawn", "joined")]
        drawn = [e for e in span if e["type"] == "board.run" and e.get("drawn")]
        start = lambda e: e["at"] - e.get("durationMs", 0)
        paint = min((start(e) + (e.get("firstOpMs") or e.get("durationMs", 0)) - ask["at"] for e in drawn), default=None)
        body = [e for e in drawn if any(op.get("op") == "put" and op.get("block", {}).get("t") != "photo" for op in e["drawn"])]
        # (The first piece of content: when the run that drew it produced its first operation, or its second if the first only opened the page.)
        content = min((start(e) + (e.get("firstOpMs") or 0) + (0 if e["drawn"][0].get("op") == "put" and e["drawn"][0]["block"].get("t") != "photo" else (e.get("durationMs", 0) - (e.get("firstOpMs") or 0)) / 2) - ask["at"] for e in body), default=None)
        pages, page = [], None
        for e in drawn:
            for op in e["drawn"]:
                if op.get("op") == "scene": page = {"title": op.get("title"), "blocks": {}}; pages.append(page)
                elif op.get("op") == "put":
                    if page is None: page = {"title": "", "blocks": {}}; pages.append(page)
                    block = op["block"]; page["blocks"][block.get("id")] = block.get("t")
                elif op.get("op") == "mark" and page is not None: page["marks"] = page.get("marks", 0) + 1
        photos = [e for e in span if e["type"] == "board.photo"]
        turns.append({"ask": ask["text"].strip(), "tools": tools, "replyMs": audio and after(audio), "lessonWriteMs": lesson and lesson.get("durationMs"), "lessonOk": lesson and lesson.get("ok"),
            "lessonSpokenMs": told and after(told), "paintMs": paint and round(paint), "contentMs": content and round(content),
            "boardRuns": [[e["trigger"], e.get("reason"), e.get("durationMs"), e.get("firstOpMs")] for e in span if e["type"] == "board.run"],
            "photos": [[e.get("query"), e.get("found"), e.get("durationMs")] for e in photos],
            "pages": [{"title": p["title"], "types": list(p["blocks"].values()), "marks": p.get("marks", 0)} for p in pages],
            "cut": sum(1 for e in span if e["type"] in ("speech.lesson-preempt-cut", "speech.premature-completion-cut")),
            "gapMaxMs": max((e.get("maxGapMs", 0) for e in span if e["type"] == "audio.delivery"), default=0)})
    out.append({"call": key[:8], "at": events[0]["at"], "turns": turns})
print(json.dumps(out, ensure_ascii=False))

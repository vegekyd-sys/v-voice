"""Summarize synthetic native-model studies without publishing raw transcripts."""
import json
import re
import sys
from pathlib import Path


def canonical(value):
    # Spoken labels cannot distinguish homophonic spelling or Chinese digits.
    value = re.sub(r"[\s，。！？、：；,.!?:;]", "", value or "")
    for source, target in [("小琳", "小林"), ("小霖", "小林"), ("一号", "1号"), ("二号", "2号")]:
        value = value.replace(source, target)
    value = {"1": "1号", "2": "2号", "一": "1号", "二": "2号"}.get(value, value)
    return value


def score(turn):
    answer = canonical(turn.get("answer"))
    expected = canonical(turn.get("expected"))
    if turn["kind"] == "unseen":
        return any(x in answer for x in ["未登记", "不确定", "无法确认"]) and not any(
            x in answer for x in ["小林", "小周", "1号", "2号"]
        )
    alternatives = ["小林", "小周"] if expected in ["小林", "小周"] else ["1号", "2号"] if expected in ["1号", "2号"] else ["紫色", "绿色"]
    return bool(expected and expected in answer and not any(x in answer for x in alternatives if x != expected))


if len(sys.argv) != 3:
    raise SystemExit("Usage: summarize-seeduplex-native-speakers.py RAW_RESULTS.json AGGREGATE.json")
raw = json.loads(Path(sys.argv[1]).read_text())
groups = []
for batch, study in raw["studies"].items():
    if study is None:
        continue
    for session in study["sessions"]:
        enrollment = [t for t in session["turns"] if t["kind"] == "enrollment"]
        enrollment_replies = len(enrollment) == 2 and all(t.get("answer") and not t.get("timeout") for t in enrollment)
        metrics = {}
        for kind in ["identity", "preference", "unseen"]:
            turns = [t for t in session["turns"] if t["kind"] == kind]
            metrics[kind] = {"correctSpokenLabel": sum(score(t) for t in turns), "literalTextCorrect": sum(t.get("correct", False) for t in turns), "trials": len(turns)}
        groups.append({"batch": batch, "id": session["id"], "control": session["control"], "voices": session["voices"], "turns": len(session["turns"]), "bothEnrollmentRepliesObserved": enrollment_replies, "metrics": metrics,
                       "asrObserved": sum(bool(t.get("asrObserved")) for t in session["turns"]), "outputAudioObserved": sum(t.get("audioBytes", 0) > 0 for t in session["turns"]),
                       "terminalOrAudioQuietTimeouts": sum(t.get("timeout", False) for t in session["turns"]), "errors": len(session["errors"]),
                       "nativeIdentityFieldEvents": len(session["nativeIdentityFields"])})
totals = {}
confirmed = {}
for kind in ["identity", "preference", "unseen"]:
    totals[kind] = {k: sum(g["metrics"][kind][k] for g in groups if not g["control"]) for k in ["correctSpokenLabel", "literalTextCorrect", "trials"]}
    confirmed[kind] = {k: sum(g["metrics"][kind][k] for g in groups if not g["control"] and g["bothEnrollmentRepliesObserved"]) for k in ["correctSpokenLabel", "literalTextCorrect", "trials"]}
out = {"schema": "v-voice-native-speaker-study-v1", "date": "2026-10-22", "model": "1.2.6.1", "providerRuntimeCommit": "c2d0f5d9b772588deaa27e04648a12b7ef1d122e",
       "syntheticOnly": True, "physicalMicrophone": False, "externalSpeakerIdentity": False, "auxiliaryAsr": False, "gatewayOrTools": False,
       "controls": ["identical-query-words", "random-order-with-repeated-speaker", "voice-label-counterbalance", "lower-volume-probe", "same-voice-control", "numeric-label-replication", "unseen-third-voice"],
       "spokenLabelNormalization": {"小琳/小霖": "小林", "一号/一/1": "1号", "二号/二/2": "2号"},
       "totalsExcludingSameVoiceControl": totals, "bothEnrollmentRepliesOnlyExcludingControl": confirmed, "groups": groups, "provenance": raw.get("provenance"),
       "limits": ["Small correlated synthetic samples, not production accuracy", "No physical microphone, room echo, TV mixing, or overlapping voices", "Initial name study did not wait for output quiet; numeric studies did", "Sandy gender is unspecified in local voice metadata; only Tingting/Meijia is the confirmed female-voice pair", "No stable input speaker identity fields observed in these captured events; this is not proof of API absence"]}
Path(sys.argv[2]).write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"sessions": len(groups), "turns": sum(g["turns"] for g in groups), "totals": totals}, ensure_ascii=False))

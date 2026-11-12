#!/usr/bin/env python3
"""Read quota metadata as the relay operator and atomically publish a widget snapshot."""
import concurrent.futures
import hashlib
import hmac
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import uuid
from datetime import datetime
from http.client import HTTPConnection, HTTPSConnection


def window(label, used, reset):
    if type(used) not in (float, int) or not 0 <= used <= 100:
        raise ValueError("invalid percentage")
    if isinstance(reset, str):
        stamp = datetime.fromisoformat(reset.replace("Z", "+00:00"))
        if stamp.tzinfo is None:
            raise ValueError("missing timezone")
        reset = stamp.timestamp()
    if reset is not None and (type(reset) not in (int, float) or not 0 < reset < 1e10):
        raise ValueError("invalid reset time")
    return {"label": label, "used": used, "reset": reset}


def signed(provider, method, path, port, owner, secret):
    # Only the collector has signing credentials. Requests never leave this host.
    scene = provider == "gemini"
    prefix = "x-scene-relay-" if scene else "x-makaron-relay-"
    stamp = str(int(time.time() * (1 if scene else 1000)))
    nonce = str(uuid.uuid4())
    body = b"{}" if method == "POST" else b""
    message = "\n".join([method, path, stamp, nonce, owner, hashlib.sha256(body).hexdigest()])
    headers = {prefix + "timestamp": stamp, prefix + "request-id": nonce,
               prefix + ("owner-id" if scene else "user-id"): owner,
               prefix + "signature": hmac.new(secret.encode(), message.encode(), "sha256").hexdigest(),
               "content-type": "application/json"}
    conn = HTTPConnection("127.0.0.1", int(port), timeout=20)
    try:
        conn.request(method, path, body, headers)
        response = conn.getresponse()
        if response.status != 200:
            raise ValueError("relay unavailable")
        return json.loads(response.read(65537))
    finally:
        conn.close()


def cli_environment():
    # The CLIs use their own profiles. Relay signing keys stay in the collector.
    return {key: os.environ[key] for key in ("HOME", "PATH", "USER", "LOGNAME", "LANG",
            "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "https_proxy", "http_proxy", "no_proxy",
            "OPENCLAW_STATE_DIR", "OPENCLAW_CONFIG_PATH", "CLAUDE_CONFIG_DIR") if key in os.environ}


def gateway_providers():
    result = subprocess.run(["openclaw", "gateway", "call", "usage.status", "--timeout", "20000", "--json"],
                            capture_output=True, text=True, env=cli_environment(), timeout=25, check=True)
    return {p["provider"]: p for p in json.loads(result.stdout)["providers"]}


def subscription(provider, gateway):
    env = os.environ
    if provider == "Gemini":
        if not env.get("SCENE_GEMINI_RELAY_SECRET"):
            return {"state": "unconfigured"}
        raw = signed("gemini", "GET", "/v1/status", env["SCENE_GEMINI_PORT"],
                     env["SCENE_GEMINI_ALLOWED_OWNER_IDS"].split(",")[0], env["SCENE_GEMINI_RELAY_SECRET"])
        if not raw.get("available"):
            raise ValueError("quota unavailable")
        labels = {"gemini-5h": "5 小时", "gemini-weekly": "周"}
        buckets = raw["quota"]["buckets"]
        windows = [window(labels[b["id"]], 100 * (1 - b["remaining_fraction"]), b["reset_time"])
                   for b in buckets if b["id"] in labels and type(b.get("remaining_fraction")) in (int, float)]
    elif provider == "Claude Code":
        # Claude Code's own structured /usage command. No user prompt or inference.
        cli = env.get("VOICE_USAGE_CLAUDE_CLI", "claude")
        req = {"type": "control_request", "request_id": "widget", "request": {"subtype": "get_usage"}}
        args = [cli, "-p", "--input-format", "stream-json", "--output-format", "stream-json",
                "--verbose", "--no-session-persistence", "--tools", "", "--strict-mcp-config",
                "--mcp-config", '{"mcpServers":{}}']
        with tempfile.TemporaryDirectory() as work:
            result = subprocess.run(args, cwd=work, env=cli_environment(), input=json.dumps(req)+"\n", capture_output=True,
                                    text=True, timeout=25, check=True)
        replies = (json.loads(line) for line in result.stdout.splitlines() if line.strip())
        reply = next(e["response"]["response"] for e in replies if e.get("type") == "control_response"
                     and e["response"].get("request_id") == "widget" and e["response"].get("subtype") == "success")
        limits = reply["rate_limits"] or {}
        windows = [window(label, limits[key]["utilization"], limits[key]["resets_at"])
                   for key, label in (("five_hour", "5 小时"), ("seven_day", "周")) if limits.get(key)]
    elif provider == "Grok":
        # Same source as V's usage display. Gateway resetAt is epoch milliseconds.
        xai = gateway()["xai"]
        if xai.get("error"):
            raise ValueError("xAI usage unavailable")
        labels = {"weekly": "周", "168h": "周", "5h": "5 小时"}
        windows = [window(labels.get(w["label"].lower(), "本期"), w["usedPercent"],
                          w["resetAt"] / 1000 if w.get("resetAt") is not None else None)
                   for w in xai["windows"]]
    else:
        prefix = "CODEX_SUBSCRIPTION_"
        if not env.get(prefix + "RELAY_SECRET"):
            return {"state": "unconfigured"}
        raw = signed(provider, "POST", "/v1/usage", env.get("VOICE_USAGE_CODEX_PORT", 25984),
                     env[prefix+"OWNER_USER_ID"], env[prefix+"RELAY_SECRET"])
        item = raw["weekly"]
        minutes = item.get("windowDurationMins")
        label = {300: "5 小时", 10080: "周"}.get(minutes, "本期")
        windows = [window(label, item["usedPercent"], item.get("resetsAt"))]
    if not windows:
        raise ValueError("no windows")
    return {"state": "ready", "windows": windows}


def deepseek(gateway):
    key = os.environ.get("DEEPSEEK_API_KEY")
    if key:
        conn = HTTPSConnection("api.deepseek.com", timeout=15)
        try:
            conn.request("GET", "/user/balance", headers={"Authorization": "Bearer " + key})
            response = conn.getresponse()
            if response.status != 200:
                raise ValueError("balance unavailable")
            items = json.loads(response.read(65537))["balance_infos"]
            item = next(b for b in items if b["currency"] in ("CNY", "USD"))
            amount = float(item["total_balance"])
            if not math.isfinite(amount):
                raise ValueError("invalid balance")
            return {"state": "ready", "balance": amount, "currency": item["currency"]}
        finally:
            conn.close()
    provider = gateway()["deepseek"]
    item = next(b for b in provider["billing"] if b["type"] == "balance" and b["unit"] in ("CNY", "USD"))
    amount = item["amount"]
    if type(amount) not in (float, int) or not math.isfinite(amount):
        raise ValueError("invalid balance")
    return {"state": "ready", "balance": amount, "currency": item["unit"]}


def read(name, gateway=gateway_providers):
    try:
        data = deepseek(gateway) if name == "DeepSeek" else subscription(name, gateway)
    except Exception:
        # A failure in one provider must not suppress other providers or disclose raw responses.
        data = {"state": "unavailable"}
    return {"name": name, **data}


def main(target):
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        gateway = pool.submit(gateway_providers)
        rows = list(pool.map(lambda name: read(name, gateway.result),
                             ("Codex", "Claude Code", "Grok", "Gemini", "DeepSeek")))
    snapshot = {"version": 1, "updated": int(time.time()), "providers": rows}
    with tempfile.NamedTemporaryFile(mode="w", dir=target.parent, delete=False) as f:
        try:
            json.dump(snapshot, f, ensure_ascii=False, allow_nan=False)
            f.flush()
            os.fsync(f.fileno())
            os.replace(f.name, target)
        finally:
            Path(f.name).unlink(missing_ok=True)


if __name__ == "__main__":
    main(Path(sys.argv[1]))

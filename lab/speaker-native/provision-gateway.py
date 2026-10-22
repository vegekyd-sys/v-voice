"""Run over `ssh v sudo python3 -`: create a private voice-only candidate.

Production configuration and auth are read-only inputs. No personal history,
channels, refresh credentials, tools, or production service changes are copied.
The receipt contains paths and generated candidate admission credentials only;
keep it in the ignored task artifacts with mode 0600.
"""
import hashlib
import json
import os
from pathlib import Path
import secrets
import sqlite3
import subprocess
import time

root = Path('/var/lib/v-voice-candidates/speaker-native-01a13f2c')
if root.exists():
    raise SystemExit('Candidate already exists; inspect its receipt before reuse')
runtime = Path('/opt/openclaw-2026.9.1-v/openclaw')
production = Path('/home/openclaw/.openclaw/openclaw.json')
before = {name: subprocess.check_output(['systemctl', 'show', name, '-p', 'MainPID', '--value'], text=True).strip()
          for name in ['openclaw-rtc-h5.service', 'openclaw-gateway.service']}
db = sqlite3.connect('file:/home/openclaw/.openclaw/agents/makaron/agent/openclaw-agent.sqlite?mode=ro', uri=True, timeout=3)
vector_extension = runtime / 'node_modules/sqlite-vec-linux-x64/vec0.so'
db.enable_load_extension(True)
db.load_extension(str(vector_extension))
db.execute('pragma query_only=on')
store = json.loads(db.execute("select store_json from auth_profile_store where store_key='primary'").fetchone()[0])
schema_version = db.execute('pragma user_version').fetchone()[0]
shadows = {r[1] for r in db.execute('pragma table_list') if r[2] == 'shadow'}
schema_rows = list(db.execute("select type,name,sql from sqlite_master where sql is not null and name not like 'sqlite_%' order by case type when 'table' then 0 when 'index' then 1 when 'view' then 2 else 3 end"))
virtuals = [r[1] for r in schema_rows if r[0] == 'table' and 'CREATE VIRTUAL TABLE' in r[2].upper()]
schema = [r for r in schema_rows if r[1] not in shadows and not (r[0] == 'table' and any(r[1] != v and r[1].startswith(v + '_') for v in virtuals))]
db.close()
profiles = {k: {**{a: b for a, b in v.items() if 'refresh' not in a.lower()}, 'refresh': 'candidate-refresh-disabled'}
            for k, v in store['profiles'].items() if v.get('provider') == 'openai' and v.get('type') == 'oauth'}
if not profiles or any(v.get('expires', 0) < time.time() * 1000 + 300000 for v in profiles.values()):
    raise SystemExit('No existing OpenAI OAuth profile; no production refresh attempted')
os.umask(0o077)
root.mkdir(mode=0o700)
state = root / 'state'
workspace = root / 'workspace'
workspace.mkdir(mode=0o700)
token = secrets.token_urlsafe(32)
for agent in ['main', 'makaron']:
    directory = state / 'agents' / agent / 'agent'
    directory.mkdir(parents=True, mode=0o700)
    target = directory / 'openclaw-agent.sqlite'
    candidate_db = sqlite3.connect(target)
    candidate_db.enable_load_extension(True)
    candidate_db.load_extension(str(vector_extension))
    for _, _, sql in schema:
        candidate_db.execute(sql)
    candidate_db.execute('pragma user_version=' + str(schema_version))
    now = round(time.time() * 1000)
    candidate_db.execute('insert into schema_meta values (?,?,?,?,?,?,?)', ('primary', 'agent', schema_version, agent, '2026.9.1', now, now))
    candidate_db.execute('insert into auth_profile_store values (?,?,?)', ('primary', json.dumps({'version': store['version'], 'profiles': profiles}), now))
    candidate_db.commit()
    candidate_db.close()
    target.chmod(0o600)
config = {
    'gateway': {'mode': 'local', 'bind': 'loopback', 'port': 26367, 'auth': {'mode': 'token', 'token': token},
                'controlUi': {'enabled': False}},
    'agents': {'defaults': {'workspace': str(workspace), 'heartbeat': {'every': '0m'}}, 'list': [
        {'id': 'makaron', 'default': True, 'workspace': str(workspace), 'agentDir': str(state / 'agents/makaron/agent')} ]},
    'auth': {'profiles': {k: {'provider': 'openai', 'mode': 'oauth'} for k in profiles}},
    'plugins': {'allow': ['codex', 'openai', 'v-voice-gpt-live'], 'slots': {'memory': 'none'},
                'load': {'paths': [str(root / 'voice/plugins/v-voice-gpt-live')]},
                'entries': {'codex': {'enabled': True}, 'openai': {'enabled': True}, 'v-voice-gpt-live': {'enabled': True}}},
    'tools': {'deny': ['exec', 'message', 'cron', 'sessions_send', 'sessions_spawn']},
    'channels': {},
    'cron': {'enabled': False},
}
config_path = state / 'openclaw.json'
config_path.write_text(json.dumps(config))
(root / 'gateway-environment.private.json').write_text(json.dumps({
    'OPENCLAW_STATE_DIR': str(state), 'OPENCLAW_CONFIG_PATH': str(config_path),
    'OPENCLAW_NO_RESPAWN': '1', 'OPENCLAW_SKIP_CHANNELS': '1',
}))
receipt = {'root': str(root), 'configPath': str(config_path), 'gatewayPort': 26367,
           'gatewayToken': token, 'productionBefore': before,
           'productionConfigSha256': hashlib.sha256(production.read_bytes()).hexdigest(),
           'runtime': str(runtime), 'authRefreshCopied': False, 'personalHistoryCopied': False}
(root / 'receipt.private.json').write_text(json.dumps(receipt))
print(json.dumps({k: v for k, v in receipt.items() if k != 'gatewayToken'}))

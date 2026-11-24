#!/usr/bin/env python3
"""Run on V as root. Starts the GPT Live 1.1 Candidate: its own Voice process
on its own port, private state directory and HTTPS quick tunnel, with a random
entry token. The production Voice service is only read (environment, node
path, dependencies); the existing Gateway is used as a client, never restarted.
No call is placed and no model is called here.

The ChatGPT (Codex) login is NOT created here: <root>/state/gpt-live-auth.private.json
must already hold an access token and account id (mode 600, owned by the service
user). The Candidate only reads it and never refreshes it.

  sudo python3 start-gpt-live-11.py            # expects <root>/voice from `npm run package`
  sudo python3 start-gpt-live-11.py --stop     # stop this Candidate's two units (their unit files are saved first)
"""
import hashlib, json, os, pathlib, pwd, re, secrets, socket, subprocess, sys, time

NAME = 'gpt-live-11-20261120'
root = pathlib.Path('/var/lib/v-voice-candidates') / NAME
unit, tunnel, port, source_unit = 'voice-' + NAME, 'voice-' + NAME + '-tunnel', 29641, 'openclaw-rtc-h5.service'
run = lambda *args: subprocess.run(args, check=True, capture_output=True, text=True).stdout.strip()
active = lambda name: subprocess.run(['systemctl', 'is-active', name], capture_output=True, text=True).stdout.strip() == 'active'

if '--stop' in sys.argv:
    for name in [unit, tunnel]:
        # A transient unit is deleted when it stops: keep what it was started with.
        text = subprocess.run(['systemctl', 'cat', name], capture_output=True, text=True).stdout
        if text.strip():
            (root / f'{name}.unit.saved').write_text(text)
            os.chmod(root / f'{name}.unit.saved', 0o600)
        subprocess.run(['systemctl', 'stop', name], check=False)
    print(json.dumps({'stopped': [unit, tunnel], 'state': str(root)}))
    sys.exit(0)

manifest = json.loads((root / 'voice/manifest.json').read_text())
for item in manifest['files']:
    path = (root / 'voice' / item['path']).resolve()
    assert path.is_relative_to((root / 'voice').resolve())
    assert hashlib.sha256(path.read_bytes()).hexdigest() == item['sha256'], 'Candidate artifact hash mismatch: ' + item['path']
for name in [unit, tunnel]:
    assert not active(name), 'Own Candidate already running; use --stop first'
with socket.socket() as probe:
    probe.bind(('127.0.0.1', port))

pid = int(run('systemctl', 'show', source_unit, '-p', 'MainPID', '--value'))
assert pid > 1, 'Expected the running production Voice service as the environment source'
env = dict(item.split('=', 1) for item in pathlib.Path(f'/proc/{pid}/environ').read_text().split('\0') if '=' in item)
entry = next(arg for arg in pathlib.Path(f'/proc/{pid}/cmdline').read_text().split('\0') if arg.endswith('/lab/gpt-live-h5/server.mjs'))
node = os.readlink(f'/proc/{pid}/exe')
account = pwd.getpwnam(run('systemctl', 'show', source_unit, '-p', 'User', '--value') or 'openclaw')
auth = root / 'state/gpt-live-auth.private.json'
assert auth.is_file() and (auth.stat().st_mode & 0o077) == 0, 'Private ChatGPT login file missing or readable by others: ' + str(auth)

# Dependencies are copied, never linked: a Candidate must not write into production.
if not (root / 'voice/node_modules').exists():
    run('cp', '-a', '--reflink=auto', str(pathlib.Path(entry).parents[2] / 'node_modules'), str(root / 'voice/node_modules'))
# The WebRTC stack is this Candidate's own dependency; production does not have it.
if not (root / 'voice/node_modules/werift').exists():
    run('chown', '-R', f'{account.pw_name}:{account.pw_name}', str(root / 'voice'))
    subprocess.run(['sudo', '-n', '-u', account.pw_name, 'env', 'PATH=' + os.path.dirname(node) + ':/usr/bin:/bin', 'HOME=' + account.pw_dir,
                    os.path.join(os.path.dirname(node), 'npm'), 'ci', '--omit=dev', '--no-audit', '--no-fund'], cwd=root / 'voice', check=True, capture_output=True, text=True)
for folder in ['state', 'transcripts', 'avatars', 'reports', 'tmp']:
    (root / folder).mkdir(mode=0o700, exist_ok=True)
run('chown', '-R', f'{account.pw_name}:{account.pw_name}', str(root))
os.chmod(root, 0o700)

tunnel_started = int(time.time())
run('systemd-run', '--quiet', '--unit=' + tunnel, '--property=User=' + account.pw_name, '--property=UMask=0077',
    '/usr/local/bin/cloudflared', 'tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', f'http://127.0.0.1:{port}')
origin = None
for _ in range(40):
    # Only this start's lines: the unit name is reused, and an earlier tunnel's address is dead.
    match = re.search(r'https://[a-z0-9-]+\.trycloudflare\.com', run('journalctl', '-u', tunnel, '--no-pager', '--since', '@%d' % tunnel_started))
    if match:
        origin = match.group()
        break
    time.sleep(1)
assert origin, 'No HTTPS origin; inspect only this Candidate tunnel'

access = secrets.token_urlsafe(32)
# Production-only ownership: release control, device and entry maps, CLI socket, systemd runtime.
for key in ['VOICE_RELEASE_SOCKET', 'VOICE_RELEASE_BOOT_HOLD_UNTIL', 'VOICE_DEVICES_FILE', 'VOICE_DEVICE_VOLUME_FILE', 'VOICE_ENTRIES_FILE',
            'VOICE_FEISHU_LOGIN_FILE', 'VOICE_PERSONAL_REPLY_ACCOUNT_ID', 'VOICE_CLI_SOCKET', 'VOICE_CLI_REGISTRY',
            'INVOCATION_ID', 'JOURNAL_STREAM', 'MEMORY_PRESSURE_WATCH', 'MEMORY_PRESSURE_WRITE', 'RUNTIME_DIRECTORY', 'STATE_DIRECTORY', 'SYSTEMD_EXEC_PID']:
    env.pop(key, None)
env.update({'GPT_LIVE_H5_PORT': str(port), 'RTC_H5_PORT': str(port), 'GPT_LIVE_H5_BASE_PATH': '/voice', 'RTC_H5_BASE_PATH': '/voice',
            'GPT_LIVE_H5_PUBLIC_ORIGIN': origin, 'RTC_H5_PUBLIC_ORIGIN': origin, 'GPT_LIVE_H5_ACCESS_TOKEN': access, 'RTC_H5_ACCESS_TOKEN': access,
            'VOICE_STREAM_SPEAKER': '0', 'VOICE_ENABLE_GPT_LIVE_11': '1', 'VOICE_GPT_LIVE_AUTH_FILE': str(auth), 'VOICE_DEFAULT_MODEL': 'gpt-live-11',
            'RTC_H5_TRANSCRIPT_DIR': str(root / 'transcripts'), 'RTC_H5_AVATAR_LOG_DIR': str(root / 'avatars'), 'VOICE_CALL_REPORTS_DIR': str(root / 'reports'),
            'VOICE_IOS_BINDINGS_FILE': str(root / 'state/ios-grants.private.json'), 'VOICE_CANDIDATE_RELEASE_FILE': str(root / 'release.json'), 'TMPDIR': str(root / 'tmp')})
launcher = "const fs=require('node:fs'),cp=require('node:child_process');const env=JSON.parse(fs.readFileSync(process.argv[2]));const p=cp.spawn(process.argv[3],process.argv.slice(4),{env,stdio:'inherit'});p.on('error',()=>{process.exitCode=1;});p.on('exit',code=>{process.exitCode=code??1;});"
release = {'version': NAME, 'label': 'GPT Live 1.1 Candidate', 'summary': 'GPT Live 1.1：短任务当场办完，讲解带画面。只在这个候选入口生效，未上线。', 'sourceCommit': manifest['commit']}
for name, value, mode in [('environment.private.json', json.dumps(env), 0o600), ('release.json', json.dumps(release, ensure_ascii=False), 0o600),
                          ('launch.private.cjs', launcher, 0o700), ('entry-link.private', f'{origin}/voice/#access={access}\n', 0o600)]:
    (root / name).write_text(value)
    os.chmod(root / name, mode)
    os.chown(root / name, account.pw_uid, account.pw_gid)

# Shares the production host: keep the Candidate small and low priority.
run('systemd-run', '--quiet', '--unit=' + unit, '--property=User=' + account.pw_name, '--property=WorkingDirectory=' + str(root / 'voice'),
    '--property=UMask=0077', '--property=KillMode=control-group', '--property=MemoryMax=1G', '--property=CPUQuota=100%', '--property=Nice=10',
    node, str(root / 'launch.private.cjs'), str(root / 'environment.private.json'), node, str(root / 'voice/lab/gpt-live-h5/server.mjs'))
ready = False
for _ in range(30):
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=1):
            ready = True
            break
    except OSError:
        time.sleep(1)
# A new quick tunnel answers 530 until Cloudflare has routed it; say whether the entry is reachable yet.
import urllib.request, urllib.error
reachable = False
for _ in range(30):
    try:
        urllib.request.urlopen(origin + '/voice/', timeout=8)
        reachable = True
    except urllib.error.HTTPError as error:
        reachable = error.code < 500
    except OSError:
        pass
    if reachable:
        break
    time.sleep(3)
print(json.dumps({'candidate': unit, 'tunnel': tunnel, 'sourceCommit': manifest['commit'], 'port': port, 'listening': ready, 'reachable': reachable, 'origin': origin,
                  'entryLinkFile': str(root / 'entry-link.private'), 'sourceVoicePid': pid, 'usesExistingGateway': True, 'callStarted': False}))

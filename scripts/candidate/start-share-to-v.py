#!/usr/bin/env python3
"""Run on V as root. Start an isolated, authenticated HTTPS Candidate of 分享给 V.

    start-share-to-v.py <artifact.tgz> <expected source commit>

The artifact is `node scripts/package.mjs` output, tarred. The Candidate takes the
running production Voice environment (same V backend identity, provider
credentials stay on V), then gives itself its own port, tunnel, access token,
iOS grants, transcripts, reports and share storage, with VOICE_SHARE_TO_V=1.
Production Voice, Gateway and speaker nodes are only read, never restarted.
Rollback: stop the two units this script names; production is untouched.
"""
import hashlib, json, os, pathlib, pwd, re, secrets, socket, subprocess, sys, tarfile, time

archive, commit = pathlib.Path(sys.argv[1]), sys.argv[2]
name = 'share-to-v-20261106'
root = pathlib.Path('/var/lib/v-voice-candidates') / name
unit, tunnel, port = 'voice-' + name, 'voice-' + name + '-tunnel', 29613
production = 'openclaw-rtc-h5.service'
assert not root.exists(), 'This Candidate already exists; inspect rather than overwrite'
for item in [unit, tunnel]:
    assert subprocess.run(['systemctl', 'is-active', item], capture_output=True, text=True).stdout.strip() != 'active', 'Do not replace a running instance'
with socket.socket() as probe:
    probe.bind(('127.0.0.1', port))
account = pwd.getpwnam('openclaw')

root.mkdir(mode=0o700)
voice = root / 'voice'
voice.mkdir()
with tarfile.open(archive) as bundle:
    bundle.extractall(voice, filter='data')
manifest = json.loads((voice / 'manifest.json').read_text())
assert manifest['commit'] == commit, 'Artifact is not the expected source'
for item in manifest['files']:
    path = (voice / item['path']).resolve()
    assert path.is_relative_to(voice.resolve())
    assert hashlib.sha256(path.read_bytes()).hexdigest() == item['sha256'], item['path']
# Same runtime dependencies as the production release (ws, opusscript, esbuild).
release = pathlib.Path(os.path.realpath('/opt/openclaw-voice-h5/current')).parents[1]
subprocess.run(['cp', '-a', '--reflink=auto', str(release / 'node_modules'), str(voice / 'node_modules')], check=True)
for folder in ['state', 'share', 'transcripts', 'avatars', 'reports', 'tmp']:
    (root / folder).mkdir(mode=0o700)
subprocess.run(['chown', '-R', 'openclaw:openclaw', str(root)], check=True)

pid = subprocess.check_output(['systemctl', 'show', '-p', 'MainPID', '--value', production], text=True).strip()
assert pid and pid != '0', 'Production Voice is not running; do not guess its environment'
env = dict(item.split('=', 1) for item in pathlib.Path(f'/proc/{pid}/environ').read_text().split('\0') if '=' in item)
# Production-only control, entry and device state: the Candidate must not claim them.
for key in ['VOICE_RELEASE_SOCKET', 'VOICE_RELEASE_BOOT_HOLD_UNTIL', 'VOICE_DEVICES_FILE', 'VOICE_DEVICE_VOLUME_FILE', 'VOICE_ENTRIES_FILE',
            'VOICE_FEISHU_LOGIN_FILE', 'VOICE_PERSONAL_REPLY_ACCOUNT_ID', 'VOICE_CLI_SOCKET', 'VOICE_CLI_REGISTRY',
            'INVOCATION_ID', 'JOURNAL_STREAM', 'SYSTEMD_EXEC_PID', 'RUNTIME_DIRECTORY', 'STATE_DIRECTORY', 'MEMORY_PRESSURE_WATCH', 'MEMORY_PRESSURE_WRITE']:
    env.pop(key, None)

subprocess.run(['systemd-run', '--quiet', '--unit=' + tunnel, '--property=User=openclaw', '--property=UMask=0077',
                '/usr/local/bin/cloudflared', 'tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', f'http://127.0.0.1:{port}'], check=True)
origin = None
for _ in range(40):
    log = subprocess.check_output(['journalctl', '-u', tunnel, '--no-pager', '-n', '60'], text=True)
    match = re.search(r'https://[a-z0-9-]+\.trycloudflare\.com', log)
    if match:
        origin = match.group()
        break
    time.sleep(1)
assert origin, 'No HTTPS origin; inspect only this Candidate tunnel'
access = secrets.token_urlsafe(32)
env.update({'GPT_LIVE_H5_PORT': str(port), 'RTC_H5_PORT': str(port), 'GPT_LIVE_H5_BASE_PATH': '/voice', 'RTC_H5_BASE_PATH': '/voice',
            'GPT_LIVE_H5_PUBLIC_ORIGIN': origin, 'RTC_H5_PUBLIC_ORIGIN': origin, 'GPT_LIVE_H5_ACCESS_TOKEN': access, 'RTC_H5_ACCESS_TOKEN': access,
            'VOICE_STREAM_SPEAKER': '0', 'VOICE_SHARE_TO_V': '1', 'VOICE_SHARE_DIR': str(root / 'share'),
            'RTC_H5_TRANSCRIPT_DIR': str(root / 'transcripts'), 'RTC_H5_AVATAR_LOG_DIR': str(root / 'avatars'), 'VOICE_CALL_REPORTS_DIR': str(root / 'reports'),
            'VOICE_IOS_BINDINGS_FILE': str(root / 'state/ios-grants.private.json'), 'VOICE_CANDIDATE_RELEASE_FILE': str(root / 'release.json'), 'TMPDIR': str(root / 'tmp')})
release_note = {'version': name, 'label': '分享给 V Candidate', 'summary': '分享给 V 独立候选；未合入、未上线。', 'sourceCommit': commit}
link = f'{origin}/voice/#access={access}'
for file, value in [('environment.private.json', json.dumps(env)), ('release.json', json.dumps(release_note)), ('binding-link.private', link)]:
    (root / file).write_text(value)
    os.chmod(root / file, 0o600)
    os.chown(root / file, account.pw_uid, account.pw_gid)
launcher = root / 'launch.private.cjs'
launcher.write_text("const fs=require('node:fs'),cp=require('node:child_process');const env=JSON.parse(fs.readFileSync(process.argv[2]));const p=cp.spawn(process.argv[3],[process.argv[4]],{env,stdio:'inherit'});p.on('error',()=>{process.exitCode=1});p.on('exit',code=>{process.exitCode=code??1});")
os.chmod(launcher, 0o700)
os.chown(launcher, account.pw_uid, account.pw_gid)
node = '/opt/node-v22.23.1/bin/node'
subprocess.run(['systemd-run', '--quiet', '--unit=' + unit, '--property=User=openclaw', '--property=WorkingDirectory=' + str(voice),
                '--property=UMask=0077', '--property=KillMode=control-group', node, str(launcher), str(root / 'environment.private.json'), node, str(voice / 'lab/gpt-live-h5/server.mjs')], check=True)
metadata = {'origin': origin, 'port': port, 'sourceCommit': commit, 'filesSha256': manifest['filesSha256'], 'root': str(root), 'service': unit, 'tunnel': tunnel,
            'productionModified': False, 'gatewayRestarted': False, 'callStarted': False}
(root / 'candidate.json').write_text(json.dumps(metadata, indent=2))
os.chmod(root / 'candidate.json', 0o600)
os.chown(root / 'candidate.json', account.pw_uid, account.pw_gid)
print(json.dumps(metadata))

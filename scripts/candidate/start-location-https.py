#!/usr/bin/env python3
"""Run on V. Copy this lane's frozen candidate and start an authenticated HTTPS instance."""
import hashlib, json, os, pathlib, pwd, re, secrets, socket, subprocess, sys, time

source = pathlib.Path('/var/lib/v-voice-candidates/location-20261025')
root = pathlib.Path('/var/lib/v-voice-candidates/location-https-20261025')
unit, tunnel, port = 'voice-location-https-20261025', 'voice-location-https-20261025-tunnel', 28475
assert not root.exists(), 'Own HTTPS Candidate already exists; inspect rather than overwrite'
assert source.joinpath('voice/manifest.json').is_file()
manifest = json.loads(source.joinpath('voice/manifest.json').read_text())
assert manifest['commit'] == '91c3d59ff7e9900c1e47db5abadd06413c50f586', 'Keep the human-tested source for transport comparison'
for item in manifest['files']:
    path = source.joinpath('voice', item['path']).resolve()
    assert path.is_relative_to(source.joinpath('voice').resolve())
    assert hashlib.sha256(path.read_bytes()).hexdigest() == item['sha256']
for name in [unit, tunnel]:
    check = subprocess.run(['systemctl', 'is-active', name], capture_output=True, text=True)
    assert check.stdout.strip() != 'active', 'Do not replace a running instance'
with socket.socket() as probe:
    probe.bind(('127.0.0.1', port))
account = pwd.getpwnam('openclaw')
root.mkdir(mode=0o700)
subprocess.run(['cp', '-a', '--reflink=auto', str(source/'voice'), str(root/'voice')], check=True)
for folder in ['state', 'transcripts', 'avatars', 'reports', 'tmp']:
    (root/folder).mkdir(mode=0o700)
subprocess.run(['chown', '-R', 'openclaw:openclaw', str(root)], check=True)
subprocess.run(['systemd-run', '--quiet', '--unit='+tunnel, '--property=User=openclaw', '--property=UMask=0077',
                '/usr/local/bin/cloudflared', 'tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', 'http://127.0.0.1:'+str(port)], check=True)
origin = None
for _ in range(40):
    log = subprocess.check_output(['journalctl', '-u', tunnel, '--no-pager', '-n', '60'], text=True)
    match = re.search(r'https://[a-z0-9-]+\.trycloudflare\.com', log)
    if match:
        origin = match.group()
        break
    time.sleep(1)
assert origin, 'No HTTPS origin; inspect only this lane tunnel'
env = json.loads(source.joinpath('environment.private.json').read_text())
access = secrets.token_urlsafe(32)
for key in ['VOICE_RELEASE_SOCKET', 'VOICE_RELEASE_BOOT_HOLD_UNTIL', 'VOICE_DEVICES_FILE', 'VOICE_DEVICE_VOLUME_FILE', 'VOICE_ENTRIES_FILE', 'VOICE_FEISHU_LOGIN_FILE', 'VOICE_PERSONAL_REPLY_ACCOUNT_ID']:
    env.pop(key, None)
env.update({'GPT_LIVE_H5_PORT': str(port), 'RTC_H5_PORT': str(port), 'GPT_LIVE_H5_BASE_PATH': '/voice', 'RTC_H5_BASE_PATH': '/voice',
            'GPT_LIVE_H5_PUBLIC_ORIGIN': origin, 'RTC_H5_PUBLIC_ORIGIN': origin, 'GPT_LIVE_H5_ACCESS_TOKEN': access, 'RTC_H5_ACCESS_TOKEN': access,
            'VOICE_STREAM_SPEAKER': '0', 'VOICE_HOST_CALL_CONTROL': '0', 'VOICE_DEFAULT_MODEL': 'seeduplex', 'VOICE_PHONE_INPUT_POLICY': 'native',
            'RTC_H5_TRANSCRIPT_DIR': str(root/'transcripts'), 'RTC_H5_AVATAR_LOG_DIR': str(root/'avatars'), 'VOICE_CALL_REPORTS_DIR': str(root/'reports'),
            'VOICE_IOS_BINDINGS_FILE': str(root/'state/ios-grants.private.json'), 'VOICE_CANDIDATE_RELEASE_FILE': str(root/'release.json'), 'TMPDIR': str(root/'tmp')})
for name, value in [('environment.private.json', env), ('release.json', {'version': 'location-https-20261025', 'label': '位置 HTTPS Candidate', 'summary': '相同位置版本，独立 HTTPS 传输验收；未上线。', 'sourceCommit': manifest['commit']})]:
    (root/name).write_text(json.dumps(value))
    os.chmod(root/name, 0o600)
    os.chown(root/name, account.pw_uid, account.pw_gid)
launcher = root/'launch.private.cjs'
launcher.write_text("const fs=require('node:fs'),cp=require('node:child_process');const env=JSON.parse(fs.readFileSync(process.argv[2]));const p=cp.spawn(process.argv[3],[process.argv[4]],{env,stdio:'inherit'});p.on('error',()=>{process.exitCode=1});p.on('exit',code=>{process.exitCode=code??1});")
os.chmod(launcher, 0o700)
os.chown(launcher, account.pw_uid, account.pw_gid)
node = '/opt/node-v22.23.1/bin/node'
subprocess.run(['systemd-run', '--quiet', '--unit='+unit, '--property=User=openclaw', '--property=WorkingDirectory='+str(root/'voice'),
                '--property=UMask=0077', '--property=KillMode=control-group', node, str(launcher), str(root/'environment.private.json'), node, str(root/'voice/lab/gpt-live-h5/server.mjs')], check=True)
metadata = {'origin': origin, 'port': port, 'sourceCommit': manifest['commit'], 'filesSha256': manifest['filesSha256'], 'root': str(root), 'service': unit, 'tunnel': tunnel, 'productionModified': False, 'callStarted': False}
(root/'candidate.json').write_text(json.dumps(metadata, indent=2))
os.chmod(root/'candidate.json', 0o600)
os.chown(root/'candidate.json', account.pw_uid, account.pw_gid)
print(json.dumps(metadata))

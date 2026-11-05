#!/usr/bin/env python3
"""Publish one verified main artifact to both Voice nodes without stopping calls.

Private inventory and receipts stay outside Git. SSH/sudo is the only admin
transport. No provider calls, firmware flashing, device resets or Gateway writes.
"""
import argparse
import base64
import contextlib
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import shlex
import socket
import subprocess
import sys
import tarfile
import tempfile
import time
import uuid


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def run(args, **kwargs):
    result = subprocess.run(args, capture_output=True, timeout=kwargs.pop('timeout', 30), **kwargs)
    require(result.returncode == 0, 'Command failed: ' + args[0])
    return result.stdout.decode().strip()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def file_hash(path):
    return digest(Path(path).read_bytes())


def save(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with path.open('x') as out:
        os.chmod(path, 0o600)
        json.dump(value, out, indent=2)


def verify_artifact(directory):
    directory = Path(directory)
    manifest = json.loads((directory / 'manifest.json').read_text())
    require(manifest['schema'] == 'v-voice-release-v1' and manifest['gatewayProtocol'] == 4
            and manifest['gatewayRestartRequired'] is False, 'Unexpected artifact contract')
    require(re.fullmatch('[a-f0-9]{40}', manifest['commit']), 'Invalid commit')
    require(set(manifest['clients']) == {'web', 'ios', 'robot', 'speaker'}, 'All four clients required')
    identity = json.dumps(manifest['files'], separators=(',', ':'), ensure_ascii=False).encode()
    require(digest(identity) == manifest['filesSha256'], 'Manifest digest mismatch')
    names = set()
    for item in manifest['files']:
        name = item['path']
        require((re.fullmatch(r'(lab|lib|plugins)/[A-Za-z0-9_@./-]+|package(?:-lock)?\.json', name)
                 or name in {'scripts/phone.mjs', 'scripts/feishu-menu.mjs',
                             'scripts/device-call.mjs', 'scripts/install-backend-device-bundle.mjs',
                             'skills/device-use/SKILL.md', 'skills/voice-cli/SKILL.md',
                             'bin/v-voice.mjs', 'backend-device-bundle.json'})
                and '..' not in Path(name).parts and name not in names, 'Unsafe artifact path')
        names.add(name)
        file = directory / name
        require(not file.is_symlink() and file.resolve().is_relative_to(directory.resolve()), 'Artifact symlink')
        data = file.read_bytes()
        require(len(data) == item['bytes'] and digest(data) == item['sha256'], 'Artifact byte mismatch: ' + name)
    require({'lib/release-control.mjs', 'lab/gpt-live-h5/server.mjs',
             'lab/gpt-live-h5/ios-shell-release.json', 'package-lock.json'} <= names, 'Incomplete artifact')
    shell = json.loads((directory / 'lab/gpt-live-h5/ios-shell-release.json').read_text())
    require(shell['revision'] == manifest['clients']['ios']['shellRevision'], 'iOS shell mismatch')
    return manifest


class UnixHTTP(http.client.HTTPConnection):
    def __init__(self, path):
        super().__init__('localhost', timeout=5)
        self.path = path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(self.path)


def admin(path, route='/status', payload=None):
    conn = UnixHTTP(path)
    try:
        conn.request('GET' if payload is None else 'POST', route,
                     body=None if payload is None else json.dumps(payload))
        reply = conn.getresponse()
        data = reply.read(65537)
        require(len(data) <= 65536, 'Oversize release response')
        require(reply.status == 200, 'Release is busy or unavailable')
        return json.loads(data)
    finally:
        conn.close()


def properties(unit):
    return dict(line.split('=', 1) for line in run(['systemctl', 'show', unit, '-p',
        'MainPID,InvocationID,ActiveState,FragmentPath,DropInPaths,ExecMainStartTimestamp,User,Group']).splitlines())


def process_env(pid):
    return dict(part.split('=', 1) for part in Path(f'/proc/{pid}/environ').read_text().split('\0') if '=' in part)


def snapshot(target):
    props = properties(target['unit'])
    require(props['ActiveState'] == 'active' and int(props['MainPID']) > 1, 'Voice service is not active')
    env = process_env(props['MainPID'])
    argv = Path(f'/proc/{props["MainPID"]}/cmdline').read_text().strip('\0').split('\0')
    require(len(argv) == 2 and argv[1].endswith('/lab/gpt-live-h5/server.mjs'), 'Unrecognized Voice launcher')
    root = Path(argv[1]).parents[2]
    require(root.is_relative_to(target['releaseRoot']), 'Unexpected release directory')
    files = [props['FragmentPath'], *shlex.split(props['DropInPaths'])]
    env_files = run(['systemctl', 'show', target['unit'], '-p', 'EnvironmentFiles', '--value'])
    files += re.findall(r'(\S+) \(ignore_errors=(?:yes|no)\)', env_files)
    files += [env[k] for k in ['OPENCLAW_CONFIG_PATH', 'VOICE_DEVICES_FILE', 'VOICE_ENTRIES_FILE'] if env.get(k)]
    identity = {key: props[key] for key in ['MainPID', 'InvocationID', 'ExecMainStartTimestamp', 'User', 'Group']}
    identity.update(root=str(root), serverSha=file_hash(argv[1]),
                    files={name: file_hash(name) for name in sorted(set(files))})
    if target['id'] == 'web':
        gateway = properties('openclaw-gateway.service')
        gateway_env = process_env(gateway['MainPID'])
        identity['gateway'] = {k: gateway[k] for k in ['MainPID','InvocationID','ExecMainStartTimestamp']}
        identity['gateway']['configSha'] = file_hash(gateway_env['OPENCLAW_CONFIG_PATH'])
    return identity, env, argv


def idle(value, legacy=False):
    keys = ['activeCalls', 'creatingSessions', 'backgroundTasks']
    if not legacy:
        keys += ['deviceOperations']
    return value.get('known') is True and all(type(value.get(k)) is int and value[k] == 0 for k in keys)


def legacy_connection(env):
    origin = env.get('GPT_LIVE_H5_PUBLIC_ORIGIN', env.get('RTC_H5_PUBLIC_ORIGIN', 'https://openclaw.tianyi.live'))
    port = int(env.get('GPT_LIVE_H5_PORT', env.get('RTC_H5_PORT', 26244)))
    base = env.get('GPT_LIVE_H5_BASE_PATH', env.get('RTC_H5_BASE_PATH', ''))
    require(re.fullmatch(r'/[A-Za-z0-9_-]+', base), 'Hosted legacy entry required')
    headers = {'Host': origin.split('://', 1)[1], 'Origin': origin, 'Content-Type':'application/json'}
    conn = http.client.HTTPConnection('127.0.0.1', port, timeout=5)
    conn.request('POST', base + '/api/access', json.dumps({'access':env.get('GPT_LIVE_H5_ACCESS_TOKEN', env.get('RTC_H5_ACCESS_TOKEN'))}), headers)
    reply = conn.getresponse()
    reply.read()
    require(reply.status == 200, 'Legacy release authentication failed')
    headers['Cookie'] = reply.getheader('set-cookie').split(';', 1)[0]
    return conn, headers, base, port


def legacy_readiness(conn, headers, base):
    conn.request('GET', base + '/api/status', headers=headers)
    reply = conn.getresponse()
    data = reply.read(65537)
    require(reply.status == 200 and len(data) <= 65536, 'Legacy readiness unavailable')
    return json.loads(data).get('releaseReadiness', {'known':False})


def inspect(target):
    identity, env, _ = snapshot(target)
    control = env.get('VOICE_RELEASE_SOCKET')
    if control:
        status = admin(control)
        require(status['pid'] == int(identity['MainPID']), 'Release socket belongs to another process')
    else:
        conn, headers, base, _ = legacy_connection(env)
        try:
            status = {'release':None, 'readiness':legacy_readiness(conn, headers, base), 'devices':[]}
        finally:
            conn.close()
    return {'id':target['id'], 'identity':identity, 'status':status}


def install(target, archive):
    # The uploader supplies a tar of the frozen manifest only, never config or node_modules.
    with tempfile.TemporaryDirectory(prefix='voice-stage-') as temp:
        with tarfile.open(archive) as tar:
            for item in tar.getmembers():
                require(item.isfile() and not item.name.startswith('/') and '..' not in Path(item.name).parts,
                        'Unsafe release archive')
            tar.extractall(temp, filter='data')
        manifest = verify_artifact(temp)
        dest = Path(target['releaseRoot']) / (target.get('prefix', '') + manifest['commit'])
        if dest.exists():
            require(verify_artifact(dest) == manifest, 'Existing release differs')
        else:
            import shutil
            shutil.copytree(temp, dest)
            dest.chmod(0o755)
        current, _, argv = snapshot(target)
        if current['root'] == str(dest):
            return {'directory':str(dest), 'commit':manifest['commit'], 'filesSha256':manifest['filesSha256']}
        env = dict(os.environ, PATH=str(Path(argv[0]).parent) + ':' + os.environ.get('PATH','/usr/bin:/bin'))
        run(['npm', 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], cwd=dest, env=env, timeout=180)
        require(verify_artifact(dest) == manifest, 'Install changed artifact')
        return {'directory':str(dest), 'commit':manifest['commit'], 'filesSha256':manifest['filesSha256']}


def assert_no_other_connections(port, probe_port):
    # Include SYN_RECV and half-closed connections, not just established ones.
    # The sole allowed socket is the already-authenticated control probe.
    for table in ['/proc/net/tcp', '/proc/net/tcp6']:
        for line in Path(table).read_text().splitlines()[1:]:
            fields = line.split()
            local_port = int(fields[1].split(':')[1], 16)
            remote_port = int(fields[2].split(':')[1], 16)
            if local_port == port and fields[3] not in ['0A', '06', '07']:
                require(remote_port == probe_port, 'Legacy clients remain connected; defer without disconnecting them')


@contextlib.contextmanager
def legacy_guard(target, env, identity):
    # One-time bootstrap only. Block NEW loopback TCP connections; established
    # calls are never filtered. If ANY preexisting client is present, defer.
    # A private HTTP keepalive probe remains usable after the gate is closed.
    require(target.get('bootstrapServerSha') == identity['serverSha'], 'Legacy source not approved for bootstrap')
    conn, headers, base, port = legacy_connection(env)
    rule = ['-i','lo','-p','tcp','--dport',str(port),'--syn','-m','comment','--comment',
            'voice-release-' + uuid.uuid4().hex, '-j','REJECT','--reject-with','tcp-reset']
    timer = 'voice-release-cleanup-' + uuid.uuid4().hex
    import shutil
    iptables = shutil.which('iptables')
    require(iptables, 'Legacy bootstrap needs iptables')
    armed = False
    try:
        require(idle(legacy_readiness(conn, headers, base), legacy=True), 'Legacy Voice is busy')
        probe_port = conn.sock.getsockname()[1]
        # If the operator dies, systemd removes just this uniquely named rule.
        run(['systemd-run','--quiet','--unit',timer,'--on-active=120s','--',iptables,'-D','INPUT',*rule])
        run([iptables,'-I','INPUT','1',*rule])
        armed = True
        assert_no_other_connections(port, probe_port)
        require(idle(legacy_readiness(conn, headers, base), legacy=True), 'Legacy Voice became busy')
        assert_no_other_connections(port, probe_port)
        yield
    finally:
        conn.close()
        removed = not armed or subprocess.run([iptables,'-D','INPUT',*rule], capture_output=True).returncode == 0
        if removed:
            subprocess.run(['systemctl','stop',timer+'.timer'], capture_output=True)
        else:
            raise RuntimeError('Bootstrap gate cleanup deferred to its systemd watchdog')


@contextlib.contextmanager
def admission_guard(target, env, identity):
    control = env.get('VOICE_RELEASE_SOCKET')
    if not control:
        with legacy_guard(target, env, identity):
            yield
        return
    status = admin(control)
    require(status['pid'] == int(identity['MainPID']), 'Wrong release control owner')
    lease = admin(control, '/hold', {})['lease']
    try:
        check = admin(control)
        require(check['admission']['id'] == lease['id'] and idle(check['readiness']), 'Release hold not idle')
        yield
    finally:
        try:
            admin(control, '/resume', {'id':lease['id']})
        except Exception:
            pass  # Old process may be gone; its lease also has a bounded expiry.


def switch(target, directory, expected, receipt_dir, host_root=Path('/')):
    import fcntl
    unit = target['unit']
    with open(host_root / ('run/lock/voice-release-' + target['id'] + '.lock'), 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        manifest = verify_artifact(directory)
        before, env, argv = snapshot(target)
        require(before == expected, 'Service or private configuration changed; re-inspect')
        if before['root'] == directory:
            return {'alreadyCurrent':True, **inspect(target)}
        dropin = host_root / 'etc/systemd/system' / (unit + '.d') / '95-unified-release.conf'
        original = dropin.read_bytes() if dropin.exists() else None
        socket_dir = 'voice-release-' + target['id']
        control = '/run/' + socket_dir + '/control.sock'
        pointer = Path(target['pointer']) if target.get('pointer') else None
        old_pointer = os.readlink(pointer) if pointer and pointer.is_symlink() else None
        if pointer:
            require(old_pointer is not None, 'Owned release pointer must be a symlink')
        record = {'before':before, 'directory':directory, 'manifest':manifest,
                  'dropin':str(dropin), 'originalDropin':None if original is None else base64.b64encode(original).decode(),
                  'pointer':str(pointer) if pointer else None, 'oldPointer':old_pointer}
        receipt = Path(receipt_dir) / (str(int(time.time())) + '-' + uuid.uuid4().hex)
        save(receipt / 'before.json', record)
        with admission_guard(target, env, before):
            require(snapshot(target)[0] == before, 'Entry changed while acquiring hold')
            boot_hold_until = int((time.time() + 120) * 1000)
            contents = ('[Service]\nExecStart=\nExecStart=' + argv[0] + ' ' + directory + '/lab/gpt-live-h5/server.mjs\n'
                        'WorkingDirectory=' + directory + '\nRuntimeDirectory=' + socket_dir + '\nRuntimeDirectoryMode=0700\n'
                        'Environment=VOICE_RELEASE_SOCKET=' + control + '\n'
                        'Environment=VOICE_RELEASE_BOOT_HOLD_UNTIL=' + str(boot_hold_until) + '\n'
                        'TimeoutStopSec=infinity\nSendSIGKILL=no\n')
            dropin.parent.mkdir(parents=True, exist_ok=True)
            temporary = dropin.with_name(dropin.name + '.' + uuid.uuid4().hex)
            temporary.write_text(contents)
            temporary.chmod(0o600)
            os.replace(temporary, dropin)
            run(['systemctl','daemon-reload'])
            # Guard remains acquired. We never reach this with live work.
            run(['systemctl','stop',unit], timeout=45)
            if pointer:
                temp = pointer.with_name(pointer.name + '.voice-release-' + uuid.uuid4().hex)
                temp.symlink_to(directory + '/lab/gpt-live-h5')
                os.replace(temp, pointer)
            try:
                run(['systemctl','start',unit], timeout=60)
                after = None
                for _ in range(60):
                    try:
                        after = inspect(target)
                        if after['status']['ready'] and after['status']['release']['filesSha256'] == manifest['filesSha256']:
                            break
                    except Exception:
                        pass
                    time.sleep(0.5)
                require(after and after['status']['ready'] and after['status']['release']['commit'] == manifest['commit'], 'New release did not become ready')
                require(idle(after['status']['readiness']) and after['status']['admission']['held'], 'Startup admission hold missing')
                require(verify_artifact(directory) == manifest, 'Running artifact drifted')
                new_identity = after['identity']
                require(new_identity.get('gateway') == before.get('gateway'), 'Gateway changed during Voice release')
                # All original private files and other unit drop-ins are immutable.
                for path, sha in before['files'].items():
                    if path != str(dropin):
                        require(file_hash(path) == sha, 'Private configuration changed during release')
                admin(control, '/resume', {'id':after['status']['admission']['id']})
                after = inspect(target)
                save(receipt / 'after.json', after)
                return {'receipt':str(receipt), **after}
            except Exception:
                # A failed candidate can only be rolled back while still gated,
                # idle, and owned by this controller. Never kill a newly active call.
                require(dropin.read_text() == contents, 'Another publisher changed the launcher; do not overwrite it')
                if pointer:
                    require(os.readlink(pointer) == directory + '/lab/gpt-live-h5', 'Another publisher changed the pointer; do not overwrite it')
                props = properties(unit)
                if int(props['MainPID']) > 1:
                    failed = admin(control)
                    require(failed['pid'] == int(props['MainPID']) and failed['admission']['held'] and idle(failed['readiness']),
                            'New version has work or unknown state; leave it running for inspection')
                    run(['systemctl','stop',unit], timeout=45)
                if original is None:
                    dropin.unlink()
                else:
                    dropin.write_bytes(original)
                if pointer:
                    temp = pointer.with_name(pointer.name + '.rollback-' + uuid.uuid4().hex)
                    temp.symlink_to(old_pointer)
                    os.replace(temp, pointer)
                run(['systemctl','daemon-reload'])
                run(['systemctl','start',unit], timeout=60)
                save(receipt / 'rollback.json', {'restored':True, 'root':before['root']})
                raise


def validate_target(target):
    require(target['id'] in ['web','devices'], 'Unknown fleet target')
    require(target['unit'] == {'web':'openclaw-rtc-h5.service','devices':'v-voice-speaker.service'}[target['id']], 'Unexpected Voice unit')
    require(re.fullmatch(r'/opt/[A-Za-z0-9_-]+/releases', target['releaseRoot']), 'Invalid release root')
    require(re.fullmatch(r'[A-Za-z0-9_-]*', target.get('prefix','')), 'Invalid release prefix')
    if target.get('pointer'):
        require(target['pointer'] == str(Path(target['releaseRoot']).parent / 'current'), 'Invalid pointer')


def remote_main(request):
    try:
        target = request['target']
        validate_target(target)
        action = request['action']
        if action == 'inspect':
            result = inspect(target)
        elif action == 'stage':
            import fcntl
            with open('/run/lock/voice-release-' + target['id'] + '.lock', 'w') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                result = install(target, request['archive'])
        elif action == 'switch':
            directory = request['directory']
            require(Path(directory).parent == Path(target['releaseRoot']), 'Invalid release destination')
            result = switch(target, directory, request['expected'], '/var/lib/voice-release-receipts/' + target['id'])
        else:
            raise RuntimeError('Unknown action')
        print(json.dumps({'ok':True,'result':result}))
    except Exception as error:
        # No subprocess stderr, headers, environment or request bodies in receipts.
        print(json.dumps({'ok':False,'error':str(error) if isinstance(error, RuntimeError) else type(error).__name__}))
        sys.exit(1)


def remote(target, action, **kwargs):
    request = dict(target=target, action=action, **kwargs)
    source = Path(__file__).read_text().split("\nif __name__ == '__main__':")[0]
    script = source + '\nremote_main(json.loads(' + repr(json.dumps(request)) + '))\n'
    output = subprocess.run(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=10',target['ssh'],
                             'sudo','-n','python3','-'], input=script.encode(), capture_output=True, timeout=240)
    require(output.stdout, 'Remote controller unavailable')
    value = json.loads(output.stdout)
    require(value.get('ok'), value.get('error','Remote failure'))
    return value['result']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['inspect','publish'])
    parser.add_argument('--inventory', required=True)
    parser.add_argument('--artifact')
    parser.add_argument('--receipts', required=True)
    parser.add_argument('--wait-seconds', type=int, default=900, help='Wait for busy targets without interrupting calls (default 900)')
    args = parser.parse_args()
    inventory = json.loads(Path(args.inventory).read_text())
    targets = inventory['targets']
    require(len(targets) == 2 and {t['id'] for t in targets} == {'web','devices'}, 'Both Voice nodes are mandatory')
    for target in targets:
        validate_target(target)
        require(re.fullmatch(r'[A-Za-z0-9_.@:-]+', target['ssh']), 'Invalid SSH destination')
        if target['id'] == 'web':
            require(target['ssh'] == 'v', 'Production V must use ssh v')
    before = {t['id']:remote(t,'inspect') for t in targets}
    receipt_dir = Path(args.receipts) / (time.strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:8])
    save(receipt_dir / 'before.json', before)
    if args.action == 'inspect':
        print(json.dumps(before, indent=2))
        return
    require(args.artifact, 'Artifact required')
    manifest = verify_artifact(args.artifact)
    root = Path(__file__).resolve().parents[1]
    # Main ancestry and CI are checked before either host is touched.
    run(['git','-C',str(root),'fetch','origin','main'])
    run(['git','-C',str(root),'merge-base','--is-ancestor',manifest['commit'],'origin/main'])
    checks = json.loads(run(['gh','api','repos/{owner}/{repo}/commits/' + manifest['commit'] + '/check-runs'], cwd=root))
    require(any(c['name'] == 'test' and c['conclusion'] == 'success' for c in checks['check_runs']), 'Main CI has not passed')
    with tempfile.TemporaryDirectory(prefix='voice-fleet-') as temp:
        archive = Path(temp) / 'artifact.tar.gz'
        with tarfile.open(archive, 'w:gz') as tar:
            for name in ['manifest.json', *[f['path'] for f in manifest['files']]]:
                tar.add(Path(args.artifact) / name, arcname=name)
        staged = {}
        for target in targets:
            remote_archive = '/tmp/voice-release-' + uuid.uuid4().hex + '.tar.gz'
            with archive.open('rb') as data:
                result = subprocess.run(['ssh',target['ssh'],'umask 077; cat > ' + shlex.quote(remote_archive)], stdin=data, capture_output=True)
                require(result.returncode == 0, 'Artifact upload failed')
            try:
                staged[target['id']] = remote(target,'stage',archive=remote_archive)
            finally:
                subprocess.run(['ssh',target['ssh'],'rm','--',remote_archive], capture_output=True)
        save(receipt_dir / 'staged.json', staged)
    require(0 <= args.wait_seconds <= 86400, 'Invalid wait duration')
    results, pending = {}, list(targets)
    deadline = time.monotonic() + args.wait_seconds
    attempt = 0
    while pending:
        attempt += 1
        retry = []
        for target in pending:
            try:
                results[target['id']] = remote(target,'switch',directory=staged[target['id']]['directory'], expected=before[target['id']]['identity'])
            except Exception as error:
                message = str(error)
                results[target['id']] = {'pending':True,'error':message}
                if ('busy' in message.lower() or 'clients remain connected' in message) and time.monotonic() < deadline:
                    retry.append(target)
            save(receipt_dir / (target['id'] + '-' + str(attempt) + '.json'), results[target['id']])
            print(json.dumps({'target':target['id'], 'pending':results[target['id']].get('pending',False),
                              'error':results[target['id']].get('error')}), flush=True)
        pending = retry
        if pending:
            time.sleep(min(15, max(0, deadline-time.monotonic())))
    after = {t['id']:remote(t,'inspect') for t in targets}
    complete = all(v['status'].get('release',{} ) and v['status']['release'].get('commit') == manifest['commit']
                   and v['status']['release'].get('filesSha256') == manifest['filesSha256']
                   and v['status'].get('ready') is True and not v['status'].get('admission',{}).get('held',True) for v in after.values())
    matrix = {'complete':bool(complete), 'completionScope':'both-server-artifacts-and-ios-ui-distribution', 'commit':manifest['commit'], 'clients':manifest['clients'], 'nodes':after,
              'nativeAndFirmwareAcceptance':'Separate receipts required; same server bytes do not prove physical client acceptance'}
    save(receipt_dir / 'matrix.json', matrix)
    print(json.dumps({'complete':bool(complete),'receipt':str(receipt_dir),'commit':manifest['commit']}))
    if not complete:
        sys.exit(3)


if __name__ == '__main__':
    main()

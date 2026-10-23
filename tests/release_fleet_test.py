import contextlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, Mock

spec = importlib.util.spec_from_file_location('fleet', Path(__file__).parents[1] / 'scripts/release-fleet.py')
fleet = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fleet)

IDLE = dict(known=True, activeCalls=0, creatingSessions=0, backgroundTasks=0, deviceOperations=0)


class FleetSafety(unittest.TestCase):
    def test_phone_management_artifact_is_verified_without_allowing_arbitrary_scripts(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            sources = {'lib/release-control.mjs':'export {};',
                       'lab/gpt-live-h5/server.mjs':'export {};',
                       'lab/gpt-live-h5/ios-shell-release.json':'{"revision":"fixture"}',
                       'package-lock.json':'{}', 'scripts/phone.mjs':'export {};',
                       'scripts/feishu-menu.mjs':'export {};'}
            files = []
            for name, content in sources.items():
                path = root/name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content)
                files.append(dict(path=name, bytes=len(content.encode()), sha256=fleet.digest(content.encode())))
            manifest = dict(schema='v-voice-release-v1', gatewayProtocol=4, gatewayRestartRequired=False,
                            commit='a'*40, clients=dict(web={}, ios={'shellRevision':'fixture'}, robot={}, speaker={}), files=files)
            def save():
                manifest['filesSha256'] = fleet.digest(json.dumps(files, separators=(',', ':')).encode())
                (root/'manifest.json').write_text(json.dumps(manifest))
            save()
            self.assertEqual(fleet.verify_artifact(root), manifest)
            for denied in ['scripts/extra.mjs', 'scripts/../phone.mjs', '/scripts/phone.mjs']:
                with self.subTest(path=denied):
                    files[-1]['path'] = denied
                    save()
                    with self.assertRaisesRegex(RuntimeError, 'Unsafe artifact path'):
                        fleet.verify_artifact(root)
            files[-1]['path'] = 'scripts/feishu-menu.mjs'
            save()
            (root/'scripts/phone.mjs').write_text('changed')
            with self.assertRaisesRegex(RuntimeError, 'Artifact byte mismatch'):
                fleet.verify_artifact(root)

    def simulate_switch(self, *, healthy=True, new_work=False):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root/'run/lock').mkdir(parents=True)
            target = dict(id='devices', unit='v-voice-speaker.service')
            before = dict(root='/old', MainPID='42', files={}, gateway=None)
            manifest = dict(commit='a'*40, filesSha256='f'*64)
            state = dict(phase='old', held=False)
            commands = []
            def status():
                new = state['phase'] == 'new'
                return dict(pid=43 if new else 42, ready=healthy if new else True,
                            release=manifest if new else None,
                            readiness=dict(IDLE, activeCalls=int(new and new_work)),
                            admission=dict(held=state['held'] and not(new and new_work), id='new' if new else 'old'))
            def admin(path, route='/status', payload=None):
                if route == '/hold':
                    state['held'] = True
                    return {'lease':{'id':'old'}}
                if route == '/resume':
                    if payload['id'] != ('new' if state['phase']=='new' else 'old'):
                        raise RuntimeError('Lease mismatch')
                    state['held'] = False
                return status()
            def run(command, **kwargs):
                commands.append(command)
                if command[:2] == ['systemctl','stop']:
                    self.assertTrue(state['held'])
                    self.assertFalse(state['phase']=='new' and new_work)
                if command[:2] == ['systemctl','start']:
                    exists = (root/'etc/systemd/system/v-voice-speaker.service.d/95-unified-release.conf').exists()
                    state['phase'] = 'new' if exists else 'old'
                return ''
            def inspect(target):
                return {'id':'devices','identity':dict(before,root='/new',MainPID='43'), 'status':status()}
            with patch.object(fleet,'verify_artifact',return_value=manifest), \
                 patch.object(fleet,'snapshot',return_value=(before, {'VOICE_RELEASE_SOCKET':'/control'}, ['/node','/old/server.mjs'])), \
                 patch.object(fleet,'admin',side_effect=admin), patch.object(fleet,'run',side_effect=run), \
                 patch.object(fleet,'inspect',side_effect=inspect), \
                 patch.object(fleet,'properties',return_value={'MainPID':'43'}), \
                 patch.object(fleet.time,'sleep'):
                if healthy:
                    result = fleet.switch(target,'/new',before,root/'receipts',host_root=root)
                    self.assertFalse(result['status']['admission']['held'])
                else:
                    with self.assertRaises(RuntimeError):
                        fleet.switch(target,'/new',before,root/'receipts',host_root=root)
            return commands, state

    def test_successful_cutover_releases_admission_and_only_controls_voice(self):
        commands, state = self.simulate_switch()
        self.assertEqual(state['phase'], 'new')
        self.assertEqual(commands, [['systemctl','daemon-reload'], ['systemctl','stop','v-voice-speaker.service'],
                                    ['systemctl','start','v-voice-speaker.service']])

    def test_unhealthy_idle_release_rolls_back_original_launcher(self):
        commands, state = self.simulate_switch(healthy=False)
        self.assertEqual(state['phase'], 'old')
        self.assertEqual(sum(c[:2]==['systemctl','stop'] for c in commands), 2)

    def test_failed_release_with_new_work_is_left_running(self):
        commands, state = self.simulate_switch(healthy=False,new_work=True)
        self.assertEqual(state['phase'], 'new')
        self.assertEqual(sum(c[:2]==['systemctl','stop'] for c in commands), 1)

    def test_incomplete_counts_are_never_zero(self):
        self.assertTrue(fleet.idle(IDLE))
        for key in IDLE:
            value = dict(IDLE)
            del value[key]
            self.assertFalse(fleet.idle(value))
        self.assertFalse(fleet.idle(dict(IDLE, activeCalls=False)))
        self.assertFalse(fleet.idle(dict(IDLE, backgroundTasks=1)))

    def test_a_busy_node_cannot_reach_any_service_mutation(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root/'run/lock').mkdir(parents=True)
            target = dict(id='devices', unit='v-voice-speaker.service')
            identity = dict(root='/old', serverSha='fixture', MainPID='42')
            with patch.object(fleet, 'verify_artifact', return_value={'commit':'a'*40}), \
                 patch.object(fleet, 'snapshot', return_value=(identity, {'VOICE_RELEASE_SOCKET':'/fixture'}, ['/node','/old/server.mjs'])), \
                 patch.object(fleet, 'admin', side_effect=[{'pid':42}, RuntimeError('Release is busy or unavailable')]), \
                 patch.object(fleet, 'run') as run:
                with self.assertRaisesRegex(RuntimeError,'busy'):
                    fleet.switch(target, '/new', identity, root/'receipts', host_root=root)
                run.assert_not_called()
                self.assertFalse((root/'etc').exists())

    def test_changed_identity_cannot_even_acquire_a_hold(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root/'run/lock').mkdir(parents=True)
            with patch.object(fleet, 'verify_artifact', return_value={}), \
                 patch.object(fleet, 'snapshot', return_value=({'root':'changed'}, {}, [])), \
                 patch.object(fleet, 'admission_guard') as guard:
                with self.assertRaisesRegex(RuntimeError,'changed'):
                    fleet.switch(dict(id='web',unit='openclaw-rtc-h5.service'), '/new', {'root':'old'}, root/'receipts', host_root=root)
                guard.assert_not_called()

    def test_legacy_bootstrap_refuses_unreviewed_source(self):
        with patch.object(fleet, 'legacy_connection') as connect:
            with self.assertRaisesRegex(RuntimeError,'not approved'):
                with fleet.legacy_guard({}, {}, {'serverSha':'unknown'}):
                    self.fail('must not acquire')
            connect.assert_not_called()

    def test_existing_device_connection_defers_bootstrap_and_removes_only_its_gate(self):
        conn = Mock()
        conn.sock.getsockname.return_value = ('127.0.0.1', 40001)
        with patch.object(fleet, 'legacy_connection', return_value=(conn, {}, '/voice', 26471)), \
             patch.object(fleet, 'legacy_readiness', return_value=IDLE), \
             patch.object(fleet, 'assert_no_other_connections', side_effect=RuntimeError('Legacy clients remain connected')), \
             patch.object(fleet, 'run') as run, \
             patch('shutil.which', return_value='/usr/sbin/iptables'), \
             patch.object(fleet.subprocess, 'run', return_value=Mock(returncode=0)) as cleanup:
            with self.assertRaisesRegex(RuntimeError,'connected'):
                with fleet.legacy_guard({'bootstrapServerSha':'known'}, {}, {'serverSha':'known'}):
                    self.fail('must not stop the service')
            self.assertEqual([c.args[0][0] for c in run.call_args_list], ['systemd-run','/usr/sbin/iptables'])
            self.assertEqual(cleanup.call_args_list[0].args[0][1:3], ['-D','INPUT'])
            conn.close.assert_called_once()

    def test_failed_firewall_cleanup_preserves_the_watchdog(self):
        conn = Mock()
        conn.sock.getsockname.return_value = ('127.0.0.1', 40001)
        with patch.object(fleet, 'legacy_connection', return_value=(conn, {}, '/voice', 26471)), \
             patch.object(fleet, 'legacy_readiness', return_value=IDLE), \
             patch.object(fleet, 'assert_no_other_connections'), \
             patch.object(fleet, 'run'), patch('shutil.which', return_value='/usr/sbin/iptables'), \
             patch.object(fleet.subprocess, 'run', return_value=Mock(returncode=1)) as cleanup:
            with self.assertRaisesRegex(RuntimeError,'watchdog'):
                with fleet.legacy_guard({'bootstrapServerSha':'known'}, {}, {'serverSha':'known'}):
                    pass
            self.assertEqual(cleanup.call_count, 1)

    def test_live_release_dependencies_are_not_reinstalled(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root/'abc').mkdir()
            manifest = {'commit':'abc','filesSha256':'fixture'}
            tar = Mock()
            tar.__enter__ = Mock(return_value=tar)
            tar.__exit__ = Mock(return_value=False)
            tar.getmembers.return_value = []
            with patch.object(fleet.tarfile,'open',return_value=tar), \
                 patch.object(fleet,'verify_artifact',return_value=manifest), \
                 patch.object(fleet,'snapshot',return_value=({'root':str(root/'abc')},{},['/node'])), \
                 patch.object(fleet,'run') as run:
                fleet.install({'releaseRoot':str(root)}, '/fixture')
                run.assert_not_called()


if __name__ == '__main__':
    unittest.main()

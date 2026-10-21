#!/usr/bin/env python3
"""Check a Release bundle; unsigned acceptance is explicit and never means installable."""
import argparse,json,pathlib,plistlib,subprocess
p=argparse.ArgumentParser();p.add_argument('app',type=pathlib.Path);p.add_argument('--allow-unsigned',action='store_true');a=p.parse_args()
info=plistlib.loads((a.app/'Info.plist').read_bytes())
assert info['CFBundleIdentifier']=='com.versa.vvoice'
assert info.get('NSSupportsLiveActivities') is True
assert info.get('UIBackgroundModes')==['audio']
assert info.get('NSMicrophoneUsageDescription')
assert info.get('UIDeviceFamily') == [1, 2], 'Native layout must support iPhone and iPad'
assert (a.app/'H5Markdown.js').is_file()
assert (a.app/'H5DesignSource.json').is_file()
assert (a.app/'H5Reader.css').read_bytes() == (pathlib.Path(__file__).resolve().parents[2]/'lab/gpt-live-h5/styles.css').read_bytes(), 'H5 design must remain synchronized'
assert 'NSAppTransportSecurity' not in info, 'Release must retain normal TLS enforcement'
binary=a.app/info['CFBundleExecutable']; data=binary.read_bytes()
for marker in [b'--local-voice-fixture',b'127.0.0.1:29837',b'fixture-cookie']:
    assert marker not in data, f'Debug fixture marker in Release: {marker!r}'
architecture=subprocess.check_output(['lipo','-archs',str(binary)],text=True).strip()
assert architecture=='arm64',architecture
extension=a.app/'PlugIns/VVoiceActivity.appex';assert extension.is_dir()
metadata=json.loads((a.app/'Metadata.appintents/extract.actionsdata').read_text())
actions=metadata['actions'];assert {'TalkToVIntent','MuteVIntent','EndVIntent','OpenVIntent'}<=actions.keys()
assert actions['TalkToVIntent'].get('openAppWhenRun') is False
assert actions['TalkToVIntent'].get('supportedModes') == 1, 'Do not replace island calling with foreground opening'
protocols=actions['TalkToVIntent']['systemProtocols']
assert any('AudioRecording' in x for x in protocols),protocols
assert any('SessionStarting' in x for x in protocols),protocols
signed=subprocess.run(['codesign','--verify','--deep','--strict',str(a.app)],capture_output=True).returncode==0
entitlements=plistlib.loads(subprocess.check_output(['codesign','-d','--entitlements',':-',str(a.app)],stderr=subprocess.DEVNULL)) if signed else {}
if signed: assert not entitlements.get('com.apple.developer.siri'), 'Island recording does not use the Siri call handoff'
provisioned=(a.app/'embedded.mobileprovision').is_file() and (extension/'embedded.mobileprovision').is_file()
assert (signed and provisioned) or a.allow_unsigned, 'Signing/profiles missing; do not report this bundle as installable'
print(json.dumps({'version':info['CFBundleShortVersionString'],'build':info['CFBundleVersion'],'architecture':architecture,'intents':list(actions),'liveActivityExtension':True,'releaseTLS':True,'debugFixtureAbsent':True,'signed':signed,'profilesPresent':provisioned},ensure_ascii=False,indent=2))

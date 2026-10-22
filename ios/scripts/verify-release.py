#!/usr/bin/env python3
"""Check a Release bundle; unsigned acceptance is explicit and never means installable."""
import argparse,json,pathlib,plistlib,subprocess,hashlib
p=argparse.ArgumentParser();p.add_argument('app',type=pathlib.Path);p.add_argument('--allow-unsigned',action='store_true');a=p.parse_args()
info=plistlib.loads((a.app/'Info.plist').read_bytes())
assert info['CFBundleIdentifier']=='com.versa.vvoice'
assert info.get('CFBundleIcons',{}).get('CFBundlePrimaryIcon',{}).get('CFBundleIconName')=='VVoiceAppIcon', 'System surfaces must resolve the current branded app icon'
assert info.get('NSAppIconActionTintColorName')=='VShortcutTint'
assert info.get('NSAppIconComplementingColorNames')==['VShortcutBackground','VShortcutComplement']
assert info.get('NSSupportsLiveActivities') is True
assert info.get('UIBackgroundModes')==['audio']
assert info.get('NSMicrophoneUsageDescription')
assert info.get('UIDeviceFamily') == [1, 2], 'Native layout must support iPhone and iPad'
shell=a.app/'H5Shell'
manifest=json.loads((shell/'source-manifest.json').read_text())
for name,digest in manifest['outputs'].items():
    assert hashlib.sha256((shell/name).read_bytes()).hexdigest()==digest, 'Embedded H5 artifact mismatch: '+name
assert (shell/'styles.css').read_bytes()==(pathlib.Path(__file__).resolve().parents[2]/'lab/gpt-live-h5/styles.css').read_bytes(), 'Embedded UI must use original H5 CSS'
assert (a.app/'H5Markdown.js').is_file()
assert (a.app/'H5DesignSource.json').is_file()
updates=json.loads((a.app/'H5Updates.json').read_text())
source=(pathlib.Path(__file__).resolve().parents[2]/'lab/gpt-live-h5/changelog.mjs').as_uri()
expected=json.loads(subprocess.check_output(['node','--input-type=module','-e',f'import {{VOICE_UPDATES}} from {json.dumps(source)}; process.stdout.write(JSON.stringify(VOICE_UPDATES))'],text=True))
assert updates==expected, 'Native update history must match the owning H5 changelog'
gallery=json.loads((a.app/'H5AvatarCatalog.json').read_text())
assert len(gallery)==52 and len({p['id'] for p in gallery})==52, 'All reviewed H5 reactions must ship'
assert all(set(p['continuations']) <= {x['id'] for x in gallery} for p in gallery)
assert (a.app/'H5Reader.css').read_bytes() == (pathlib.Path(__file__).resolve().parents[2]/'lab/gpt-live-h5/styles.css').read_bytes(), 'H5 design must remain synchronized'
assert 'NSAppTransportSecurity' not in info, 'Release must retain normal TLS enforcement'
binary=a.app/info['CFBundleExecutable']; data=binary.read_bytes()
for marker in [b'--local-voice-fixture',b'127.0.0.1:29837',b'fixture-cookie']:
    assert marker not in data, f'Debug fixture marker in Release: {marker!r}'
architecture=subprocess.check_output(['lipo','-archs',str(binary)],text=True).strip()
assert architecture=='arm64',architecture
extension=a.app/'PlugIns/VVoiceActivity.appex';assert extension.is_dir()
island=json.loads((extension/'IslandAssets.manifest.json').read_text())
assert len(island['images'])==52, 'All reviewed island reactions must ship'
assets=json.loads(subprocess.check_output(['assetutil','--info',str(extension/'Assets.car')],text=True))
names={item.get('Name') for item in assets}
assert {p['asset'] for p in gallery}<=names, 'Island assets missing from compiled extension catalog'

metadata=json.loads((a.app/'Metadata.appintents/extract.actionsdata').read_text())
actions=metadata['actions'];assert {'TalkToVIntent','MuteVIntent','EndVIntent','OpenVIntent','IslandLayoutIntent','IslandMuteIntent','IslandEndIntent'}<=actions.keys()
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

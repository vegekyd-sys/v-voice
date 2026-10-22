#!/usr/bin/env python3
"""Resample the supplied portrait into all iOS icon roles, including notifications."""
import argparse, hashlib, json, shutil, subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[2]
assets = root / 'ios/VVoice/Resources/Assets.xcassets'
source = assets / 'VVoiceAppIcon.appiconset/AppIcon.png'
manifest_path = root / 'ios/AppIcon.manifest.json'
check = argparse.ArgumentParser()
check.add_argument('--check', action='store_true')
args = check.parse_args()
rows = []
for idiom, sizes, scales in [('iphone', [20, 29, 40, 60], [2, 3]), ('ipad', [20, 29, 40, 76], [1, 2]), ('ipad', [83.5], [2]), ('ios-marketing', [1024], [1])]:
    for size in sizes:
        for scale in scales:
            pixels = int(size * scale)
            rows.append({'idiom': idiom, 'size': f'{size}x{size}', 'scale': f'{scale}x', 'filename': 'AppIcon.png' if pixels == 1024 else f'Portrait-{pixels}.png'})
spec = {'images': rows, 'info': {'author': 'xcode', 'version': 1}}
digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
manifest = {'sourceSHA256': digest(source), 'files': {}}
for name in ['VVoiceAppIcon', 'VVoiceSystemPortrait']:
    folder = assets / f'{name}.appiconset'
    if args.check:
        assert json.loads((folder / 'Contents.json').read_text()) == spec
        continue
    folder.mkdir(exist_ok=True)
    if folder / 'AppIcon.png' != source:
        shutil.copy2(source, folder / 'AppIcon.png')
    for size in sorted({int(float(r['size'].split('x')[0]) * int(r['scale'][0])) for r in rows} - {1024}):
        subprocess.run(['sips', '-z', str(size), str(size), str(source), '--out', str(folder / f'Portrait-{size}.png')], check=True, stdout=subprocess.DEVNULL)
    (folder / 'Contents.json').write_text(json.dumps(spec, indent=2) + '\n')
    for path in [folder / 'Contents.json', *[folder / f for f in sorted({r['filename'] for r in rows})]]:
        manifest['files'][str(path.relative_to(assets))] = digest(path)
if args.check:
    manifest = json.loads(manifest_path.read_text())
    assert manifest['sourceSHA256'] == digest(source)
    for file, expected in manifest['files'].items():
        assert digest(assets / file) == expected, file
    print('Primary and system portrait icons verified for all 18 iOS role/scale entries')
else:
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
    print('Packaged original portrait for primary and alternate system icon roles')

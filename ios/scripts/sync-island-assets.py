#!/usr/bin/env python3
"""Package the existing H5 gallery for the activity extension. No generation or network."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[2]
catalog_path = root / 'ios/VVoice/Resources/Reader/H5AvatarCatalog.json'
catalog = json.loads(catalog_path.read_text())
target = root / 'ios/VVoice/Widget/IslandAssets.xcassets'
manifest_path = root / 'ios/VVoice/Widget/IslandAssets.manifest.json'
core_path = root / 'ios/VVoiceCore/Sources/VVoiceCore/IslandReactionCatalog.swift'
parser = argparse.ArgumentParser()
parser.add_argument('--check', action='store_true')
args = parser.parse_args()

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def source_image(row):
    folder = root / 'ios/VVoice/Resources/Assets.xcassets' / (row['asset'] + '.imageset')
    spec = json.loads((folder / 'Contents.json').read_text())
    return folder / next(image['filename'] for image in spec['images'] if image.get('filename'))

expected_swift = '\n'.join([
    'import Foundation', '',
    '/// Reviewed H5 IDs only. Never treat a picture as an actor or tool permission.',
    'public enum IslandReactionCatalog {',
    '    public static let assets: [String: String] = [',
    *['        ' + json.dumps(row['id']) + ': ' + json.dumps(row['asset']) + ',' for row in catalog],
    '    ]', '}', '',
])
if args.check:
    manifest = json.loads(manifest_path.read_text())
    assert manifest['catalogSHA256'] == digest(catalog_path), 'H5 catalog drift'
    assert core_path.read_text() == expected_swift, 'Core ID allowlist drift'
    for row in catalog:
        item = manifest['images'][row['id']]
        assert item['sourceSHA256'] == digest(source_image(row)), row['id'] + ': source drift'
        assert item['outputSHA256'] == digest(target / (row['asset'] + '.imageset/portrait.png')), row['id'] + ': output drift'
    assert len(manifest['images']) == len(catalog) == 52
    print('Island gallery: 52/52 source, allowlist and extension assets match')
else:
    target.mkdir(parents=True, exist_ok=True)
    (target / 'Contents.json').write_text('{"info":{"author":"xcode","version":1}}\n')
    manifest = {'catalogSHA256': digest(catalog_path), 'maxPixels': 192, 'images': {}}
    for row in catalog:
        source = source_image(row)
        folder = target / (row['asset'] + '.imageset')
        folder.mkdir(exist_ok=True)
        output = folder / 'portrait.png'
        subprocess.run(['sips', '-Z', '192', str(source), '--out', str(output)], check=True, stdout=subprocess.DEVNULL)
        (folder / 'Contents.json').write_text(json.dumps({'images': [{'filename': 'portrait.png', 'idiom': 'universal', 'scale': '3x'}], 'info': {'author': 'xcode', 'version': 1}}, indent=2) + '\n')
        manifest['images'][row['id']] = {'sourceSHA256': digest(source), 'outputSHA256': digest(output)}
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
    core_path.write_text(expected_swift)
    print('Packaged 52 existing H5 images at up to 192 pixels')

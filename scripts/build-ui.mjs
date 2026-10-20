#!/usr/bin/env node
// Builds the phone call UI (React + JSX) into one committed browser module.
// The server and release package ship ui-bundle.mjs as-is; production never
// runs a build, and tests/ui-bundle.test.mjs fails when the file is stale.
import {build} from 'esbuild';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const root = resolve(import.meta.dirname, '..');
export const UI_BUNDLE = resolve(root, 'lab/gpt-live-h5/ui-bundle.mjs');

export async function buildUi() {
  const result = await build({
    entryPoints: [resolve(root, 'lab/gpt-live-h5/ui/call-ui.jsx')],
    bundle: true, format: 'esm', platform: 'browser', target: ['safari15', 'chrome100'],
    jsx: 'automatic', minify: true, legalComments: 'eof', charset: 'utf8',
    define: {'process.env.NODE_ENV': '"production"'},
    write: false, logLevel: 'silent', absWorkingDir: root,
  });
  return result.outputFiles[0].contents;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const bytes = await buildUi();
  await writeFile(UI_BUNDLE, bytes);
  console.log(JSON.stringify({bundle: 'lab/gpt-live-h5/ui-bundle.mjs', bytes: bytes.length}));
}

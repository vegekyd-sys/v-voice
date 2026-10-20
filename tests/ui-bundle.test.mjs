import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildUi, UI_BUNDLE} from '../scripts/build-ui.mjs';

test('committed ui-bundle.mjs is exactly the build of the current UI source', async () => {
  const [built, committed] = await Promise.all([buildUi(), readFile(UI_BUNDLE)]);
  assert.ok(Buffer.from(built).equals(committed), 'Run `npm run build:ui` and commit lab/gpt-live-h5/ui-bundle.mjs');
});

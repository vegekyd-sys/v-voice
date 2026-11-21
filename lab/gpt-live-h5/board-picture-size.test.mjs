import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {pictureSize, roomyPicture} from './board-picture-size.mjs';

// A 180 x 120 PNG and JPEG, made by ffmpeg when the host has it.
const ffmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const sample = format => spawnSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=180x120', '-frames:v', '1', '-f', 'image2', '-c:v', format, 'pipe:1']).stdout;

test('the size of a picture is read from its header', {skip: !ffmpeg}, () => {
  assert.deepEqual(pictureSize(sample('png')), {width: 180, height: 120});
  assert.deepEqual(pictureSize(sample('mjpeg')), {width: 180, height: 120});
  assert.deepEqual(pictureSize(Buffer.from('GIF89a\xb4\x00\x78\x00', 'latin1')), {width: 180, height: 120});
  assert.equal(pictureSize(Buffer.from('not a picture')), null);
  assert.equal(pictureSize(null), null);
});

test('a picture too small to be a reference is given a larger copy; one large enough is left alone', {skip: !ffmpeg}, async () => {
  const small = {bytes: sample('mjpeg'), type: 'image/jpeg', title: '凤王'};
  const made = await roomyPicture(small, {least: 512});
  assert.equal(made.type, 'image/png');
  assert.deepEqual(pictureSize(made.bytes), {width: 768, height: 512});
  assert.deepEqual(made.enlargedFrom, {width: 180, height: 120});
  assert.equal(made.title, '凤王');
  assert.equal(await roomyPicture(made, {least: 512}), made);
  // No ffmpeg on the host: the picture goes out as it is.
  assert.equal(await roomyPicture(small, {least: 512, binary: 'no-such-ffmpeg-here'}), small);
});

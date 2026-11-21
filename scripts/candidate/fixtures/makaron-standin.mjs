#!/usr/bin/env node
// Stand-in for the Makaron CLI in the loopback board fixture (scripts/candidate/board-assets.mjs).
// Makes nothing and spends nothing: after a wait it prints the address of a public sample
// picture or video, in the shape the real CLI's output is read for.
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
const argv = process.argv.slice(2), verb = argv[0] === 'video' ? argv.slice(0, 2).join(' ') : argv[0];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const speed = Number(process.env.STANDIN_SPEED ?? 1) || 1;
const state = join(process.env.HOME ?? '.', 'standin-state.json');
const load = () => { try { return JSON.parse(readFileSync(state, 'utf8')); } catch { return {pictures: 0, tasks: {}}; } };
const save = value => { mkdirSync(process.env.HOME ?? '.', {recursive: true}); writeFileSync(state, JSON.stringify(value)); };
const PICTURES = ['https://picsum.photos/id/1015/1280/720.jpg', 'https://picsum.photos/id/1043/1024/768.jpg', 'https://picsum.photos/id/1039/1280/720.jpg'];
const VIDEO = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';
if (verb === 'edit') {
  const value = load();
  await wait(6500 / speed);
  console.log('Image: ' + PICTURES[value.pictures++ % PICTURES.length]);
  save(value);
} else if (verb === 'video create') {
  const value = load(), id = 'standin-' + (Object.keys(value.tasks).length + 1);
  value.tasks[id] = Date.now(); save(value);
  await wait(800 / speed);
  console.log(`Task ID: ${id}\nVideo is queued`);
} else if (verb === 'video status') {
  const started = load().tasks[argv[2]];
  if (!started) { console.error('unknown task'); process.exit(1); }
  console.log(Date.now() - started < 11000 / speed ? `Task ID: ${argv[2]}\nVideo is rendering` : `Video: ${VIDEO}`);
} else { console.error('stand-in: unsupported ' + verb); process.exit(2); }

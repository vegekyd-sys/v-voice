#!/usr/bin/env node
// One-off: speak the fixed tool-progress lines through a separate native Xiaohe
// SayHello connection and store the PCM with provenance, like the tool-start
// clips. Each line is one short billed Seeduplex TTS turn; run it only with the
// operator's approval, on a host that already holds the Seeduplex key in its
// environment (VOLCENGINE_REALTIME_API_KEY). The key is never written anywhere.
//
//   node scripts/generate-notice-clips.mjs [--out <dir>] [--force]
import {existsSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {SeeduplexRealtimeVoiceBridge,resolveSeeduplexApiKey} from '../lab/seeduplex-realtime-provider.mjs';
import {TOOL_PROGRESS_LINES,loadToolProgressClips} from '../lab/realtime-direct-tools/tool-start-audio.mjs';

const args = process.argv.slice(2);
const out = resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : join(import.meta.dirname, '../lab/realtime-direct-tools/assets'));
if (!resolveSeeduplexApiKey({})) throw Error('No Seeduplex key in this environment');
if (existsSync(join(out, 'tool-progress-provenance.json')) && !args.includes('--force')) throw Error('Progress clips already exist; pass --force to replace them');

async function speak(text) {
  const pcm = [];
  let bridge;
  const done = new Promise((resolveDone, reject) => {
    const timer = setTimeout(() => reject(Error(`No speech for: ${text}`)), 30000);
    bridge = new SeeduplexRealtimeVoiceBridge({
      providerConfig:{voice:'xiaohe',model:'1.2.6.1'},language:'zh-CN',tools:[],inputSampleRate:24000,
      instructions:'只朗读系统给定的句子。',greetingText:text,
      onAudio:audio => pcm.push(Buffer.from(audio)),
      onAudioSegmentDone:() => {if (pcm.length) {clearTimeout(timer);resolveDone();}},
      onResponseDone:() => {if (pcm.length) {clearTimeout(timer);resolveDone();}},
      onError:error => {clearTimeout(timer);reject(error);},
    });
  });
  try {
    await bridge.connect();
    bridge.triggerGreeting('');
    await done;
  } finally {
    bridge.close();
  }
  return Buffer.concat(pcm);
}

await mkdir(out, {recursive:true});
const clips = {};
for (const [i, text] of TOOL_PROGRESS_LINES.entries()) {
  const pcm = await speak(text);
  if (!pcm.length || pcm.length % 2) throw Error(`Invalid PCM for: ${text}`);
  const key = `progress-${i + 1}`;
  await writeFile(join(out, `tool-${key}.pcm`), pcm);
  clips[key] = {text,bytes:pcm.length,seconds:pcm.length / 2 / 24000,sha256:createHash('sha256').update(pcm).digest('hex')};
}
await writeFile(join(out, 'tool-progress-provenance.json'), JSON.stringify({provider:'seeduplex',voice:'xiaohe',model:'1.2.6.1',sampleRate:24000,format:'pcm16le',
  createdAt:new Date().toISOString(),source:'Actual native SayHello TTS, generated separately from any user/tool continuation',clips}, null, 2) + '\n');
// Prove the files load exactly as the voice service will read them.
const loaded = loadToolProgressClips(pathToFileURL(out + '/'));
console.log(JSON.stringify({out,clips:loaded.map(c => ({text:c.text,seconds:Number(c.seconds.toFixed(2))}))}));

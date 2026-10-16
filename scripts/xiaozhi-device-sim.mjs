#!/usr/bin/env node
// Cloud probe that behaves like xiaozhi-esp32 firmware (e.g. StackChan): OTA
// check by MAC, WebSocket hello, 60 ms Opus uplink of a 16 kHz WAV question,
// then records tts/stt/llm events and the Opus reply. Synthetic input over the
// real path; not hardware or acoustic acceptance.
import {readFileSync, writeFileSync} from 'node:fs';
import {parseArgs} from 'node:util';
import WebSocket from 'ws';
import OpusScript from 'opusscript';

const {values:o} = parseArgs({options:{ota:{type:'string'}, mac:{type:'string'}, input:{type:'string', multiple:true}, output:{type:'string'}, gap:{type:'string', default:'8'}}});
if (!o.ota || !o.mac || !o.input?.length) throw Error('--ota URL, --mac and --input WAV are required');
const t0 = Date.now(), at = () => Date.now() - t0, log = (event, extra = {}) => console.log(JSON.stringify({t:at(), event, ...extra}));
const wavPcm = file => {const b = readFileSync(file);let p = 12;while (p < b.length) {const id = b.toString('ascii', p, p + 4), n = b.readUInt32LE(p + 4);if (id === 'data') return b.subarray(p + 8, p + 8 + n);p += 8 + n + (n & 1);}throw Error('no data');};

const ota = await (await fetch(o.ota, {method:'POST', headers:{'device-id':o.mac, 'content-type':'application/json'}, body:JSON.stringify({application:{version:'sim'}})})).json();
log('ota', {url:ota.websocket?.url, hasToken:Boolean(ota.websocket?.token)});
const ws = new WebSocket(ota.websocket.url, {headers:{authorization:`Bearer ${ota.websocket.token}`, 'protocol-version':'1', 'device-id':o.mac}});
const enc = new OpusScript(16000, 1, OpusScript.Application.VOIP), dec = new OpusScript(24000, 1);
const reply = [];let speaking = false, questionEnd = 0;
ws.on('open', () => {log('open');ws.send(JSON.stringify({type:'hello', version:1, transport:'websocket', features:{mcp:true}, audio_params:{format:'opus', sample_rate:16000, channels:1, frame_duration:60}}));});
ws.on('message', (data, binary) => {
  if (binary) {if (!speaking) log('audio-before-tts-start');reply.push(Buffer.from(dec.decode(data)));return;}
  const e = JSON.parse(data.toString());
  if (e.type === 'tts') {speaking = e.state === 'start' ? true : e.state === 'stop' ? false : speaking;log('tts', {state:e.state, afterQuestionMs:questionEnd ? at() - questionEnd : null});}
  else if (e.type === 'llm') log('reaction', {emotion:e.emotion});
  else log(e.type, e.type === 'hello' ? {audio:e.audio_params} : {});
  if (e.type === 'hello') stream();
});
ws.on('close', code => {log('closed', {code});finish();});
function stream() {
  ws.send(JSON.stringify({type:'listen', state:'start', mode:'auto'}));
  const frames = [];const silence = n => {for (let i = 0; i < n; i++) frames.push(Buffer.alloc(1920));};
  silence(5);
  for (const [i, file] of o.input.entries()) {const pcm = wavPcm(file);for (let p = 0; p < pcm.length; p += 1920) {const f = Buffer.alloc(1920);pcm.copy(f, 0, p, Math.min(p + 1920, pcm.length));frames.push(f);}frames.push({mark:i});silence(Math.round(Number(o.gap) * 1000 / 60));}
  // Like the firmware: no uplink while the device is speaking (auto mode).
  const timer = setInterval(() => {
    if (ws.readyState !== 1) return clearInterval(timer);
    const f = frames.shift();
    if (f?.mark !== undefined) {questionEnd = at();log('question-sent', {index:f.mark});return;}
    if (!speaking) ws.send(enc.encode(f ?? Buffer.alloc(1920), 960), {binary:true});
  }, 60);
}
let done = false;
function finish() {if (done) return;done = true;if (o.output) writeFileSync(o.output, Buffer.concat(reply));log('summary', {replyMs:Math.round(Buffer.concat(reply).length / 48)});process.exit(0);}
setTimeout(() => {log('timeout');ws.close();setTimeout(finish, 1000);}, 90000).unref();

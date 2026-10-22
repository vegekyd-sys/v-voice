import test from 'node:test';
import assert from 'node:assert/strict';
import {consumeTts} from './tts-stream.mjs';
const frame=(code,data)=>JSON.stringify({code,...data?{data:Buffer.from(data).toString('base64')}:{}});
test('NDJSON chunks are delivered before completion even across byte and line boundaries',async()=>{
 let release;const gate=new Promise(r=>release=r),chunks=[];
 const raw=frame(0,'first')+'\n'+frame(0,'second')+'\n'+frame(20000000);
 const response=new Response(new ReadableStream({async start(c){c.enqueue(new TextEncoder().encode(raw.slice(0,12)));c.enqueue(new TextEncoder().encode(raw.slice(12,raw.indexOf('\n')+1)));await gate;c.enqueue(new TextEncoder().encode(raw.slice(raw.indexOf('\n')+1)));c.close();}}));
 const job=consumeTts(response,{onChunk:b=>chunks.push(b.toString())});await new Promise(r=>setImmediate(r));assert.deepEqual(chunks,['first']);release();
 const result=await job;assert.equal(result.audio.toString(),'firstsecond');assert.deepEqual(chunks,['first','second']);
});
test('provider errors and truncated audio never produce a completion receipt',async()=>{
 await assert.rejects(consumeTts(new Response(frame(1234))),/错误/);
 await assert.rejects(consumeTts(new Response(frame(0,'partial'))),/未完整/);
});

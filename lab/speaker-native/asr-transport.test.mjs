import test from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {EventEmitter} from 'node:events';
import {VolcAsrStream,encodeAsrFrame} from '../volc-speaker/volc-asr.mjs';
const payload=frame=>gunzipSync(frame.subarray(8));
test('WebSocket open is not ASR readiness; service initialization must be acknowledged',async()=>{
 const socket=new EventEmitter();socket.send=()=>{};socket.close=()=>socket.emit('close');
 const asr=new VolcAsrStream({apiKey:'test',createWebSocket:()=>socket});let ready=false;
 const pending=asr.connect().then(()=>{ready=true;});socket.emit('open');await Promise.resolve();assert.equal(ready,false);
 socket.emit('message',encodeAsrFrame(9,{result:{}},{json:true}));await pending;assert.equal(ready,true);asr.close();
});
test('an opened ASR socket without an initialization response has a bounded failure',async()=>{
 const socket=new EventEmitter();socket.send=()=>{};socket.close=()=>socket.emit('close');
 const asr=new VolcAsrStream({apiKey:'test',createWebSocket:()=>socket,setupTimeoutMs:20});
 const pending=assert.rejects(asr.connect(),/initialization timed out/);socket.emit('open');
 const keepAlive=setTimeout(()=>{},100);try{await pending;}finally{clearTimeout(keepAlive);}
});
test('cloud ASR receives exact 100ms PCM batches independently of 20ms caller packets',()=>{
 const frames=[],asr=new VolcAsrStream({apiKey:'test'});asr.socket={readyState:1,send:b=>frames.push(b),close(){}};
 const input=Array.from({length:12},(_,n)=>Buffer.alloc(640,n+1));
 for(const b of input)asr.append(b);
 assert.equal(frames.length,2);assert(frames.every(f=>payload(f).length===3200));
 asr.finish();assert.equal(frames.length,4);assert.deepEqual(Buffer.concat(frames.map(payload)),Buffer.concat(input));assert.equal(frames.at(-1)[1]&2,2);assert.equal(asr.pendingAudio.length,0);
});
test('reconnect cannot leak a discarded ASR tail or accumulate audio on a closed socket',()=>{
 const asr=new VolcAsrStream({apiKey:'test'});asr.socket={readyState:1,send(){},close(){this.readyState=3;}};asr.append(Buffer.alloc(640));asr.close();asr.append(Buffer.alloc(20000));assert.equal(asr.pendingAudio.length,0);
});

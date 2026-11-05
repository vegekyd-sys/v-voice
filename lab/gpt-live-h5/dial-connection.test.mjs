import test from 'node:test';
import assert from 'node:assert/strict';
import {createDialConnection} from './dial-connection.mjs';
class Socket {
  static OPEN=1;readyState=1;
  close(){this.readyState=3;this.onclose?.();}
  message(value){this.onmessage?.({data:JSON.stringify(value)});}
}
const reserved={type:'reservation',dialVersion:2,voiceSessionId:'test',transport:'gateway-relay'};
test('coalesced ready and first audio survive reservation handoff in order without opening another socket',async()=>{
 const connection=createDialConnection({url:'ws://fixture',Socket});
 connection.socket.message(reserved);connection.socket.message({type:'ready'});connection.socket.message({type:'audio',audio:'AAA='});
 assert.equal((await connection.reservation).voiceSessionId,'test');
 const frames=[];connection.socket.onmessage=e=>frames.push(JSON.parse(e.data));connection.adopt();
 assert.deepEqual(frames.map(e=>e.type),['ready','audio']);connection.dispose();
});
test('cancel before reservation rejects and closes; lost socket after reservation is delivered to adapter',async()=>{
 const controller=new AbortController(),a=createDialConnection({url:'ws://fixture',Socket,signal:controller.signal});
 controller.abort();await assert.rejects(a.reservation,{name:'AbortError'});assert.equal(a.socket.readyState,3);
 const b=createDialConnection({url:'ws://fixture',Socket});b.socket.message(reserved);await b.reservation;b.socket.close();
 let closed=false;b.socket.onclose=()=>closed=true;b.adopt();assert.equal(closed,true);
});
test('invalid or overflowing startup frames close the allocation and cannot be mistaken for ready',async()=>{
 const a=createDialConnection({url:'ws://fixture',Socket});a.socket.message({type:'ready'});await assert.rejects(a.reservation,/无效/);
 const b=createDialConnection({url:'ws://fixture',Socket});b.socket.message(reserved);await b.reservation;
 for(let i=0;i<129;i++)b.socket.message({type:'audio'});
 let closed=false;b.socket.onclose=()=>closed=true;b.adopt();assert.equal(closed,true);assert.equal(b.socket.readyState,3);
});

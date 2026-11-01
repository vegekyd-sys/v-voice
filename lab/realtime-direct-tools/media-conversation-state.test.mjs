import test from 'node:test';
import assert from 'node:assert/strict';
import {createMediaConversationState} from './media-conversation-state.mjs';

test('completed assets retain original requests across status reuse, with actual display receipt and call isolation',()=>{
  const state=createMediaConversationState();
  const record={id:'image',kind:'image',request:'清迈街景加皮卡丘',output:{media:{url:'https://cdn.example/pikachu.jpg'},presentation:{published:true,shown:true}}};
  assert(state.record(record));
  assert(state.record({id:'video',kind:'video',request:'把它做成15秒动画',output:{media:{url:'https://cdn.example/clip.mp4',taskId:'original-task'},presentation:{published:true,shown:false}}}));
  assert.equal(state.record({...record,id:'repeat',request:'做好了吗'}),false);
  const text=state.context();assert.match(text,/清迈街景加皮卡丘/);assert.match(text,/把它做成15秒动画/);assert.match(text,/"presentation":"submitted"/);assert.match(text,/"presentation":"shown"/);assert.doesNotMatch(text,/做好了吗/);
  assert.equal(createMediaConversationState().context(),'');
  assert.equal(state.record({id:'failed',output:{isError:true,media:{url:'https://cdn.example/no.mp4'}}}),false);
});

test('media context is bounded and never admits local paths or authenticated URLs',()=>{
  const state=createMediaConversationState();
  for(const url of ['/tmp/output.jpg','https://user:password@example.com/a.jpg'])assert.equal(state.record({id:url,output:{media:{url}}}),false);
  for(let i=0;i<30;i++)state.record({id:String(i),kind:'image',request:'x'.repeat(2000),output:{media:{url:'https://cdn.example/'+String(i)+'x'.repeat(1500)+'.jpg'}}});
  assert(state.context().length<11000);assert(!state.context().includes('https://cdn.example/0x'));assert(state.context().includes('https://cdn.example/29x'));
});

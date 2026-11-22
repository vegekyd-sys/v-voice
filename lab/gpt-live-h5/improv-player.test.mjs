import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createImprovPlayer} from './improv-player.mjs';
import {createImprovShow} from '../realtime-direct-tools/improv-live.mjs';

test('one invited live show owns its signaling, heartbeat and retirement',async () => {
  let event;
  const requests = [], send = value => { event = value; };
  const show = createImprovShow({key:'fixture',fetcher:async (url,init) => {
    requests.push({url,init});
    return Response.json({session_id:'provider-fixture'});
  }});
  const start = {action:'start',shot:'雨夜，猫在店门前撑开小伞'};
  for (const text of ['生成一段视频','找一场直播','他说“给我们来场直播”','别开直播','怎么开直播']) {
    assert.throws(()=>show.command(start,{text},send));
  }
  const invite = {text:'给我们搞场直播！'};
  show.command(start,invite,send);
  const {id} = event;
  const url = 'https://wma.fal.run/session', body = {app_id:'minimax/h3-max/director',type:'offer',sdp:'fixture'};
  const proxy = (target,params,owner=id) => show.proxy(owner,target,params,new AbortController().signal);
  assert.equal((await proxy(url,body,'foreign'))[0],409);
  assert.equal((await proxy('https://example.invalid/',body))[0],400);
  assert.equal((await proxy(url,{...body,app_id:'other'}))[0],400);
  const [first,replay] = await Promise.all([proxy(url,body),proxy(url,body)]);
  assert.deepEqual([first[0],replay[0]],[200,409]);
  assert.equal((await proxy(url+'/heartbeat',{session_id:'another'}))[0],400);
  assert.equal((await proxy(url+'/heartbeat',{session_id:'provider-fixture'}))[0],200);
  assert.equal(requests.length,2);
  assert.equal(show.end('old'),false);
  show.command({action:'end'}, {},send);
  assert.equal((await proxy(url,body))[0],409);
  assert.throws(()=>show.command(start,invite,send));
});

test('early directions coalesce, first media is independent of acknowledgments, ended shows ignore late events',async () => {
  let callbacks, view, keeps = 0, closed = 0;
  const messages = [], ended = [];
  const player = createImprovPlayer({open:async (_id,cb) => {
    callbacks = cb;
    return {ready:Promise.resolve(),send:value=>messages.push(value),close:async()=>{closed++;}};
  },update:v=>{view=v;},ended:id=>ended.push(id),notice:()=>{},keep:()=>{keeps++;}});
  const command = (action,shot) => player.receive({action,id:'show',shot});
  await command('start','猫在守夜');
  await command('direct','看门口');
  await command('direct','看对面的小狗');
  callbacks.onData({type:'configured'});
  assert.deepEqual(messages.map(m=>m.type),['configure','prompt']);
  assert.equal(messages[1].prompt,'看对面的小狗');
  assert.equal(view.stream,null);
  callbacks.onMedia('video-stream');
  await command('keep');
  await command('end');
  callbacks.onMedia('retired-stream');
  assert.equal(view,null);
  assert.deepEqual([keeps,closed,ended],[1,1,['show']]);
  assert.equal(messages.at(-1).type,'stop');
});

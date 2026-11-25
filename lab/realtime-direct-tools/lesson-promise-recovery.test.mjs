import test from 'node:test';
import assert from 'node:assert/strict';
import {createLessonPromiseRecovery,promisesLesson} from './lesson-promise-recovery.mjs';

test('the lesson line alone is a promise; a longer answer, a question or another line is not',()=>{
 for(const text of ['好，我讲讲。','好，我讲讲广州的老景点。','好的，我来讲讲。','嗯，我给你讲讲','好，那我讲讲。'])assert.equal(promisesLesson(text),true,text);
 for(const text of ['好，我们接着说。','好，我讲讲？','正在整理，会把第一次来广州最值得体验的都讲清楚。','好，我讲讲。\n等下画面会配上实景图，慢慢给你说～，先说广州塔，再说早茶和骑楼','知道呀，它是第五世代的传说宝可梦','好，我去看看。',''])assert.equal(promisesLesson(text),false,text);
});

test('call c58fea83: "好，我讲讲。" with no tool called starts the lesson once, for the caller\'s words',()=>{
 let at=0;const started=[],audited=[],state={current:true,offered:true};
 const r=createLessonPromiseRecovery({state:()=>state,start:text=>started.push(text),audit:e=>audited.push(e.type),now:()=>at,settleMs:10});
 r.user('你给我介绍一下广州可以吧？');r.assistant('好，我讲讲。');
 at=5;r.tick();assert.equal(started.length,0,'the call may still come a moment after the line');
 state.userSpeaking=true;at=20;r.tick();assert.equal(started.length,0,'not while the caller is talking');
 state.userSpeaking=false;r.tick();r.tick();
 assert.deepEqual(started,['你给我介绍一下广州可以吧？']);assert.deepEqual(audited,['lesson.promise-recovery']);
 r.assistant('好，我讲讲。');at=40;r.tick();assert.equal(started.length,1,'once per turn');
});

test('a real call in the turn, a new turn, a lesson already under way, a hang-up or a routed call leave it alone',()=>{
 let at=0;const started=[],state={current:true,offered:true};
 const r=createLessonPromiseRecovery({state:()=>state,start:text=>started.push(text),now:()=>at,settleMs:10});
 // (Calls 1e67d808, 0f22e44a: the call came first, the line after.)
 r.user('什么叫圣剑士啊？');r.started();r.assistant('好，我讲讲。');at+=20;r.tick();
 // (Call 2ec71f66: the line first, the call three seconds later.)
 r.user('介绍一下故宫');r.assistant('好，我讲讲。');at+=5;r.started();at+=20;r.tick();
 r.user('讲讲勾股定理');r.assistant('好，我讲讲。');r.user('算了不用了');at+=20;r.tick();
 r.user('讲讲勾股定理');r.assistant('好，我讲讲。');state.explaining=true;at+=20;r.tick();state.explaining=false;
 r.user('讲讲勾股定理');r.assistant('好，我讲讲。');state.ending=true;at+=20;r.tick();state.ending=false;
 r.user('讲讲勾股定理');r.assistant('好，我讲讲。');state.routed=true;at+=20;r.tick();state.routed=false;
 r.user('讲讲勾股定理');r.assistant('好，我讲讲。');state.offered=false;at+=20;r.tick();state.offered=true;
 r.assistant('好，我讲讲。');at+=20;r.tick();
 assert.equal(started.length,0);
 r.user('讲讲勾股定理');r.assistant('好，我们接着说。');at+=20;r.tick();assert.equal(started.length,0);
});

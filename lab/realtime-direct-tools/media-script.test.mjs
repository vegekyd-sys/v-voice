import {test} from 'node:test';
import assert from 'node:assert/strict';
import {asksInEnglish,createVideoScriptWriter,fitScript,scriptOf,usableScript,withScript} from './media-script.mjs';
import {mediaArgv,validateMediaArgv} from './media-cli.mjs';

const SHOTS='<<<media_1>>>（尼卡路飞）在左，<<<media_2>>>（基格尔德）在右。\nShot 1 (2s): 中景，推镜。路飞出拳。\nShot 2 (3s): 近景，环绕。基格尔德格挡。\nStyle: 热血动漫。';

test('a rewritten script is used only if it still names every picture and its shots add up',()=>{
 assert.equal(usableScript(SHOTS,{media:2,seconds:5}),'<<<media_1>>>（尼卡路飞）在左，<<<media_2>>>（基格尔德）在右。 Shot 1 (2s): 中景，推镜。路飞出拳。 Shot 2 (3s): 近景，环绕。基格尔德格挡。 Style: 热血动漫。');
 assert.equal(usableScript('```\n'+SHOTS+'\n```',{media:2,seconds:5}).startsWith('<<<media_1>>>'),true);
 // Its seconds do not add up: the shots are re-timed in proportion, not the script thrown away
 // (call of 11/21: a fifteen-second script was refused for a second's difference and the draft was filmed).
 const long=fitScript(SHOTS,{media:2,seconds:10});
 assert.deepEqual([...long.script.matchAll(/Shot \d+ \((\d+)s\)/gu)].map(m=>Number(m[1])),[4,6]);
 assert.deepEqual(long.mended,['timing 5→10']);
 const seven='<<<media_1>>>（海报）。'+[2,2,2,3,2,2,3].map((n,i)=>`Shot ${i+1} (${n}s): 镜头${i+1}，动作。`).join(' ')+' Style: 热血。';
 const fitted=fitScript(seven,{media:1,seconds:15});
 assert.equal([...fitted.script.matchAll(/Shot \d+ \((\d+)s\)/gu)].reduce((sum,m)=>sum+Number(m[1]),0),15);
 assert.equal(fitScript(seven,{media:1,seconds:5}).why,'shots 7 in 5s');
 // Halves of seconds are made whole, still adding up.
 const halves=fitScript('<<<media_1>>>（瓶子）。 Shot 1 (2s): a动作一。 Shot 2 (2.5s): b动作二。 Shot 3 (2.5s): c动作三。 Shot 4 (3s): d动作四。 Style: 干净。',{media:1,seconds:10});
 assert.equal([...halves.script.matchAll(/Shot \d+ \((\d+)s\)/gu)].reduce((sum,m)=>sum+Number(m[1]),0),10);
 assert.deepEqual(halves.mended,['whole seconds']);
 // A script without its style line is given a plain one, in the language of the request.
 const bare=fitScript('<<<media_1>>>（小狗）。 Shot 1 (5s): 俯拍中景，小狗歪头摇尾巴。',{media:1,seconds:5});
 assert.match(bare.script,/ Style: 电影感/u); assert.deepEqual(bare.mended,['style']);
 assert.match(fitScript('<<<media_1>>> (the fjord). Shot 1 (5s): slow push in over the cliff.',{media:1,seconds:5,english:true}).script,/ Style: cinematic/u);
 assert.equal(fitScript(SHOTS,{media:2,seconds:5}).mended.includes('style'),false);
 // A picture given and not named is reported (the writer names it at the head); one named that was not given is unnamed.
 assert.deepEqual(fitScript(SHOTS,{media:3,seconds:5}).missing,[3]);
 assert.equal(usableScript(SHOTS,{media:3,seconds:5}),'');
 assert.equal(fitScript(SHOTS,{media:1,seconds:5}).script.includes('<<<media_2>>>'),false);
 assert.equal(usableScript('好的',{media:0,seconds:5}),'');
 // One continuous take needs no shots.
 assert.ok(usableScript('以 <<<media_1>>>（这张海报）的画面为开场，小猫竖起耳朵，猛地扑向镜头。Style: 温暖。',{media:1,seconds:5}));
});

test('the director writes over the draft; a slow, silent or careless writer leaves it',async()=>{
 const seen=[],audits=[];
 const writer=createVideoScriptWriter({audit:event=>audits.push(event),vision:true,look:async url=>'data:image/jpeg;base64,'+Buffer.from(url).toString('base64'),
  complete:async function*({messages}){seen.push(messages);yield SHOTS;}});
 const media=[{name:'尼卡海报',see:'白发的路飞',url:'https://cdn.example/a.jpg'},{name:'基格尔德 完全体形态',see:'黑色巨人',url:'https://voice.example/b.jpg'}];
 assert.ok((await writer.write({ask:'让他们打起来，要很激烈',draft:'<<<media_1>>> <<<media_2>>> 打起来',seconds:5,media})).startsWith('<<<media_1>>>（尼卡路飞）'));
 const request=seen[0][1].content;
 assert.equal(request.filter(part=>part.type==='image_url').length,2,'shown both pictures');
 assert.deepEqual(JSON.parse(request.at(-1).text).media,[{n:1,name:'尼卡海报',shows:'白发的路飞'},{n:2,name:'基格尔德 完全体形态',shows:'黑色巨人'}]);
 assert.equal(JSON.parse(request.at(-1).text).ask,'让他们打起来，要很激烈');
 assert.deepEqual(audits.map(({ok,vision,media})=>[ok,vision,media]),[[true,true,2]]);
 // Its shots add up to five of the ten seconds asked for: re-timed and used.
 assert.match(await writer.write({ask:'x',draft:'y',seconds:10,media}),/Shot 1 \(4s\).*Shot 2 \(6s\)/u);
 assert.equal(audits.at(-1).mended,'timing 5→10');
 // A picture left out is named at the head rather than lost.
 assert.match(await writer.write({ask:'x',draft:'y',seconds:5,media:[...media,{name:'皮卡丘',url:''}]}),/^<<<media_3>>>（皮卡丘）也要出现在画面里。/u);
 const slow=createVideoScriptWriter({timeoutMs:20,complete:async function*({signal}){await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted'))));yield SHOTS;}});
 assert.equal(await slow.write({ask:'x',draft:'y',seconds:5,media:[]}),'');
 assert.equal(createVideoScriptWriter({complete:null}),null);
});

test('the script is put back into the very command it came from, and the executor still accepts it',()=>{
 const A='https://cdn.example/a.jpg',B='https://voice.example/voice/board-shared/0123456789abcdef0123456789abcdef.png';
 const argv=mediaArgv(`makaron video create --video-model fal-h3-max --duration 5 --video-resolution 768p --image '${A}' --image '${B}' --script '<<<media_1>>> 和 <<<media_2>>> 打起来'`);
 assert.deepEqual(scriptOf(argv),{draft:'<<<media_1>>> 和 <<<media_2>>> 打起来',seconds:5,images:[A,B]});
 const script=usableScript(SHOTS.replace('路飞出拳','路飞大喊：“还不够！”，一拳打出 it\'s'),{media:2,seconds:5});
 const command=withScript(argv,script),again=mediaArgv(command);
 assert.equal(again[again.indexOf('--script')+1],script,'quotes in the script survive');
 assert.equal(validateMediaArgv(again).flags.image,A+' '+B);
 assert.deepEqual(again.filter((_,index)=>again[index-1]!=='--script'),argv.filter((_,index)=>argv[index-1]!=='--script'));
 assert.equal(scriptOf(mediaArgv("makaron edit --image-model gpt-image-2.6-flare '一只猫'")),null);
 assert.equal(withScript(mediaArgv("makaron edit --image-model gpt-image-2.6-flare '一只猫'"),'x'),null);
});

test('a request in English is written in English',async()=>{
 assert.equal(asksInEnglish('make it a cinematic 8 second drone shot'),true);
 assert.equal(asksInEnglish('做成 cinematic 的 drone shot 吧'),false);
 assert.equal(asksInEnglish('OK'),false); assert.equal(asksInEnglish(''),false);
 const asked=[];
 const writer=createVideoScriptWriter({complete:async function*(request){asked.push(request);yield '<<<media_1>>> (the fjord). Shot 1 (5s): slow push in over the cliff, clouds drifting.';}});
 const script=await writer.write({ask:'make it a cinematic drone shot',draft:'<<<media_1>>> 航拍',seconds:5,media:[{name:'峡湾',see:''}]});
 assert.match(script,/Style: cinematic/u);
 const sent=asked[0].messages[1].content;
 assert.match(sent,/"language":"English"/u); assert.match(sent,/Write the whole script in English\.$/u);
 asked.length=0;
 await writer.write({ask:'让它动起来',draft:'<<<media_1>>> 动起来',seconds:5,media:[{name:'峡湾',see:''}]});
 assert.doesNotMatch(asked[0].messages[1].content,/language|English/u);
});

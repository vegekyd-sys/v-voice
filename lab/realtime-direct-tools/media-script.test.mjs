import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createVideoScriptWriter,scriptOf,usableScript,withScript} from './media-script.mjs';
import {mediaArgv,validateMediaArgv} from './media-cli.mjs';

const SHOTS='<<<media_1>>>（尼卡路飞）在左，<<<media_2>>>（基格尔德）在右。\nShot 1 (2s): 中景，推镜。路飞出拳。\nShot 2 (3s): 近景，环绕。基格尔德格挡。\nStyle: 热血动漫。';

test('a rewritten script is used only if it still names every picture and its shots add up',()=>{
 assert.equal(usableScript(SHOTS,{media:2,seconds:5}),'<<<media_1>>>（尼卡路飞）在左，<<<media_2>>>（基格尔德）在右。 Shot 1 (2s): 中景，推镜。路飞出拳。 Shot 2 (3s): 近景，环绕。基格尔德格挡。 Style: 热血动漫。');
 assert.equal(usableScript('```\n'+SHOTS+'\n```',{media:2,seconds:5}).startsWith('<<<media_1>>>'),true);
 assert.equal(usableScript(SHOTS,{media:2,seconds:10}),'','the shots are five seconds of a ten-second film');
 assert.equal(usableScript(SHOTS,{media:3,seconds:5}),'','the third picture is not used');
 assert.equal(usableScript(SHOTS,{media:1,seconds:5}),'','a picture that was not given is named');
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
 // Its shots do not add up to the ten seconds asked for: the draft stays.
 assert.equal(await writer.write({ask:'x',draft:'y',seconds:10,media}),'');
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
 assert.equal(scriptOf(mediaArgv("makaron edit --image-model gemini-2.1 '一只猫'")),null);
 assert.equal(withScript(mediaArgv("makaron edit --image-model gemini-2.1 '一只猫'"),'x'),null);
});

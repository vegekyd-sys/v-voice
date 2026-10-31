import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createVoiceMediaCli,mediaArgv,validateMediaArgv} from './media-cli.mjs';

test('CLI arguments preserve quoted user content but cannot run shell or other commands',()=>{
  assert.deepEqual(mediaArgv(`makaron edit --image-model wan2.7-image 'a cat; $(touch /tmp/bad) "hello"'`),['edit','--image-model','wan2.7-image','a cat; $(touch /tmp/bad) "hello"']);
  for(const command of ['makaron edit x; touch /tmp/bad','makaron edit $(whoami)','makaron edit `id`','makaron edit x | cat','makaron edit x\nwhoami','sh -c makaron','makaron edit "unclosed'])assert.throws(()=>mediaArgv(command));
  for(const argv of [['edit','--image-model','gpt-image-2.5-flare','x'],['chat','hello'],['edit','--image-model','openai','x'],['edit','--image-model','wan2.7-image','--out','/tmp/a','x'],['edit','--image-model','wan2.7-image','--image','/etc/passwd','x'],['video','create','--video-model','fal-h3-max','--duration','99','--script','x'],['video','status','task','--wait'],['create','--title','empty']])assert.throws(()=>validateMediaArgv(argv));
});
test('image-to-video requires valid media references before any subprocess or charge',async t=>{
 const {runner}=await fixture(t);
 const prefix="makaron video create --video-model fal-h3-max --image 'https://cdn.example/image.png' --script ";
 await assert.rejects(runner.execute(prefix+"'animate the cat'"),/本地校验未提交、未扣费/);
 await assert.rejects(runner.execute(prefix+"'animate <<<media_2>>>'"),/本地校验未提交、未扣费/);
 await assert.rejects(runner.execute("makaron video create --video-model fal-h3-max --script 'animate <<<media_1>>>'"),/本地校验未提交、未扣费/);
 await assert.rejects(runner.execute('makaron video status task-123'),/本通话/);
 assert.equal((await runner.execute(prefix+"'animate <<<media_1>>>'")).isError,false);
 assert.equal((await runner.execute('makaron video status task-123')).isError,false);
});
async function fixture(t,opts={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'media-cli-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const binary=path.join(root,'makaron');
 await fs.writeFile(binary,`#!${process.execPath}\n`+`import fs from 'node:fs';\nconst a=process.argv.slice(2);\nif(a.includes('hang')){console.log('started');setInterval(()=>{},100);}\nelse if(a.includes('fail')){console.error(process.env.MAKARON_API_KEY);process.exitCode=2;}\nelse if(a[0]==='edit'){fs.writeFileSync(a[a.indexOf('--out')+1].replace(/png$/, 'jpg'),'image');console.log('image generated');}\nelse if(a[0]==='create')console.log('https://cdn.example/image.png');\nelse if(a[1]==='create')console.log('Task ID: task-123');\nelse console.log('https://cdn.example/video.mp4');\nif(process.env.UNRELATED_SECRET)throw Error('unrelated secret leaked');`,{mode:0o700});
 const cli=createVoiceMediaCli({binary,baseDirectory:root,completeMedia:false,environment:{PATH:process.env.PATH,MAKARON_API_KEY:'fixture-private-key',UNRELATED_SECRET:'must-not-inherit'},...opts});
 return {cli,runner:await cli.forCall(),root};
}
test('real subprocess enforces per-call file/task ownership, idempotency, exit code and secret filtering',async t=>{
 const {runner,cli}=await fixture(t);const other=await cli.forCall();
 const command=`makaron edit --image-model wan2.7-image 'moon'`;
 const [one,two]=await Promise.all([runner.execute(command),runner.execute(command)]);
 assert.equal(one,two);assert.equal(one.isError,false);
 const file=one.content[0].text.match(/Image file: (.*)/u)[1];assert(file.endsWith('.jpg'));
 assert.equal((await runner.execute(`makaron create --image '${file}' --title 'Moon'`)).isError,false);
 await assert.rejects(other.execute(`makaron create --image '${file}'`),/本通话/);
 await assert.rejects(runner.execute('makaron create --image /etc/passwd'),/本通话/);
 await runner.execute(`makaron video create --video-model fal-h3-max --duration 5 --script 'rotate'`);
 assert.equal((await runner.execute('makaron video status task-123')).isError,false);
 await assert.rejects(other.execute('makaron video status task-123'),/本通话/);
 const failure=await runner.execute(`makaron edit --image-model wan2.7-image 'fail'`);
 assert.equal(failure.isError,true);assert.equal(failure.details.exitCode,2);assert(!JSON.stringify(failure).includes('fixture-private-key'));
 assert.equal(await runner.execute(`makaron edit --image-model wan2.7-image 'fail'`),failure);
});
test('cancellation and timeout wait for process exit and do not resubmit uncertain generation',async t=>{
 const {runner}=await fixture(t,{timeoutMs:80});
 const result=await runner.execute(`makaron edit --image-model wan2.7-image 'hang'`);
 assert.equal(result.isError,true);assert(result.details.exitSignal);assert.match(result.content[0].text,/超时/);
 const {runner:second}=await fixture(t);const controller=new AbortController();
 const pending=second.execute(`makaron edit --image-model wan2.7-image 'hang'`,controller.signal);
 setTimeout(()=>controller.abort(),100);const aborted=await pending;
 assert.equal(aborted.isError,true);assert(aborted.details.exitSignal);assert.match(aborted.content[0].text,/中止/);
});
test('one video status call follows the same rendering task through to its playable result',async t=>{
 const {runner,root}=await fixture(t,{pollIntervalMs:10});
 await runner.execute("makaron video create --video-model fal-h3-max --script 'rotate'");
 const counter=path.join(root,'queries');
 await fs.writeFile(path.join(root,'makaron'),`#!${process.execPath}\n`+`import fs from 'node:fs';const args=process.argv.slice(2);if(JSON.stringify(args)!==JSON.stringify(['video','status','task-123']))process.exit(9);const p=${JSON.stringify(counter)};const n=fs.existsSync(p)?Number(fs.readFileSync(p))+1:1;fs.writeFileSync(p,String(n));console.log(n<3?'FAL H3 Max video is rendering.':'Video ready: https://cdn.example/final.mp4');`,{mode:0o700});
 const result=await runner.execute('makaron video status task-123');
 assert.equal(result.isError,false);assert.match(result.content[0].text,/final.mp4/);assert.equal(await fs.readFile(counter,'utf8'),'3');
});
test('cancelling a pending video wait stops polling without creating another task',async t=>{
 const {runner,root}=await fixture(t,{pollIntervalMs:500});
 await runner.execute("makaron video create --video-model fal-h3-max --script 'rotate'");
 const counter=path.join(root,'queries');
 await fs.writeFile(path.join(root,'makaron'),`#!${process.execPath}\n`+`import fs from 'node:fs';if(process.argv[3]!=='status')process.exit(9);fs.writeFileSync(${JSON.stringify(counter)},'queried');console.log('FAL H3 Max video is rendering.');`,{mode:0o700});
 const controller=new AbortController(),pending=runner.execute('makaron video status task-123',controller.signal);
 while(true){try{await fs.stat(counter);break;}catch{await new Promise(r=>setTimeout(r,5));}}
 setTimeout(()=>controller.abort(),50);
 await assert.rejects(pending,/abort/iu);
});
test('CLI capability requires an explicitly supplied existing key',()=>assert.equal(createVoiceMediaCli({environment:{}}),null));

test('one image operation returns a URL and never exposes a file-save step to the model',async t=>{
 const {runner,root}=await fixture(t,{completeMedia:true});
 const result=await runner.execute("makaron edit --image-model wan2.7-image 'moon'");
 assert.deepEqual(result.media,{kind:'image',url:'https://cdn.example/image.png'});
 assert.doesNotMatch(JSON.stringify(result),/Image file:|voice-media-|Saved to:/);
 const dir=(await fs.readdir(root)).find(x=>x.startsWith('voice-media-'));
 const receipts=await Promise.all((await fs.readdir(path.join(root,dir))).filter(x=>x.startsWith('receipt-')).map(x=>fs.readFile(path.join(root,dir,x),'utf8').then(JSON.parse)));
 assert.deepEqual(receipts.map(r=>r.operation).sort(),['create','edit']);
 const reordered=await runner.execute("makaron edit 'moon' --image-model wan2.7-image");
 assert.equal(reordered,result);
});
test('one video operation polls its original task; status questions and concurrent rephrasing cannot spend again',async t=>{
 const {runner,root}=await fixture(t,{completeMedia:true,pollIntervalMs:1});
 const log=path.join(root,'invocations');
 await fs.writeFile(path.join(root,'makaron'),`#!${process.execPath}\nimport fs from 'node:fs';const a=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(log)},a.join(' ')+'\\n');if(a[1]==='create')console.log('Task ID: task-123');else console.log('https://cdn.example/video.mp4');`,{mode:0o700});
 const first=runner.execute("makaron video create --video-model fal-h3-max --script 'animate'");
 const second=runner.execute("makaron video create --video-model fal-h3-max --script 'animate differently'");
 assert.equal(first,second);
 const result=await first;
 assert.deepEqual(result.media,{kind:'video',url:'https://cdn.example/video.mp4',taskId:'task-123'});
 assert.equal(await runner.execute("makaron video create --video-model fal-h3-max --script 'again'",undefined,{reuseExisting:true}),result);
 assert.equal((await fs.readFile(log,'utf8')).trim().split('\n').length,2);
});
test('a status-only question with no original task cannot start a generation',async t=>{
 const {runner}=await fixture(t,{completeMedia:true});
 const result=await runner.execute("makaron video create --video-model fal-h3-max --script 'animate'",undefined,{reuseExisting:true});
 assert.equal(result.isError,true);assert.equal(result.details.status,'not-started');
});

test('a failed reference cannot become a second text-to-video submission in the same human turn',async t=>{
 const {runner,root}=await fixture(t,{completeMedia:true});
 const log=path.join(root,'submissions');
 await fs.writeFile(path.join(root,'makaron'),`#!${process.execPath}\nimport fs from 'node:fs';fs.appendFileSync(${JSON.stringify(log)},'submit\\n');console.log('[NON_RETRYABLE:INVALID_INPUT_IMAGE] No generation was submitted');process.exitCode=1;`,{mode:0o700});
 const requestToken={};
 const first=await runner.execute("makaron video create --video-model fal-h3-max --image 'https://cdn.example/missing.jpg' --script 'animate <<<media_1>>>'",undefined,{requestToken});
 assert.equal(first.isError,true);
 const fallback=await runner.execute("makaron video create --video-model fal-h3-max --script 'recreate it from words'",undefined,{requestToken});
 assert.equal(fallback,first);assert.equal((await fs.readFile(log,'utf8')).trim().split('\n').length,1);
 // A later explicit human request can authorize a different submission.
 await runner.execute("makaron video create --video-model fal-h3-max --script 'recreate it from words'",undefined,{requestToken:{}});
 assert.equal((await fs.readFile(log,'utf8')).trim().split('\n').length,2);
});

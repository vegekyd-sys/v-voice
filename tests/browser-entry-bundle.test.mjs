import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {buildBrowser,BROWSER_BUNDLE,buildEntryBootstrap,ENTRY_BOOTSTRAP} from '../scripts/build-browser.mjs';
import {createLiveH5Server} from '../lab/gpt-live-h5/server.mjs';

test('browser bundle matches its owning sources and keeps one independent entry startup',async()=>{
  const [built,committed]=await Promise.all([buildBrowser(),readFile(BROWSER_BUNDLE)]);
  assert(Buffer.from(built).equals(committed),'Run npm run build:ui and commit app-bundle.mjs');
  const code=committed.toString();
  assert(!/\bfrom["']\./.test(code),'the browser bundle has no network module dependencies');
  const bootstrap=await readFile(ENTRY_BOOTSTRAP);
  assert(Buffer.from(await buildEntryBootstrap()).equals(bootstrap));
  assert.match(code,/v-voice\.entry-startup/);assert.match(bootstrap.toString(),/v-voice\.entry-startup/);
});

test('inline startup and the subsequently evaluated bundle share a single SDK exchange',async()=>{
  let sdkStarts=0,exchanges=0;
  const document={documentElement:{dataset:{}},getElementById:id=>({textContent:JSON.stringify(id==='login-config'
    ?{appId:'fixture',state:'fixture',endpoint:'/exchange'}:{ready:true,unidentified:true})}),
    createElement:()=>({}),head:{append:script=>script.onload()}};
  const window={document,location:{search:'?phone=fixture',hash:'',pathname:'/voice/'},history:{replaceState(){}},
    tt:{requestAccess:({success})=>{sdkStarts++;success({code:'fixture'});}},h5sdk:{error(){},ready:fn=>fn()}};
  const sandbox=vm.createContext({window,document,URLSearchParams,Symbol,Date,setTimeout,clearTimeout,AbortController,
    performance:{mark(){},getEntriesByType:()=>[]},fetch:async()=>{exchanges++;return {ok:true,json:async()=>({status:{ready:true,accountLabel:'Fixture'}})};}});
  const source=await readFile(ENTRY_BOOTSTRAP,'utf8');vm.runInContext(source,sandbox);
  const first=window[Symbol.for('v-voice.entry-startup')];await first;
  vm.runInContext(source,sandbox);
  assert.equal(window[Symbol.for('v-voice.entry-startup')],first);
  assert.equal(sdkStarts,1);assert.equal(exchanges,1);
});

test('served document prioritizes login and serves only its exact code revision as immutable',async t=>{
  const bridge=createLiveH5Server({preview:true});
  await new Promise(r=>bridge.server.listen(0,'127.0.0.1',r));t.after(()=>bridge.dispose());
  const origin=`http://127.0.0.1:${bridge.server.address().port}`;
  const page=await fetch(origin),html=await page.text();
  assert.equal(page.headers.get('cache-control'),'no-store');
  const preloads=[...html.matchAll(/rel="modulepreload" href="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(preloads.length,1);
  assert.match(html,/<script type="module" data-voice-entry-bootstrap>/);
  assert(!html.includes('src="./entry-startup.mjs"'));
  const script=html.match(/<script type="module" src="(\.\/app-bundle\.mjs\?v=[a-f0-9]{64})"><\/script>/)?.[1];
  assert.equal(script,preloads[0]);
  const bundle=await fetch(new URL(script,origin));
  assert.equal(bundle.status,200);assert.equal(bundle.headers.get('cache-control'),'private, max-age=31536000, immutable');
  assert.equal(await bundle.text(),await readFile(BROWSER_BUNDLE,'utf8'));
  for(const path of ['/app-bundle.mjs','/app-bundle.mjs?v=old','/entry-startup.mjs','/feishu-client-login.mjs']){
    const response=await fetch(origin+path);assert.equal(response.status,200);
    assert.equal(response.headers.get('cache-control'),'no-store');
  }
});

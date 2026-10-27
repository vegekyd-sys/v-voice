import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildBrowser,BROWSER_BUNDLE} from '../scripts/build-browser.mjs';
import {createLiveH5Server} from '../lab/gpt-live-h5/server.mjs';

test('browser bundle matches its owning sources and keeps one independent entry startup',async()=>{
  const [built,committed]=await Promise.all([buildBrowser(),readFile(BROWSER_BUNDLE)]);
  assert(Buffer.from(built).equals(committed),'Run npm run build:ui and commit app-bundle.mjs');
  const code=committed.toString();
  assert.match(code,/from["']\.\/entry-startup\.mjs["']/);
  assert(!code.includes('voice-entry-profile'),'the call bundle must not duplicate the identity bootstrap');
});

test('served document prioritizes login and serves only its exact code revision as immutable',async t=>{
  const bridge=createLiveH5Server({preview:true});
  await new Promise(r=>bridge.server.listen(0,'127.0.0.1',r));t.after(()=>bridge.dispose());
  const origin=`http://127.0.0.1:${bridge.server.address().port}`;
  const page=await fetch(origin),html=await page.text();
  assert.equal(page.headers.get('cache-control'),'no-store');
  const preloads=[...html.matchAll(/rel="modulepreload" href="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(preloads.length,3);
  assert.deepEqual(preloads.slice(0,2),['./entry-startup.mjs','./feishu-client-login.mjs']);
  const script=html.match(/<script type="module" src="(\.\/app-bundle\.mjs\?v=[a-f0-9]{64})"><\/script>/)?.[1];
  assert.equal(script,preloads[2]);
  const bundle=await fetch(new URL(script,origin));
  assert.equal(bundle.status,200);assert.equal(bundle.headers.get('cache-control'),'private, max-age=31536000, immutable');
  assert.equal(await bundle.text(),await readFile(BROWSER_BUNDLE,'utf8'));
  for(const path of ['/app-bundle.mjs','/app-bundle.mjs?v=old','/entry-startup.mjs','/feishu-client-login.mjs']){
    const response=await fetch(origin+path);assert.equal(response.status,200);
    assert.equal(response.headers.get('cache-control'),'no-store');
  }
});

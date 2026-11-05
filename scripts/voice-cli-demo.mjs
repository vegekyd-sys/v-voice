#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {voiceCliFixture} from '../tests/helpers/voice-cli-fixture.mjs';
const f=await voiceCliFixture();const evidence=[];
try{
  const command=async(...args)=>{const r=await f.cli(...args);assert.equal(r.code,0);evidence.push({command:args.map((arg,i)=>args[i-1]==='--out'?'[private-output]':arg),exitCode:r.code,result:r.value.result});return r.value.result;};
  await command('status');
  await command('entries','create','--id','demo-conversation','--kind','guest','--request-id','demo-entry-20261027');
  const issued=await command('links','create','--entry','demo-conversation','--ttl','600','--request-id','demo-link-20261027','--out',join(f.dir,'demo.url'));
  const id=issued.link.id,url=new URL((await readFile(issued.link.linkFile,'utf8')).trim());
  const phone=url.searchParams.get('phone'),access=new URLSearchParams(url.hash.slice(1)).get('access');
  await command('auth','check','--id',id);
  const authorized=await f.http('/voice/api/access?phone='+phone,'',{access});assert.equal(authorized.status,200);
  const cookie=authorized.headers['set-cookie'][0].split(';')[0];
  const status=await f.http('/voice/api/status?phone='+phone,cookie);assert.equal(status.status,200);assert.equal(status.json().unidentified,true);
  evidence.push({step:'recipient HTTP access',status:status.status,accessContext:status.json().accessContext});
  const personal=await f.http('/voice/api/status',cookie);assert.notEqual(personal.status,200);evidence.push({step:'personal entry denied',status:personal.status});
  await command('links','revoke','--id',id,'--request-id','demo-revoke-20261027');
  const checked=await command('auth','check','--id',id);assert.equal(checked.link.active,false);
  const revoked=await f.http('/voice/api/status?phone='+phone,cookie);assert.equal(revoked.status,404);
  evidence.push({step:'old cookie denied after revocation',status:revoked.status});
  assert.equal(f.calls.length,0);
  console.log(JSON.stringify({schema:'v-voice-cli-demo/v1',passed:true,calls:0,externalMessages:0,paidModels:0,evidence},null,2));
}finally{await f.close();}

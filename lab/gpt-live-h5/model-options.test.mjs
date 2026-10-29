import test from 'node:test';
import assert from 'node:assert/strict';
import {phoneModelOptions} from './model-options.mjs';
const ordinary=[{id:'gpt-live',available:true},{id:'seeduplex',available:true}];
test('omitted Grok preference falls back to the advertised default without rebuilding the directory',()=>{
 const status={models:ordinary,defaultModel:'seeduplex'};
 assert.deepEqual(phoneModelOptions(status,'grok'),{models:ordinary,model:'seeduplex'});
 assert.equal(phoneModelOptions({models:ordinary},'grok').model,'seeduplex');
});
test('explicit test catalog keeps Grok selectable and visitors never inherit GPT fallback',()=>{
 const models=[...ordinary,{id:'grok',available:true,voices:[{id:'iris'}]}];
 assert.equal(phoneModelOptions({models,defaultModel:'grok'},'seeduplex').model,'grok');
 assert.equal(phoneModelOptions({models,unidentified:true},'grok').models.some(m=>m.id==='gpt-live'),false);
 assert.deepEqual(phoneModelOptions({models:[]},'grok'),{models:[],model:null});
});

test('Fish comes only from the service catalog, preserves default, and stays disabled without credentials',()=>{
 const fish={id:'fish-stt',label:'Fish 候选',available:false};
 const result=phoneModelOptions({models:[...ordinary,fish],defaultModel:'seeduplex'},'fish-stt');
 assert.equal(result.model,'seeduplex');assert.equal(result.models.at(-1).available,false);
 assert(!phoneModelOptions({models:ordinary},'fish-stt').models.some(m=>m.id==='fish-stt'));
 assert.equal(phoneModelOptions({models:[{...fish,available:true}]},'fish-stt').model,'fish-stt');
});

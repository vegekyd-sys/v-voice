import test from 'node:test';
import assert from 'node:assert/strict';
import {compactSearchResult,searchMetrics} from './search-result.mjs';
const wrap=details=>({content:[{type:'text',text:JSON.stringify(details,null,2)}],details});
test('search payload dedup preserves every citation, rank, warning and timing value',()=>{
 const details={results:[{url:'https://example.com',title:'赛程',snippet:'九点',path:'memory/a.md',startLine:1,endLine:2,score:.7}],degraded:true,warning:'partial',debug:{searchMs:23}};
 for(const name of ['web_search','memory_search']){
  const original=wrap(details),compacted=compactSearchResult(name,original);
  assert.deepEqual(compacted,details);assert.deepEqual(original,wrap(details));
  const metrics=searchMetrics(original,compacted,100.3);
  assert.equal(metrics.compacted,true);assert(metrics.deliveredBytes<metrics.originalBytes/2);assert.equal(metrics.searchMs,23);
 }
});
test('nonduplicate text, errors, annotations, multimodal content and other tools stay intact',()=>{
 const original=wrap({results:[]});
 for(const result of [null,'plain',{error:'failed'}, {...original,isError:true},{...original,content:[{type:'text',text:'warning'}]}, {...original,content:[{type:'text',text:'not JSON'}]}, {...original,content:[{...original.content[0],annotations:{important:true}}]}, {...original,content:[...original.content,{type:'image',data:'x'}]}])assert.equal(compactSearchResult('web_search',result),result);
 assert.equal(compactSearchResult('exec',original),original);
});
test('search diagnostics discard arbitrary debug values and use numeric scalars only',()=>{
 const original=wrap({debug:{searchMs:17.2,hits:2,managerMs:-1,toolMs:Infinity,outsideSearchMs:'secret',query:'secret',raw:{text:'secret'}}});
 const metrics=searchMetrics(original,original,20);
 assert.deepEqual(Object.keys(metrics).sort(),['compacted','deliveredBytes','gatewayMs','hits','originalBytes','searchMs']);
 assert.equal(metrics.searchMs,17);assert.equal(metrics.compacted,false);
});

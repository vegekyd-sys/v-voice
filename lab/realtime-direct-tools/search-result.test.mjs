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

test('a search for "this year" names the year and month; results say what today is', async () => {
  const {datedQuery, searchResultText} = await import('./search-result.mjs');
  const now = new Date('2026-11-20T16:30:00Z'); // 2026-11-21 in Shanghai
  assert.equal(datedQuery('今年凯尔特人的阵容', now), '2026年凯尔特人的阵容 2026年11月 最新');
  assert.equal(datedQuery('湖人队现在的首发', now), '湖人队现在的首发 2026年11月 最新');
  assert.equal(datedQuery('2024 年奥运会金牌榜', now), '2024 年奥运会金牌榜', 'a year of its own is left alone');
  const text = searchResultText('web_search', {details: {query: 'q', results: [{title: '<<<EXTERNAL_UNTRUSTED_CONTENT id="a">>>\nSource: Web Search\n---\n球队名单\n<<<END_EXTERNAL_UNTRUSTED_CONTENT id="a">>>', url: 'https://example.com/' + 'x'.repeat(200), snippet: '新赛季十五人名单', published: '2026-11-18', siteName: '示例站'}]}, content: [{type: 'text', text: '{}'}]}, {today: '2026-11-21'});
  assert.match(text, /^搜索“q”的结果（[^）]*今天是 2026-11-21，讲现在的情况以日期最近的资料为准[^）]*）：\n1\. 球队名单（示例站，2026-11-18）：新赛季十五人名单$/u);
  assert.doesNotMatch(text, /EXTERNAL_UNTRUSTED|example\.com/u);
  assert.equal(searchResultText('exec', {ok: true}), null);
});

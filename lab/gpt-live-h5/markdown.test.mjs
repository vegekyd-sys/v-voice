import test from 'node:test';
import assert from 'node:assert/strict';
import {renderMarkdown} from './markdown.mjs';
class Node {
 constructor(tag='',text=''){this.tag=tag;this.value=text;this.children=[];this.attributes={};}
 append(...nodes){this.children.push(...nodes);}
 set textContent(text){this.value=String(text);this.children=[];}
 get textContent(){return this.value+this.children.map(x=>x.textContent).join('');}
 setAttribute(k,v){this.attributes[k]=v;}
 replaceChildren(fragment){this.children=fragment.children;this.value='';}
 find(tag){return this.children.flatMap(n=>[...(n.tag===tag?[n]:[]),...n.find(tag)]);}
}
const doc={createDocumentFragment:()=>new Node(),createElement:tag=>new Node(tag),createTextNode:text=>new Node('',text)};
function render(text){const target=new Node();renderMarkdown(target,text,doc);return target;}
test('research answers render headings, emphasis, ordered timeline tables, lists and code as distinct semantic elements',()=>{
 const r=render('## 阶段与时间线\n\n现在是 **中班**，参考 `官方招生页`。\n\n| 学年 | 关键动作 |\n| --- | --- |\n| 2027-28 | 访校 |\n| **2028.9** | 入学 |\n\n1. 先访校\n2. 再核对\n\n> 以当年政策为准\n\n```text\n<保留原文>\n```');
 assert.equal(r.find('h2')[0].textContent,'阶段与时间线');assert.equal(r.find('strong')[0].textContent,'中班');
 assert.equal(r.find('table').length,1);assert.equal(r.find('th').length,2);assert.equal(r.find('td').length,4);assert.equal(r.find('td')[2].textContent,'2028.9');assert.equal(r.find('li').length,2);assert.equal(r.find('blockquote')[0].textContent,'以当年政策为准');assert.equal(r.find('pre')[0].textContent,'<保留原文>');
});
test('model HTML and javascript links stay inert; external images cannot disclose private conversation through requests',()=>{
 const r=render('<script>alert(1)</script>\n\n[坏链接](javascript:alert%281%29) ![图](https://tracker.test/private) [原文](https://example.com/a)');
 assert.equal(r.find('script').length,0);assert.equal(r.find('img').length,0);assert.equal(r.find('a').length,1);assert.equal(r.find('a')[0].href,'https://example.com/a');assert.equal(r.find('a')[0].rel,'noopener noreferrer');assert.match(r.textContent,/<script>/);assert.match(r.textContent,/坏链接/);
});
test('streaming incomplete Markdown replaces prior output without duplicating the final answer',()=>{
 const r=render('## 结果\n\n**还在');renderMarkdown(r,'## 结果\n\n**完整答案**',doc);assert.equal(r.find('h2').length,1);assert.equal(r.find('strong')[0].textContent,'完整答案');assert.doesNotMatch(r.textContent,/还在/);
});

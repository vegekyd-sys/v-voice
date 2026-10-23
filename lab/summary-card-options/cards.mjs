// Candidate layouts built using the Card 2.0 component schema.
const md=(content,text_size='normal')=>({tag:'markdown',content,text_size,margin:'0px'});
const escape=text=>text.replace(/[&<>*\[\]_`]/gu,c=>`&#${c.charCodeAt(0)};`);
const group=(elements,{background='default',padding='0px'}={})=>({tag:'column_set',flex_mode:'none',columns:[{tag:'column',width:'weighted',weight:1,background_style:background,padding,vertical_spacing:'8px',elements}]});
const label=text=>md(`<font color='grey'>${escape(text)}</font>`,'notation');
export function summaryCardOptions(summary,url){
 if(new URL(url).protocol!=='https:')throw Error('HTTPS report required');
 const footer=()=>group([md(`[查看完整对话 ↗](${url})`,'notation')],{background:'grey-50',padding:'8px'});
 const topics=(boxed=false)=>summary.sections.map(s=>group([md(`**${escape(s.label)}**`),md(escape(s.text))],boxed?{background:'grey-50',padding:'12px'}:{}));
 const content=()=>summary.sections.length?topics():[group([md(escape(summary.lead))])];
 const title=()=>md(`**${escape(summary.title)}**`,'heading-3');
 const intro=()=>summary.lead&&summary.sections.length?[md(escape(summary.lead))]:[];
 const base=(name,width,elements,header)=>({name,card:{schema:'2.0',config:{width_mode:width,update_multi:true,summary:{content:summary.title}},...(header?{header}:{}),body:{padding:'16px',vertical_spacing:'12px',elements}}});
 return [
 base('A · 轻笔记','default',[group([label('A · 轻笔记'),title(),...intro()]),...content(),footer()]),
 base('B · 话题分区','default',[group([label('B · 话题分区'),title(),...intro()]),...(summary.sections.length?topics(true):content()),footer()]),
 base('C · 淡紫重点','default',[group([label('电话纪要'),title(),...intro()],{background:'purple-50',padding:'12px'}),...content(),footer()]),
 base('D · 紧凑便签','compact',[group([label('D · 紧凑便签'),md(`**${escape(summary.title)}**`),...intro()]),...summary.sections.map(s=>group([md(`<font color='grey'>${escape(s.label)}</font>\n${escape(s.text)}`)])),...(!summary.sections.length?[group([md(escape(summary.lead))])]:[]),footer()]),
 ];
}

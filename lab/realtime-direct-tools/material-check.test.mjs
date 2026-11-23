import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMaterialCheck,pointsAtMaterial} from './material-check.mjs';
import {handoffHint,VOICE_HANDOFF_RULE,VOICE_TASK_ROUTING} from './session.mjs';

test('only a request that points at something existing is looked at',async()=>{
 for(const said of ['用我上周发你的那张全家福做一张新年海报','用我家狗的照片做张海报','按我们公司的品牌规范做一张海报','把昨天做的那个视频加长','用你自己的形象做一张图','用飞书文档里那张产品图做个广告'])assert.equal(pointsAtMaterial(said),true,said);
 for(const said of ['帮我生成一张海报：穿宇航服的柴犬站在月球上','让它动起来','十秒吧','做一个五秒的视频：橘猫在雨夜跳上屋顶',''])assert.equal(pointsAtMaterial(said),false,said);
 let asked=0;
 const checker=createMaterialCheck({complete:async function*(request){asked++;assert.match(request.messages[1].content,/全家福/u);yield '{"missing":"上周发的全家福"}';}});
 assert.equal(await checker.check({ask:'用我上周发你的那张全家福做一张新年海报',have:['V 自己的形象']}),'上周发的全家福');
 // Nothing is pointed at: the model is not asked, and no time is spent.
 assert.equal(await checker.check({ask:'帮我生成一张柴犬海报',have:[]}),'');
 assert.equal(asked,1);
});

test('a check that is slow, fails or answers nonsense holds nothing back',async()=>{
 const slow=createMaterialCheck({timeoutMs:30,complete:async function*({signal}){await new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(Error('aborted')));});}});
 assert.equal(await slow.check({ask:'用我的头像做一张图',have:[]}),'');
 const broken=createMaterialCheck({complete:async function*(){throw Error('down');}});
 assert.equal(await broken.check({ask:'用我的头像做一张图',have:[]}),'');
 const odd=createMaterialCheck({complete:async function*(){yield '我觉得没有问题';}});
 assert.equal(await odd.check({ask:'用我的头像做一张图',have:[]}),'');
 const fine=createMaterialCheck({complete:async function*(){yield '```json\n{"missing":""}\n```';}});
 assert.equal(await fine.check({ask:'把你自己放进这张海报里',have:['V 自己的形象','柴犬海报（做好的图）']}),'');
 assert.equal(createMaterialCheck({}),null);
});

test('a lookup the voice model cannot make is handed to the backend, where there is one',()=>{
 const tools=[{name:'feishu_calendar'},{name:'delegate_to_v'}];
 assert.match(handoffHint('feishu_calendar','permission denied: calendar scope not granted',tools),/delegate_to_v/u);
 assert.match(handoffHint('lark_read','语音本地飞书只读工具未配置；不要改用 Gateway exec。',tools),/delegate_to_v/u);
 // Not a refusal of access: nothing is added. No backend on this call: nothing is added.
 assert.equal(handoffHint('feishu_calendar','无效日程日期',tools),'');
 assert.equal(handoffHint('web_search','permission denied',tools),'');
 assert.equal(handoffHint('feishu_calendar','permission denied',[{name:'feishu_calendar'}]),'');
 // The one rule is said once, at the head of the routing text.
 assert.equal(VOICE_TASK_ROUTING.startsWith(VOICE_HANDOFF_RULE),true);
 for(const part of ['东西都在手上吗','一口气能做完吗','只影响这通电话吗','不能“差不多”'])assert.ok(VOICE_HANDOFF_RULE.includes(part),part);
});

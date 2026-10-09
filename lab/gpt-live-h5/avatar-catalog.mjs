// Hand-reviewed visual labels for every approved picture. One ID per pose,
// shared by the Decision schema and browser. No model-generated file paths.
const rows = {
 listen:[
  ['倾耳招呼','微笑，手指耳机，另一手迎接','温暖、欢迎','问候、听见了、开始交流','严肃坏消息'],
  ['好奇追问','抬头看旁边，手指下巴','好奇、疑问','想了解、澄清、用户提出有趣问题','已经确定的结论'],
  ['热情解释','笑着指向旁边，另一手举起','活泼、投入','轻松建议、分享有趣发现','悲伤或抱怨'],
  ['托腮陪伴','侧头托腮，柔和微笑','温柔、共情、耐心','倾诉、安慰、耐心听、用户犹豫','热烈庆祝'],
  ['开心大笑','闭眼大笑，双手兴奋握拳','开心、逗趣','玩笑、开心故事、用户明确高兴','严肃解释或坏消息'],
  ['认真倾听','双手放胸前，温和看向用户','平静、真诚、专注','认真倾诉、理解、陪伴、简短回应','炫耀任务成功'],
 ],
 memory:[
  ['回想往事','托下巴抬眼回忆','思考、怀念','回忆、人物关系、旧经历','确定任务完成'],
  ['翻阅记录','低头认真翻开大书','专注、安静','阅读、历史、学习、从记录找证据','喜讯庆祝'],
  ['想起线索','看向上方，手指下巴，轻快微笑','灵光一现、好奇','想起一条线索、追忆、提出可能性','尚未查到却宣布成功'],
  ['展示线索','微笑举起一张发光卡片','发现、解释','分享一条具体线索、描述记录','悲伤倾诉'],
  ['慎重推敲','皱眉侧望，手指抵下巴','疑惑、审慎','不确定、信息矛盾、比较可能性、思考','直接报喜'],
  ['串起回忆','指向两张发光卡片，明亮微笑','理解、清晰、投入','关联线索、讲解关系、介绍两个选择','用户生气或难过'],
 ],
 web:[
  ['仔细观察','举放大镜，眨眼观察','探究、俏皮','查找细节、轻松好奇、发现细节','严肃悲伤'],
  ['探索世界','双手托着发光地球，微笑观看','好奇、期待','旅行、世界、新事物、探索方向','任务已完成的保证'],
  ['解释发现','微笑指着一张搜索卡片','清晰、投入','讲解资料、解释方法、展示发现','纯粹倾诉'],
  ['比较选择','双手拿两张卡片，认真比较','专注、权衡','比较方案、不同选项、作选择','单纯开心闲聊'],
  ['惊讶发现','睁大眼，手捂嘴，旁边有感叹号','惊讶、意外','出乎意料的信息、轻松惊喜','严重坏消息或安慰'],
  ['满意发现','闭眼笑，拿卡片竖拇指','满意、欣喜','明确好消息、找到用户想要的东西','未核实的结果'],
 ],
 calendar:[
  ['逐项安排','微笑掰着手指数数','有条理、投入','安排步骤、列清单、规划日程','沉重倾诉'],
  ['纠结日程','拿日历，皱眉用手指抵下巴','思考、困惑','时间冲突、犹豫、需要权衡','确定成功'],
  ['关注时间','低头微笑指着手腕时间','关心、提醒','提醒时间、准备出发、多久、时机','恐慌或催促用户'],
  ['整理计划','手拿便签，微笑说明','清楚、积极','规划、下一步、待办、方案建议','纯闲聊笑话'],
  ['忙得惊讶','举满满的日历，睁眼捂耳机','惊讶、忙碌','日程很满、轻松惊叹、事情太多','用户焦虑时加重恐慌'],
  ['选定日期','微笑指着日历上的一个圆圈','明确、安心','确认时间、敲定安排、找到合适时机','尚未执行却宣布已预约'],
 ],
 background:[
  ['耐心琢磨','托腮靠着桌面，轻微微笑','思考、耐心','慢慢想、等待、思考开放问题','宣告任务完成'],
  ['埋头整理','低头在本子上写字','专注、踏实','整理、记录、写方案、细致工作','纯粹庆祝'],
  ['找到拼法','开心举起两个拼图块','发现、兴奋','想到办法、问题开始有解、创意','已完成执行的证明'],
  ['抬头想想','望向上方，手指抵嘴边','好奇、认真思考','开放问题、想象、尚在斟酌','确定结果'],
  ['专注拼合','低头吐舌，双手拼两块拼图','专注、投入、俏皮','解决问题、梳理复杂关系、尝试办法','严肃痛苦倾诉'],
  ['从容核对','闭眼轻笑，拿着笔记本','平静、仔细','耐心解释、核对、理解之后整理','强烈惊讶'],
 ],
 complete:[
  ['给你点赞','眨眼微笑，举拇指','肯定、欣喜','鼓励用户、用户有进展、真实任务成功','任务失败或用户难过'],
  ['分享收获','开心摊开双手，伙伴闪亮','温暖、分享','分享结果、感谢、用户开心','并未完成的任务'],
  ['一起庆祝','闭眼大笑，双拳举高','兴奋、庆祝','用户明确喜讯、重大进展、开心时刻','普通进度或坏消息'],
  ['礼貌致谢','低头闭眼，双手合十','感激、谦逊','感谢、道歉、礼貌告别、理解用户','轻率报喜'],
  ['介绍成果','拿闪亮卡片，微笑指向它','自信、欣喜','真实成果、展示结果、给出解决办法','失败或尚未完成'],
  ['安心陪伴','闭眼微笑，手放胸前','安心、温暖、舒缓','安慰、谢谢、如释重负、平静结束','强烈惊喜'],
 ],
};
export const AVATAR_REACTION_CATEGORIES = Object.freeze({
 welcome:'欢迎与招呼',empathy:'倾听与共情',curiosity:'好奇与灵感',focus:'专注与慎思',
 explain:'分享与解释',plan:'整理与计划',surprise:'惊讶与意外',joy:'开心与庆祝',
});
const categories = {
 listen:['welcome','curiosity','explain','empathy','joy','empathy'],
 memory:['curiosity','focus','curiosity','explain','focus','explain'],
 web:['focus','curiosity','explain','focus','surprise','joy'],
 calendar:['plan','focus','plan','plan','surprise','joy'],
 background:['focus','focus','curiosity','curiosity','focus','focus'],
 complete:['joy','joy','joy','empathy','explain','empathy'],
};
// Dialogue relationship, affect, energy, gaze and gesture are visual labels,
// not inferred tool routes. Families contain hand-reviewed, compatible poses.
const reactions = {
 listen:[
  ['welcome','warm',1,'user','earpiece','attentive'],
  ['clarify','curious',1,'aside','chin','ponder'],
  ['explain','happy',2,'user','point','explain'],
  ['empathize','gentle',0,'user','cheek','attentive'],
  ['celebrate','joyful',3,'closed','fists','celebrate'],
  ['acknowledge','serious',0,'user','chest','attentive'],
 ],
 memory:[
  ['reflect','curious',1,'up','chin','ponder'],
  ['consider','focused',0,'down','read','work'],
  ['wonder','curious',1,'up','chin','ponder'],
  ['explain','warm',1,'user','card','explain'],
  ['consider','uncertain',1,'aside','chin','ponder'],
  ['explain','engaged',2,'user','cards','explain'],
 ],
 web:[
  ['investigate','curious',1,'detail','magnifier','explore'],
  ['wonder','curious',1,'object','globe','explore'],
  ['explain','engaged',1,'user','point','explain'],
  ['compare','focused',1,'object','cards','work'],
  ['surprise','surprised',2,'user','mouth','surprise'],
  ['encourage','happy',2,'closed','thumb','appreciate'],
 ],
 calendar:[
  ['organize','engaged',1,'user','count','plan'],
  ['consider','uncertain',1,'object','chin','ponder'],
  ['remind','warm',1,'down','wrist','plan'],
  ['explain','engaged',1,'user','notes','plan'],
  ['surprise','surprised',2,'user','earpiece','surprise'],
  ['confirm','relieved',1,'object','point','plan'],
 ],
 background:[
  ['consider','calm',0,'aside','cheek','ponder'],
  ['organize','focused',0,'down','write','work'],
  ['discover','happy',2,'user','puzzle','appreciate'],
  ['wonder','curious',1,'up','chin','ponder'],
  ['consider','focused',1,'down','puzzle','work'],
  ['explain','calm',0,'closed','notebook','work'],
 ],
 complete:[
  ['encourage','happy',2,'user','thumb','appreciate'],
  ['share','warm',2,'user','open-hands','appreciate'],
  ['celebrate','joyful',3,'closed','fists','celebrate'],
  ['apologize-thank','gentle',0,'down','palms','courtesy'],
  ['explain','happy',2,'user','card','explain'],
  ['reassure','gentle',0,'closed','chest','attentive'],
 ],
};
export const AVATAR_DIALOGUE_ACTIONS = Object.freeze({welcome:'欢迎',clarify:'好奇追问',empathize:'共情陪伴',acknowledge:'认真接话',reflect:'回想',consider:'斟酌',wonder:'好奇想象',explain:'解释分享',investigate:'探究细节',compare:'权衡',surprise:'轻松惊讶',encourage:'鼓励',organize:'整理',remind:'关心提醒',confirm:'确认',discover:'发现办法',celebrate:'庆祝',share:'共享收获','apologize-thank':'谦逊道歉或致谢',reassure:'安慰'});
export const AVATAR_CATALOG = Object.freeze([
 {id:'idle',category:'welcome',scene:'idle',frame:0,label:'等待接听',action:'面向用户微笑招呼',emotions:'温暖、平静',contexts:'未拨号、等待、问候',avoid:'沉重倾诉'},
 ...Object.entries(rows).flatMap(([scene,poses])=>poses.map(([label,action,emotions,contexts,avoid],frame)=>{
  const [dialogue,affect,energy,gaze,gesture,family]=reactions[scene][frame];
  return Object.freeze({id:`${scene}-${frame}`,scene,frame,category:categories[scene][frame],label,action,emotions,contexts,avoid,dialogue,affect,energy,gaze,gesture,family});
 })),
]);
const byId=new Map(AVATAR_CATALOG.map(p=>[p.id,p]));
export const avatarPicture = id => byId.get(id) ?? null;
// Deliberate neutral fallback where the gallery has only one exact gesture.
// Never rotate from quiet empathy into a triumphant or surprised picture.
export function avatarVariants(id) {
 const p=avatarPicture(id);if(!p||p.id==='idle')return [];
 const family=p.family==='courtesy'?'attentive':p.family;
 return AVATAR_CATALOG.filter(x=>x.id!==id&&x.family===family).map(x=>x.id);
}

// Reviewed *reaction* continuations, not broad tool families. Each plan's
// entire meaning is shown to Decision so it can judge it against this dialogue.
// Reading and quiet work may continue together; finding details does not imply
// travel, and a globe is confined to the exploration-world plan.
const continuations={
 listen:[['listen-5','complete-5'],['memory-0','background-3'],['web-2','memory-3'],['listen-5','complete-5'],['complete-1','complete-0'],['listen-3','complete-5']],
 memory:[['background-3','memory-4'],['background-1','background-5'],['listen-1','memory-0'],['web-2','listen-2'],['background-0','calendar-1'],['web-2','memory-3']],
 web:[['listen-1','memory-4'],['listen-1','background-3'],['listen-2','memory-3'],['memory-4','background-0'],['listen-1','memory-2'],['complete-0','complete-1']],
 calendar:[['calendar-3','background-1'],['memory-4','background-0'],['calendar-3','listen-5'],['calendar-0','background-1'],['calendar-1','listen-1'],['calendar-3','complete-5']],
 background:[['memory-4','background-3'],['memory-1','background-5'],['complete-0','memory-2'],['memory-0','listen-1'],['background-1','memory-4'],['memory-1','background-1']],
 complete:[['complete-1','complete-5'],['complete-0','complete-5'],['listen-4','complete-1'],['complete-5','listen-5'],['memory-3','web-2'],['listen-3','listen-5']],
};
export function avatarContinuationPlan(id){const p=avatarPicture(id);return p&&p.id!=='idle'?[...continuations[p.scene][p.frame]]:[];}

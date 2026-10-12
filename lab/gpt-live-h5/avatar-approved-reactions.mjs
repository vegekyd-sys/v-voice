// User-reviewed additions, 2026-10-11. Phase labels describe V's role in the
// conversation; a creative prop never implies that a real result exists.
const rows = [
 ['clarify-01','凑近认真听','前倾侧耳、闭嘴、抬眉，认真看向用户','专注、温和、尚未听清','用户重复、没听清、正在倾听','已经理解的结论、庆祝','empathy','clarify','gentle',0,'user','cupped-ear','attentive','user_listening',[1,'listen-5']],
 ['clarify-02','温和请再说一次','歪头轻笑，手心向上邀请对方继续','轻松、友好、好奇','V温和追问或请再说一次','投诉、悲伤、严肃道歉、训斥','curiosity','clarify','curious',1,'user','invite','attentive','assistant_speaking',[0,'listen-1']],
 ['wait-01','认真回应等待','放下忙碌的动作，认真看向用户','耐心、专注','用户追问进度时接住等待、认真倾听','报喜、已经完成','empathy','acknowledge','serious',0,'user','attend','attentive','user_listening',[3,'listen-5']],
 ['wait-02','仍在陪你一起等','温和解释，视线回到用户','耐心、舒缓','V如实说明尚未完成或暂无新进展','假装完成、庆祝、催用户等待','empathy','reassure','gentle',0,'user','reassure','attentive','assistant_speaking',[2,'listen-3']],
 ['bye-01','轻轻挥手说再见','轻挥手，白色伙伴跟着回应','温暖、感谢','V明确说再见、温暖告别','普通任务完成、要求用户停止、新来电问候','empathy','share','warm',1,'user','small-wave','farewell','assistant_speaking',[5,'complete-5']],
 ['bye-02','安心收尾','双手轻叠，温柔直视对方','感谢、安心','听用户告别、平静回应并让出话轮','祈祷、悲伤、任务庆祝','empathy','reassure','gentle',0,'user','relaxed-hands','farewell','turn_yield',[4,'listen-5']],
 ['image-listening-v1','听到画面开始有想法','闭嘴、抬眉、手指轻贴下巴，投入倾听','好奇、灵感、投入','听用户描述创作想法、想象画面','开口演说、展示成品、声称作图完成','curiosity','wonder','curious',1,'user','chin','creative-listen','user_listening',[8,'listen-1']],
 ['image-reply-v1','和你确认构图','看向用户开口解释，手指向抽象绘图板','创意、友好、解释','V解释构图、询问风格、确认创作偏好','倾听中演说、把抽象板当成真实成果、投诉或悲伤','explain','explain','engaged',1,'user','composition','creative-explain','assistant_speaking',[9,'listen-2']],
 ['video-listening-v1','想象运动的节奏','闭嘴侧身、视线稍偏侧，一手贴胸前','构思、投入、期待','听用户说运动、节奏、创作方向','要求正视时、拍摄正在进行、成片已完成','curiosity','wonder','curious',1,'aside','imagine','creative-listen','user_listening',[6,'background-3']],
 ['video-reply-v1','把动作节奏讲给你听','开口解释，手指向抽象分镜卡','自信、亲近、投入','V解释动作与节奏、确认视频创作计划','把示意卡当真实成片、未完成却庆祝','explain','explain','engaged',1,'user','storyboard','creative-explain','assistant_speaking',[7,'web-2']],
];
export const APPROVED_REACTION_ADDITIONS = Object.freeze(rows.map(([candidateId,label,action,emotions,contexts,avoid,category,dialogue,affect,energy,gaze,gesture,family,phase,next],frame)=>Object.freeze({
 id:`reaction-${frame}`,candidateId,scene:'reaction',frame,label,action,emotions,
 contexts:`话轮：${phase}；${contexts}`,avoid,category,dialogue,affect,energy,gaze,gesture,family,phase,
 continuations:Object.freeze(next.map(id=>typeof id==='number'?`reaction-${id}`:id)),
})));

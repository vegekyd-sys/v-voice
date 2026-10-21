// Transport adapter only. The page, React UI, CSS, Markdown, reader and Reaction
// behavior are imported from the owning H5 implementation without restyling.
import {createCallView} from '../../lab/gpt-live-h5/call-view.mjs';
import {mountCallUi} from '../../lab/gpt-live-h5/ui-bundle.mjs';
import {createContentView} from '../../lab/gpt-live-h5/content-view.mjs';
import {renderMarkdown} from '../../lab/gpt-live-h5/markdown.mjs';
import {mountChangelog} from '../../lab/gpt-live-h5/changelog.mjs';
import {mountAvatar} from '../../lab/gpt-live-h5/avatar.mjs';
import {createAvatarReactions} from '../../lab/gpt-live-h5/avatar-reactions.mjs';
import {createAvatarTelemetry} from '../../lab/gpt-live-h5/avatar-telemetry.mjs';

let current, owner, reactions, telemetry, opened = new Set(), pendingDocument, openingDocument=false;
const hiddenDocument=document.createElement('div');hiddenDocument.hidden=true;document.body.append(hiddenDocument);
const view = createCallView();
const post = (action, payload = {}, callID = current?.callID ?? '') => window.webkit.messageHandlers.voice.postMessage({action,payload,callID});
const send = async (action,payload) => {
  try { const result=await post(action,payload);if(result?.snapshot)receive(result.snapshot);return result; }
  catch(error){view.message(String(error.message??error),'problem');throw error;}
};
const readerWindow={get location(){return {href:current?.baseURL??'https://voice.invalid/voice/'};},matchMedia:q=>window.matchMedia(q),requestAnimationFrame:fn=>window.requestAnimationFrame(fn),getComputedStyle:el=>window.getComputedStyle(el)};
const content = createContentView(document,readerWindow,{onReading:reading=>{view.set({reading});if(!reading){reactions?.resume();if(pendingDocument)requestAnimationFrame(openPending);}}});
const cards=new Map();
mountCallUi(document,view,{
  renderAssistant(target,row){
    content.render(target,row,{auto:row.document===true});
    if(row.callId){const card=target.querySelector('.content-card');if(card)cards.set(row.callId,card);}
    if(pendingDocument)requestAnimationFrame(openPending);
  },
  onDocumentShown:callId=>{if(!opened.has(callId)){opened.add(callId);void send('shown',{id:callId}).catch(()=>opened.delete(callId));}},
  actions:{
    dial:()=>void send('dial').catch(()=>{}),hangup:()=>void send('end').catch(()=>{}),
    redial:()=>void send('redial').catch(()=>{}),resume:()=>void send('resume').catch(()=>{}),
    mute:()=>void send('mute').catch(()=>{}),
    composerOpen:()=>view.get().composer.open,compose:open=>view.set(s=>({composer:{...s.composer,open}})),
    async steer(text){try{const receipt=await send('steer',{text});view.set(s=>({composer:{...s.composer,open:false}}));view.message(receipt.message,'success');return true;}catch{return false;}},
    async cancelTasks(){try{await send('cancel');view.message('已请求取消后台任务。','success');}catch{}},
    chooseModel:id=>void send('model',{id}).catch(()=>{}),chooseGrokVoice:id=>void send('voice',{id}).catch(()=>{}),
  },
});
mountChangelog(document,window);
const avatar=mountAvatar(document,window,{owner:()=>owner,onDisplayed:event=>{if(current?.visible)telemetry?.display(event);}});
function stopVisuals(){reactions?.dispose();reactions=null;telemetry?.close();telemetry=null;}
function startVisuals(id){
  stopVisuals();const callID=id;
  telemetry=createAvatarTelemetry({snapshot:()=>view.get().transcript,send:body=>post('avatarEvents',body,callID)});
  reactions=createAvatarReactions({
    request:body=>post('avatar',body,callID),current:()=>avatar.context(),apply:value=>{avatar.select(value);telemetry?.decision(value);},attend:()=>avatar.attend(),
    isCurrent:()=>owner===callID&&current?.active,isVisible:()=>current?.visible&&!document.hidden&&!view.get().reading,
  });
}
function receive(snapshot){
  if(!snapshot||typeof snapshot.callID!=='string')return;
  const changed=owner!==snapshot.callID;
  current=snapshot;
  if(changed){if(owner!==undefined)pendingDocument=null;stopVisuals();content.reset();cards.clear();opened.clear();hiddenDocument.replaceChildren();owner=snapshot.callID;}
  const call=snapshot.active?(snapshot.phase==='connecting'?'dialing':snapshot.phase==='ending'?'ending':'connected'):'idle';
  document.body.dataset.callState=call;
  document.body.dataset.voiceState=snapshot.voice;
  document.body.dataset.microphoneMuted=String(snapshot.muted);
  document.body.dataset.avatarState=snapshot.tasks.length>1?'very-busy':snapshot.tasks.length?'busy':'idle';
  let entry=null;
  if(!snapshot.bound)entry={kind:'link',title:'绑定本人的电话入口',description:'请在右上角设置中完成绑定与麦克风授权。'};
  const people=snapshot.people;
  const notice=snapshot.notice?{...snapshot.notice,at:Date.now()}:null;
  view.set({call,voice:snapshot.voice,thinkingAt:snapshot.thinking?Date.now():null,callStartedAt:snapshot.startedAt,
    muted:snapshot.muted,models:snapshot.models,model:snapshot.model,modelDisabled:snapshot.active,
    grok:snapshot.grok,entry,dial:{disabled:!snapshot.bound,label:'和 V 通话'},stopLabel:call==='dialing'?'取消拨号':'结束通话',
    badge:snapshot.badge,homeNote:snapshot.active?null:snapshot.homeNote,homeNoteTone:snapshot.phase==='failed'?'error':'info',
    tasks:snapshot.tasks,cancelEnabled:snapshot.tasks.length>0,transcript:snapshot.transcript,
    speaker:{multi:people.length>0,people,lastSpeakerId:snapshot.lastSpeakerID,listenOnly:snapshot.listenOnly,status:notice},
    composer:{...view.get().composer,enabled:snapshot.canControl,open:snapshot.active&&view.get().composer.open},
  });
  if(snapshot.active&&call!=='dialing'&&!reactions)startVisuals(snapshot.callID);
  if(!snapshot.active){stopVisuals();content.reset();cards.clear();hiddenDocument.replaceChildren();}
  avatar.show(snapshot.tasks.at(-1)?.activity??'idle');
  reactions?.update({snapshot:snapshot.transcript,activity:snapshot.tasks.at(-1)?.activity??'idle',taskOutcome:snapshot.tasks.length?'pending':snapshot.outcome});
  document.body.dataset.nativeOwner=snapshot.callID;
  document.body.dataset.nativeReady='true';
}
async function openPending(){
  if(!pendingDocument||document.hidden||openingDocument||view.get().reading)return;
  const id=pendingDocument,ownOwner=owner,card=cards.get(id);
  if(card?.isConnected){pendingDocument=null;card.click();return;}
  openingDocument=true;
  try{
    const item=await post('document',{id});
    if(owner!==ownOwner||pendingDocument!==id||document.hidden)return;
    content.render(hiddenDocument,{key:'deep-link-'+id,callId:id,role:'assistant',speaker:'V · 完整方案',document:true,complete:true,text:item.text});
    const target=hiddenDocument.querySelector('.content-card');
    if(target){pendingDocument=null;target.click();requestAnimationFrame(()=>void send('shown',{id}).catch(()=>{}));}
  }catch{pendingDocument=null;view.message('这份内容已清除。','problem');}
  finally{openingDocument=false;}
}
window.VVoiceH5={receive,openDocument(id){pendingDocument=id;if(view.get().reading)document.getElementById('readerBack').click();else requestAnimationFrame(openPending);},showConversation(){pendingDocument=null;if(view.get().reading)document.getElementById('readerBack').click();},stopMedia(){for(const media of document.querySelectorAll('audio,video'))media.pause();}};
document.addEventListener('visibilitychange',()=>{if(document.hidden){window.VVoiceH5.stopMedia();void telemetry?.flush();}else{reactions?.resume();requestAnimationFrame(openPending);}});
window.addEventListener('pagehide',stopVisuals);
// H5's Markdown download uses a blob URL; pass the same bytes to the iOS share UI.
document.getElementById('readerDownload').addEventListener('click',event=>{
  const href=event.currentTarget.href;if(!href.startsWith('blob:'))return;
  event.preventDefault();void fetch(href).then(r=>r.text()).then(text=>send('share',{text,title:document.getElementById('readerTitle').textContent})).catch(()=>{});
});
void send('ready').catch(()=>{});

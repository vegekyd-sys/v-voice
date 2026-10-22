(async () => {
const $=id=>document.getElementById(id),query=new URLSearchParams(location.search);
const entryQuery=query.has('phone')?new URLSearchParams({phone:query.get('phone')}):new URLSearchParams({entry:query.get('entry')??'tianyi'});
const api=route=>`./api/comparison${route}?${entryQuery}`;
$('back').href=`./?${entryQuery}`;
let data,selected,blind=false,order=[],picked=null;
const activeAudio=new Set();
function stopAudio(){for(const audio of activeAudio){audio.pause();}activeAudio.clear();}
function render(){
 stopAudio();const scene=data.scenes.find(item=>item.id===selected);
 $('sceneContext').textContent=scene.context;$('sceneText').textContent=scene.text;
 for(const button of $('scenes').children)button.setAttribute('aria-pressed',String(button.dataset.id===selected));
 for(const engine of ['realtime','tts']){
  const parent=$(engine);parent.replaceChildren();
  order.forEach((variantId,index)=>{
   const variant=data.variants.find(item=>item.id===variantId),clip=data.clips.find(item=>item.scene===selected&&item.engine===engine&&item.variant===variantId);
   if(!clip)return;
   const card=document.createElement('article');card.className='card';card.classList.toggle('picked',picked===clip.id);
   const version=document.createElement('span');version.className='version';version.textContent=`版本 ${String.fromCharCode(65+index)}`;
   const title=document.createElement('h3');title.textContent=blind?`试听 ${String.fromCharCode(65+index)}`:variant.title;
   const description=document.createElement('p');description.className='description';description.textContent=blind?'先听声音，稍后揭晓版本。':variant.description;
   const audio=document.createElement('audio');audio.controls=true;audio.preload='none';audio.src=api('/audio/'+clip.id);audio.setAttribute('aria-label',`${engine==='realtime'?'实时模型':'独立合成'} · ${title.textContent}`);
   audio.addEventListener('play',()=>{for(const other of activeAudio)if(other!==audio)other.pause();activeAudio.clear();activeAudio.add(audio);});
   audio.addEventListener('error',()=>{$('status').hidden=false;$('status').textContent='音频暂时没有载入，请刷新页面后再试。';});
   const duration=document.createElement('span');duration.className='duration';duration.textContent=`${clip.seconds.toFixed(1)} 秒`;
   const choose=document.createElement('button');choose.type='button';choose.className='choose';choose.textContent=picked===clip.id?'已选：这版更自然':'这版更自然';choose.setAttribute('aria-pressed',String(picked===clip.id));
   choose.addEventListener('click',()=>{picked=clip.id;$('choice').textContent=`已选：${engine==='realtime'?'实时模型':'独立合成'} · ${title.textContent}`;for(const other of document.querySelectorAll('.card'))other.classList.remove('picked');card.classList.add('picked');for(const other of document.querySelectorAll('.choose')){other.textContent='这版更自然';other.setAttribute('aria-pressed','false');}choose.textContent='已选：这版更自然';choose.setAttribute('aria-pressed','true');});
   const details=document.createElement('details');details.hidden=blind;const summary=document.createElement('summary');summary.textContent='查看台词与实际标注';const script=document.createElement('pre');script.textContent=clip.requestedScript;details.append(summary,script);
   if(clip.renderedScript!==clip.requestedScript){const captionLabel=document.createElement('p');captionLabel.textContent='实时模型返回的字幕（可能省略表达标记）：';const caption=document.createElement('pre');caption.textContent=clip.renderedScript;details.append(captionLabel,caption);}
   if(!clip.inspection.valid){const warning=document.createElement('p');warning.className='warning';warning.textContent='返回字幕中有未配对的表达标记；输入标注与返回字幕均保留供核对。';details.append(warning);}
   card.append(version,title,description,audio,duration,choose,details);parent.append(card);
  });
 }
}
$('blind').addEventListener('click',()=>{blind=!blind;$('blind').setAttribute('aria-pressed',String(blind));$('blind').textContent=blind?'揭晓版本名称':'隐藏名称，先盲听';if(blind){order=[...data.variants.map(item=>item.id)];for(let i=order.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[order[i],order[j]]=[order[j],order[i]];}picked=null;$('choice').textContent='名称已隐藏，顺序已打乱。听完再揭晓。';}render();});
try{
 const response=await fetch(api(''),{credentials:'same-origin'});if(!response.ok)throw Error(response.status===401?'请先从已验证的本人电话入口打开本页。':'试听样本暂时不可用。');
 data=await response.json();selected=data.scenes[0].id;order=data.variants.map(item=>item.id);
 for(const scene of data.scenes){const button=document.createElement('button');button.type='button';button.dataset.id=scene.id;button.textContent=scene.title;button.setAttribute('aria-pressed',String(scene.id===selected));button.addEventListener('click',()=>{selected=scene.id;picked=null;$('choice').textContent='听完后，可以选一版你觉得更自然的。';render();});$('scenes').append(button);}
 render();$('status').hidden=true;$('listening').hidden=false;
}catch(error){$('status').textContent=error.message;}

})();

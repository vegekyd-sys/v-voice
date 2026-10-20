import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';

export function createEmbeddingWorker({python,model}){
  const child=spawn(python,[new URL('./embedding-worker.py',import.meta.url).pathname,model],{stdio:['pipe','pipe','pipe']});
  const pending=new Map();let serial=0,closed=false,resolveReady,rejectReady;
  const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});ready.catch(()=>{});
  const startup=setTimeout(()=>rejectReady(Error('本地声线模型未就绪')),15000);
  createInterface({input:child.stdout}).on('line',line=>{
    let row;try{row=JSON.parse(line);}catch{return;}
    if(row.ready){clearTimeout(startup);resolveReady();return;}
    const entry=pending.get(row.id);if(!entry)return;pending.delete(row.id);clearTimeout(entry.timer);
    if(row.error)entry.reject(Error(row.error));else entry.resolve(row);
  });
  const fail=()=>{closed=true;clearTimeout(startup);rejectReady(Error('本地声线模型已关闭'));for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('声线计算已取消'));}pending.clear();};
  child.on('error',fail);child.on('exit',fail);child.stderr.on('data',()=>{});
  return {ready,
    get closed(){return closed;},
    async compute(pcm){await ready;if(closed)throw Error('本地声线模型已关闭');if(pending.size>=8)throw Error('声线计算积压，请重拨');
      return new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('声线计算超时'));},2000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,audio:pcm.toString('base64')})+'\n');});},
    close(){fail();child.kill();},
  };
}

const normalized=a=>{const n=Math.sqrt(a.reduce((s,x)=>s+x*x,0));return a.map(x=>x/(n||1));};
const score=(embedding,p)=>Math.max(...(p.references??[p.embedding]).map(ref=>cosine(embedding,ref)));
const cosine=(a,b)=>a.reduce((n,x,i)=>n+x*b[i],0);
// All prototypes are anonymous, learned during this call, and discarded on close.
export class OnlineSpeakerTracker{
  // recycle: a household device hears a TV and passers-by for a long time. When
  // the roster is full, the longest-unheard voice that never addressed V (never
  // pinned) gives up its slot instead of locking out a new real speaker.
  constructor({embed,onEvent=()=>{},minMs=1000,silenceMs=400,maxPeople=5,recycle=false,recycleIdleMs=20000}={}){Object.assign(this,{embed,onEvent,minMs,silenceMs,maxPeople,recycle,recycleIdleMs});this.segments=[];this.prototypes=[];this.position=0;this.serial=0;this.voices=0;this.pre=[];this.pending=Buffer.alloc(0);this.voiced=0;this.quiet=0;this.closed=false;}
  pin(id){const p=this.prototypes.find(p=>p.id===id);if(p)p.pinned=true;}
  #vacancy(){
    if(this.prototypes.length<this.maxPeople)return true;
    if(!this.recycle)return false;
    const victim=this.prototypes.filter(p=>!p.pinned&&this.position-(p.lastSeenMs??0)>=this.recycleIdleMs).sort((a,b)=>(a.lastSeenMs??0)-(b.lastSeenMs??0))[0];
    if(!victim)return false;
    this.prototypes.splice(this.prototypes.indexOf(victim),1);this.onEvent({type:'evicted',speakerId:victim.id});return true;
  }
  push(pcm){
    if(this.closed)return;
    pcm=Buffer.concat([this.pending,pcm]);this.pending=pcm.subarray(pcm.length-pcm.length%640);pcm=pcm.subarray(0,pcm.length-pcm.length%640);
    for(let offset=0;offset+640<=pcm.length;offset+=640){
      const frame=Buffer.from(pcm.subarray(offset,offset+640));let sum=0;for(let i=0;i<frame.length;i+=2)sum+=(frame.readInt16LE(i)/32768)**2;
      const active=Math.sqrt(sum/320)>=.012,start=this.position;this.position+=20;
      this.pre.push(frame);if(this.pre.length>6)this.pre.shift();
      if(!this.current){this.voiced=active?this.voiced+20:0;if(this.voiced<60)continue;
        const segment={id:'seg'+(++this.serial),startMs:Math.max(0,start-100),endMs:null,frames:[...this.pre],lastVoiceMs:this.position,checked:0,pending:false,speakerId:null};
        this.current=segment;this.segments.push(segment);this.onEvent({type:'start',segment});
      }else this.current.frames.push(frame);
      const s=this.current;if(active){s.lastVoiceMs=this.position;this.quiet=0;}else this.quiet+=20;
      const duration=s.frames.length*20;
      if(!s.pending&&duration>=this.minMs&&duration>=s.checked+600&&duration<=4000)void this.classify(s);
      if(this.quiet>=this.silenceMs||duration>=18000){s.endMs=s.lastVoiceMs;this.current=null;this.voiced=0;this.quiet=0;this.onEvent({type:'end',segment:s});if(!s.pending&&duration>=400&&!s.speakerId)void this.classify(s,true);}
      while(this.segments.length>60){const old=this.segments.shift();old.frames=[];}
      for(const old of this.segments)if(old.endMs&&old.endMs<this.position-20000)old.frames=[];
    }
  }
  async classify(s,final=false){
    s.pending=true;const pcm=Buffer.concat(s.frames),duration=pcm.length/32;s.checked=duration;
    try{
      const {embedding,inferenceMs}=await this.embed(pcm.subarray(0,Math.min(pcm.length,128000)));
      if(this.closed)return;
      const ranks=this.prototypes.map(p=>({p,score:score(embedding,p)})).sort((a,b)=>b.score-a.score);
      const best=ranks[0],margin=best?best.score-(ranks[1]?.score??0):1;
      // Do not turn an unstable short prefix into another permanent person.
      // A new voice needs two agreeing windows, while admitted segment identity
      // remains fixed. Keep a small gallery only from high confidence matches.
      let selected=s.speakerId?this.prototypes.find(p=>p.id===s.speakerId):best?.score>=.50&&margin>=.08?best.p:null;
      if(!selected){
        const distinct=!best||best.score<.45;
        const confirmed=s.candidate&&cosine(embedding,s.candidate)>=.65&&duration>=1600;
        if(distinct&&(!best||confirmed)&&this.#vacancy()){
          const reference=s.candidate?normalized(embedding.map((x,i)=>x+s.candidate[i])):embedding;
          selected={id:'local'+(this.voices++),embedding:reference,references:[reference]};this.prototypes.push(selected);
        }
        s.candidate=embedding;
      }
      if(!selected)return;
      const previous=s.speakerId;
      if(previous&&best?.p!==selected&&best?.score>=.55){s.challengerCount=(s.challengerId===best.p.id?s.challengerCount:0)+1;s.challengerId=best.p.id;if(s.challengerCount>=2)s.ambiguous=true;}else{s.challengerCount=0;s.challengerId=null;}
      s.speakerId=selected.id;s.confidence=best?.p===selected?best.score:1;selected.lastSeenMs=this.position;
      if(!previous)this.onEvent({type:'identified',segment:s,inferenceMs,afterStartMs:this.position-s.startMs,confidence:s.confidence});
      if(previous&&best?.p===selected&&best.score>=.72&&margin>=.20&&!s.referenceAdded){
        selected.references??=[selected.embedding];if(selected.references.length<3)selected.references.push(embedding);s.referenceAdded=true;
      }
    }catch(error){if(!this.closed)this.onEvent({type:'error',message:error.message});}
    finally{s.pending=false;if(!this.closed&&!s.speakerId&&s.endMs&&duration>=1000&&!final&&duration<s.frames.length*20)void this.classify(s,true);}
  }
  overlaps(startMs,endMs){return this.segments.map(s=>({segment:s,ms:Math.max(0,Math.min(s.endMs??this.position,endMs)-Math.max(s.startMs,startMs))})).filter(x=>x.ms>0);}
  async verifyWindow(pcm){
    const {embedding}=await this.embed(pcm),ranks=this.prototypes.map(p=>({id:p.id,score:score(embedding,p)})).sort((a,b)=>b.score-a.score);
    const best=ranks[0];return best?.score>=.50&&best.score-(ranks[1]?.score??0)>=.08?best.id:null;
  }
  close(){this.closed=true;for(const s of this.segments)s.frames=[];this.segments=[];this.prototypes=[];this.pre=[];this.pending=Buffer.alloc(0);}
}

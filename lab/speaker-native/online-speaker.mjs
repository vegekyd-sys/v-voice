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
    async compute(pcm){await ready;if(closed)throw Error('本地声线模型已关闭');if(pending.size>=8)throw Error('声线计算积压，请重拨');
      return new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('声线计算超时'));},2000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,audio:pcm.toString('base64')})+'\n');});},
    close(){fail();child.kill();},
  };
}

const cosine=(a,b)=>a.reduce((n,x,i)=>n+x*b[i],0);
// All prototypes are anonymous, learned during this call, and discarded on close.
export class OnlineSpeakerTracker{
  constructor({embed,onEvent=()=>{},minMs=1000,silenceMs=400,maxPeople=5}={}){Object.assign(this,{embed,onEvent,minMs,silenceMs,maxPeople});this.segments=[];this.prototypes=[];this.position=0;this.serial=0;this.pre=[];this.pending=Buffer.alloc(0);this.voiced=0;this.quiet=0;this.closed=false;}
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
      const ranks=this.prototypes.map(p=>({p,score:cosine(embedding,p.embedding)})).sort((a,b)=>b.score-a.score);
      const best=ranks[0],margin=best?best.score-(ranks[1]?.score??0):1;
      let selected=best?.score>=.55&&margin>=.12?best.p:null;
      if(!selected&&(!best||best.score<.40||duration>=1600&&best.score<.55)&&this.prototypes.length<this.maxPeople){selected={id:'local'+this.prototypes.length,embedding};this.prototypes.push(selected);}
      if(!selected)return;
      const previous=s.speakerId;s.speakerId=selected.id;s.confidence=best?.p===selected?best.score:1;
      if(previous&&previous!==selected.id)this.onEvent({type:'revision',segment:s,previous});
      else if(!previous)this.onEvent({type:'identified',segment:s,inferenceMs,afterStartMs:this.position-s.startMs,confidence:s.confidence});
      // Keep the first clean prototype stable; never adapt it from mixed speech.
    }catch(error){if(!this.closed)this.onEvent({type:'error',message:error.message});}
    finally{s.pending=false;if(!this.closed&&!s.speakerId&&s.endMs&&duration>=1000&&!final&&duration<s.frames.length*20)void this.classify(s,true);}
  }
  overlaps(startMs,endMs){return this.segments.map(s=>({segment:s,ms:Math.max(0,Math.min(s.endMs??this.position,endMs)-Math.max(s.startMs,startMs))})).filter(x=>x.ms>0);}
  async verifyWindow(pcm){
    const {embedding}=await this.embed(pcm),ranks=this.prototypes.map(p=>({id:p.id,score:cosine(embedding,p.embedding)})).sort((a,b)=>b.score-a.score);
    const best=ranks[0];return best?.score>=.55&&best.score-(ranks[1]?.score??0)>=.12?best.id:null;
  }
  close(){this.closed=true;for(const s of this.segments)s.frames=[];this.segments=[];this.prototypes=[];this.pre=[];this.pending=Buffer.alloc(0);}
}

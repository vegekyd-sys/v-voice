import fs from 'node:fs';
import {createHash} from 'node:crypto';

// SeedDuplex does not make listening sounds of its own: the service never sends
// short acknowledgements while the caller talks. This lane plays cached PCM in
// V's voice in a caller's short pause. It only makes a sound. It cannot start a
// turn, reach the provider, enter the transcript or history, or touch a tool.
export const BACKCHANNEL_DEFAULTS=Object.freeze({pauseMinMs:260,pauseMaxMs:620,minSpeechMs:1500,cooldownMinMs:5000,cooldownMaxMs:9000,settleAfterVoiceMs:1500,textFreshMs:1800,turnGapMs:1800,skip:0.2,minRms:0.02});

// A clause that asks or tells V something wants an answer, not a listening sound.
// A miss is cheap: the caller hears "嗯" just before the model's own reply.
const QUESTION=/[?？]|(?:吗|呢|么|嘛|吧|怎么|咋|什么|为什么|为啥|谁|哪|多少|几[点个号天]|对不对|是不是|好不好|行不行|要不要|能不能|可不可以|有没有|你说|你觉得|你看|你呢)/u;
const REQUEST=/(?:帮我|给我|告诉我|查一下|看一下|搜一下|讲一个|讲个|说一下|说说|翻译|打开|发给|发到|提醒|记一下|V|v|小何)/u;
const STOP=/(?:等一下|等等|先停|停一下|别说|别讲|不要讲|打住|听我说|拜拜|再见|挂了)/u;
export function backchannelVerdict(text){
  const value=String(text??'').trim();
  if(value.length<2)return 'no-text';
  if(STOP.test(value))return 'stop';
  if(QUESTION.test(value))return 'question';
  if(REQUEST.test(value))return 'request';
  return 'listen';
}

export function createBackchannel({clips,isBlocked=()=>false,play,audit=()=>{},inputSampleRate=24000,options,now=Date.now,random=Math.random}){
  const o={...BACKCHANNEL_DEFAULTS,...options},frameBytes=inputSampleRate/50*2;
  let pending=Buffer.alloc(0),floor=0.002,voicedMs=0,quietMs=0,speechMs=0,inUtterance=false,decided=false,lastFireAt=-Infinity,cooldown=0,lastClip=-1,blockedAt=-Infinity,text='',textAt=-Infinity;
  const considerPause=at=>{
    decided=true;
    const skip=reason=>audit({type:'backchannel.skipped',reason,speechMs:Math.round(speechMs),pauseMs:Math.round(quietMs)});
    if(speechMs<o.minSpeechMs)return skip('short');
    if(at-lastFireAt<cooldown)return skip('cooldown');
    if(isBlocked()){blockedAt=at;return skip('voice-busy');}
    if(at-blockedAt<o.settleAfterVoiceMs)return skip('voice-just-spoke');
    if(at-textAt>o.textFreshMs)return skip('no-recent-text');
    const verdict=backchannelVerdict(text);
    if(verdict!=='listen')return skip(verdict);
    if(random()<o.skip)return skip('random');
    let index=Math.floor(random()*clips.length);
    if(clips.length>1&&index===lastClip)index=(index+1)%clips.length;
    lastClip=index;lastFireAt=at;speechMs=0;cooldown=o.cooldownMinMs+random()*(o.cooldownMaxMs-o.cooldownMinMs);
    play(clips[index]);
    audit({type:'backchannel.played',text:clips[index].text,pauseMs:Math.round(quietMs)});
  };
  const frame=pcm=>{
    let sum=0,crossings=0;
    for(let i=0;i<pcm.length;i+=2){const v=pcm.readInt16LE(i);sum+=(v/32768)**2;if(i&&((v<0)!==(pcm.readInt16LE(i-2)<0)))crossings++;}
    const samples=pcm.length/2,rms=Math.sqrt(sum/samples),zcr=crossings/samples,voiced=rms>=Math.max(o.minRms,floor*3)&&zcr>.004&&zcr<.32,at=now();
    if(isBlocked())blockedAt=at;
    if(voiced){
      voicedMs+=20;quietMs=0;decided=false;
      if(voicedMs>=120)inUtterance=true;
      if(inUtterance)speechMs+=20;
      return;
    }
    floor=Math.min(.012,floor*.98+Math.min(rms,.012)*.02);
    voicedMs=0;quietMs+=20;
    if(inUtterance&&!decided&&quietMs>=o.pauseMinMs&&quietMs<=o.pauseMaxMs)considerPause(at);
    if(quietMs>=o.turnGapMs){inUtterance=false;speechMs=0;text='';textAt=-Infinity;}
  };
  return {
    audio(audio){
      pending=pending.length?Buffer.concat([pending,audio]):audio;
      let offset=0;
      for(;offset+frameBytes<=pending.length;offset+=frameBytes)frame(pending.subarray(offset,offset+frameBytes));
      pending=pending.subarray(offset);
    },
    text(value){const next=String(value??'').trim();if(next){text=next;textAt=now();}},
  };
}

// Same provenance rule as the tool notices: separate native Xiaohe TTS connection.
let loaded;
export function loadBackchannelClips(root){
  if(!root&&loaded)return loaded;
  const base=root??new URL('./assets/',import.meta.url);
  const manifest=JSON.parse(fs.readFileSync(new URL('backchannel-provenance.json',base),'utf8'));
  if(manifest.provider!=='seeduplex'||manifest.voice!=='xiaohe'||manifest.sampleRate!==24000||manifest.format!=='pcm16le')throw Error('Invalid backchannel audio format');
  const clips=Object.entries(manifest.clips).map(([key,spec])=>{
    const pcm=fs.readFileSync(new URL(`backchannel-${key}.pcm`,base));
    if(!spec?.text||pcm.length!==spec.bytes||pcm.length%2||createHash('sha256').update(pcm).digest('hex')!==spec.sha256)throw Error('Backchannel audio hash mismatch');
    return {...spec,pcm,sampleRate:24000,source:'backchannel'};
  });
  if(!root)loaded=clips;
  return clips;
}

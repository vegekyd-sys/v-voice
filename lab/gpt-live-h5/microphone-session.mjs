import {captureDuplexMicrophone} from './microphone-capture.mjs';

// One page owns the browser grant. A hangup disables capture and releases all
// call transports; a new dial reuses that silent track, never another prompt.
// Navigation/reload or a device ending the track still obeys browser policy.
export function createPageMicrophoneSession({capture=captureDuplexMicrophone}={}) {
 let resource,pending,lease,closed=false;const lifetime=new AbortController();
 const valid=()=>resource?.track?.readyState==='live'&&resource.track.muted!==true;
 const mute=()=>{for(const track of resource?.stream?.getAudioTracks?.()??[])track.enabled=false;};
 async function acquire({mediaDevices,signal,isCurrent=()=>true,onDiagnostics=()=>{}}={}){
  if(closed||signal?.aborted||!isCurrent())throw Object.assign(Error('麦克风采集已结束。'),{name:'AbortError'});
  const owner={};lease=owner;
  const release=()=>{if(lease!==owner)return;lease=null;mute();};
  let abort;
  try{
   if(!valid()){
    resource?.dispose();resource=null;
    pending??=capture({mediaDevices,signal:lifetime.signal,isCurrent:()=>!closed,onDiagnostics:metadata=>{if(lease===owner&&!signal?.aborted&&isCurrent())onDiagnostics(metadata);}}).then(value=>{if(closed||!lease){value.dispose();throw Object.assign(Error('麦克风采集已结束。'),{name:'AbortError'});}resource=value;mute();return value;}).finally(()=>{pending=null;});
    const cancelled=signal&&new Promise((_,reject)=>{abort=()=>{release();reject(Object.assign(Error('麦克风采集已结束。'),{name:'AbortError'}));};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
    await(cancelled?Promise.race([pending,cancelled]):pending);
   }
   if(closed||lease!==owner||signal?.aborted||!isCurrent()){release();throw Object.assign(Error('麦克风采集已结束。'),{name:'AbortError'});}
   for(const track of resource.stream.getAudioTracks())track.enabled=true;
   const snapshot=()=>resource.snapshot();try{onDiagnostics(snapshot());}catch{}
   if(lease!==owner||signal?.aborted||!isCurrent()){release();throw Object.assign(Error('麦克风采集已结束。'),{name:'AbortError'});}
   const releaseOnAbort=()=>release();signal?.addEventListener('abort',releaseOnAbort,{once:true});
   return {stream:resource.stream,track:resource.track,snapshot,diagnostics:snapshot(),dispose(){signal?.removeEventListener('abort',releaseOnAbort);release();}};
  }catch(error){release();throw error;}finally{if(abort)signal.removeEventListener('abort',abort);}
 }
 return {acquire,close(){closed=true;lease=null;lifetime.abort();resource?.dispose();resource=null;},snapshot:()=>({live:valid(),enabled:valid()&&resource.track.enabled===true,active:Boolean(lease),closed})};
}

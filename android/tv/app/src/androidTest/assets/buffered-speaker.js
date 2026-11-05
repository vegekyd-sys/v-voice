function createBufferedPcmSpeaker(context,{prefillMs=120}={}){
  const output=context.createGain(),disconnect=output.disconnect.bind(output);
  let chunks=[],offset=0,frames=0,scheduled=[],consumed=0,epoch=0,nextAt=null,firstAt=null;
  let paused=false,held=false,complete=false,muted=false,closed=false,underflows=0,wasPlaying=false,lastPlayedAt=null;
  const rate=24000,blockFrames=2400,lead=.16;
  const port={onmessage:null,postMessage:command,close:dispose};output.port=port;
  const futureFrames=(block,now)=>Math.max(0,block.pcm.length-Math.max(0,Math.min(block.pcm.length,Math.floor((now-block.at)*rate+1e-5))));
  function trim(now){scheduled=scheduled.filter(b=>b.at+b.pcm.length/rate>now);}
  function reclaim(){
    const now=context.currentTime,rest=[];let count=0;
    for(const b of scheduled){const n=futureFrames(b,now);if(n){rest.push(b.pcm.subarray(b.pcm.length-n));count+=n;}try{b.node.stop();b.node.disconnect();}catch{}}
    if(offset&&chunks.length)chunks[0]=chunks[0].subarray(offset);
    chunks=rest.concat(chunks);offset=0;frames+=count;consumed-=count;scheduled=[];nextAt=null;firstAt=null;
  }
  function take(count){const out=new Int16Array(count);let n=0;while(n<count){const chunk=chunks[0],size=Math.min(count-n,chunk.length-offset);out.set(chunk.subarray(offset,offset+size),n);n+=size;offset+=size;frames-=size;if(offset===chunk.length){chunks.shift();offset=0;}}return out;}
  function notify(data){port.onmessage?.({data:{epoch,...data}});}
  function command(e){if(closed)return;
    if(e.type==='clear'){reclaim();chunks=[];offset=frames=consumed=underflows=0;epoch=e.epoch;nextAt=firstAt=lastPlayedAt=null;paused=held=complete=wasPlaying=false;return;}
    if(e.type==='output-mute'){muted=e.muted===true;output.gain.value=muted?0:1;return;}
    if(e.epoch!==epoch)return;
    if(e.type==='pause'){if(e.paused===true&&!paused)reclaim();paused=e.paused===true;return;}
    if(e.type==='hold'){if(!held)reclaim();held=true;return;}
    if(e.type==='done'){complete=true;held=false;return;}
    if(e.type==='audio'){
      const pcm=new Int16Array(e.buffer);
      const pending=scheduled.reduce((n,b)=>n+futureFrames(b,context.currentTime),0);
      if(!pcm.length||frames+pending+pcm.length>8*1024*1024){notify({type:'error'});return;}
      chunks.push(pcm);frames+=pcm.length;complete=false;if(firstAt===null&&nextAt===null)firstAt=context.currentTime;
    }
  }
  function tick(){if(closed)return;const now=context.currentTime;
    let pending=0,playing=false;
    for(const b of scheduled){const left=futureFrames(b,now);pending+=left;if(now>=b.at&&left>0)playing=true;if(now>=b.at)lastPlayedAt=Math.min(now,b.at+b.pcm.length/rate);}
    trim(now);
    if(wasPlaying&&!playing&&!paused&&!held&&!complete&&frames===0)underflows++;
    if(!paused&&!held&&context.state==='running'&&frames){
      if(nextAt===null||nextAt<now){nextAt=Math.max(now+.02,(firstAt??now)+(complete?0:prefillMs/1000));}
      while(frames&&nextAt<now+lead){
        const pcm=take(Math.min(blockFrames,frames)),buffer=context.createBuffer(1,pcm.length,rate),out=buffer.getChannelData(0);
        for(let i=0;i<pcm.length;i++)out[i]=pcm[i]/32768;
        const node=context.createBufferSource();node.buffer=buffer;node.connect(output);node.start(nextAt);
        node.onended=()=>{try{node.disconnect();}catch{}};
        scheduled.push({node,pcm,at:nextAt});nextAt+=pcm.length/rate;consumed+=pcm.length;pending+=pcm.length;
      }
    }
    if(!frames&&!scheduled.length){nextAt=null;firstAt=null;}
    wasPlaying=playing;
    notify({type:'playback',consumed:Math.max(0,consumed-pending),underflows,lastPlayedAt,playing:playing&&!paused&&!held&&!muted});
  }
  const timer=setInterval(tick,20);
  function dispose(){if(closed)return;reclaim();closed=true;clearInterval(timer);chunks=[];frames=0;}
  output.disconnect=(...args)=>{if(!args.length)dispose();return disconnect(...args);};
  return output;
}
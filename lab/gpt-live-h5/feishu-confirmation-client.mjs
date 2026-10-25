// One browser-owned request at a time. No navigation and no caller identity
// supplied by the page; only the server's verified entry snapshot is applied.
export function createFeishuConfirmation({request,onState,onEntry,now=Date.now,schedule=setTimeout,unschedule=clearTimeout}) {
  let revision=0,setup=null,timer=null,pending=null,active=false;
  const run=fn=>{pending=Promise.resolve().then(fn);return pending;};
  const cancel=async()=>{
    ++revision;active=false;unschedule(timer);
    await pending?.catch(()=>{});
    if(setup)await request('cancel',{state:setup.state}).catch(()=>{});
    setup=null;onState(null);
  };
  const start=async()=>{
    if(active)return;
    active=true;const owner=++revision;setup=null;
    onState({phase:'preparing'});
    const current=()=>owner===revision;
    const failed=error=>{if(current()){active=false;onState({...setup,phase:'failed',error:error.message});}};
    const poll=async()=>{
      if(!current())return;
      if(now()>=setup.expiresAt){failed(Error('确认已过期，请重新发送卡片。'));return;}
      try{
        const result=await run(()=>request('status',{state:setup.state}));
        if(!current())return;
        if(result.status==='complete'){
          if(!result.entry)throw Error('身份已确认，请重新打开电话同步状态。');
          active=false;setup=null;onEntry(result.entry);onState(null);return;
        }
        if(result.status==='failed')throw Error('卡片未发送成功，请重试。');
        timer=schedule(poll,1500);
      }catch(error){failed(error);}
    };
    try{
      const prepared=await run(()=>request('prepare',{}));
      setup=prepared;
      if(!current())return;
      onEntry(prepared.entry);onState({...setup,phase:'sending'});
      await run(()=>request('start',{state:setup.state}));
      if(!current())return;
      onState({...setup,phase:'waiting'});
      timer=schedule(poll,1000);
    }catch(error){failed(error);}
  };
  return {start,cancel};
}

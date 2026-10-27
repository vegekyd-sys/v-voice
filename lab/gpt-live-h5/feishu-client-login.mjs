// Identity is resolved inside the phone page. No second document or login screen.
// Only the server exchanges the code and decides the caller/conversation.
export function connectFeishuClient({config,window,document,fetch=globalThis.fetch,setTimer=setTimeout,clearTimer=clearTimeout}) {
  let finished=false,exchanging=false,timer,resolve;
  const ready=new Promise(done=>{resolve=done;});
  const controller=new AbortController();
  const profile={startedAt:window.performance?.timeOrigin??Date.now(),stages:[]};
  const record=(name,extra={})=>{
    profile.stages.push({name,ms:Date.now()-profile.startedAt,...extra});
    try{window.sessionStorage?.setItem('voice-entry-profile',JSON.stringify(profile));}catch{}
    if(document.documentElement)document.documentElement.dataset.voiceLoginTiming=JSON.stringify(profile);
  };
  const finish=status=>{
    if(finished)return;
    finished=true;clearTimer(timer);
    profile.outcome=status&&!status.unidentified?'identified':'guest';record('login.complete');
    resolve(status??null);
  };
  const exchange=async payload=>{
    try {
      const response=await fetch(config.endpoint,{method:'POST',credentials:'same-origin',signal:controller.signal,
        headers:{'content-type':'application/json'},body:JSON.stringify({state:config.state,...payload})});
      const body=await response.json();
      if(payload.code)record('identity.confirmed',{serverTiming:response.headers?.get?.('server-timing')??null});
      finish(response.ok&&body.status&&typeof body.status.ready==='boolean'?{...body.status,...(config.privateEntry?{canonicalPhone:body.phone}:{})}:config.privateEntry?{error:'暂时无法确认当前飞书私聊，请在飞书中重新打开。'}:null);
    } catch {finish(null);}
  };
  const fallback=error=>{
    if(finished||exchanging)return;
    exchanging=true;clearTimer(timer);
    record('client.failed',{code:Number.isInteger(error?.errno)?error.errno:null});
    timer=setTimer(()=>{controller.abort();finish(null);},4000);
    void exchange({failure:{code:Number.isInteger(error?.errno)?error.errno:null}});
  };
  const success=result=>{
    if(finished||exchanging)return;
    if(typeof result?.code!=='string'||!result.code)return fallback();
    exchanging=true;clearTimer(timer);record('client.code');
    timer=setTimer(()=>{controller.abort();finish(null);},12000);
    void exchange({code:result.code});
  };
  const legacy=()=>window.tt?.requestAuthCode?window.tt.requestAuthCode({appId:config.appId,success,fail:fallback}):fallback();
  const start=()=>{
    if(finished||exchanging)return;
    record('sdk.ready');
    if(window.tt?.requestAccess)window.tt.requestAccess({appID:config.appId,scopeList:[],success,fail:error=>{if(error?.errno===103)return legacy();fallback(error);}});
    else legacy();
  };
  record('login.start');
  timer=setTimer(()=>fallback({errno:null}),8000);
  const script=document.createElement('script');
  script.src='https://lf1-cdn-tos.bytegoofy.com/goofy/lark/op/h5-js-sdk-1.5.26.js';
  script.onerror=fallback;
  script.onload=()=>{if(finished||exchanging)return;record('sdk.loaded');if(!window.h5sdk)return fallback();window.h5sdk.error(fallback);window.h5sdk.ready(start);};
  document.head.append(script);
  return {ready,fallback};
}

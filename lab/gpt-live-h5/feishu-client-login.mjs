// Entry-only handshake. A fresh client code avoids reusing another account's
// cookie after a Feishu account switch. No identity fields come from this page.
export function connectFeishuClient({config,window,document,fetch=globalThis.fetch,setTimer=setTimeout,clearTimer=clearTimeout}) {
  let finished=false,exchanging=false;
  const guest=document.getElementById('guest');
  const fallback=()=>{if(finished||exchanging)return;finished=true;clearTimer(timer);window.location.replace(config.guest);};
  guest.href=config.guest;guest.addEventListener('click',event=>{event.preventDefault();fallback();});
  const timer=setTimer(fallback,8000);
  const success=async result=>{
    if(finished||exchanging)return;
    if(typeof result?.code!=='string'||!result.code)return fallback();
    exchanging=true;clearTimer(timer);guest.hidden=true;
    document.getElementById('status').textContent='正在确认账号…';
    let location=config.guest;
    try {
      const response=await fetch(config.endpoint,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({state:config.state,code:result.code})});
      const body=await response.json();
      if(response.ok&&typeof body.location==='string'&&body.location.startsWith('/'))location=body.location;
    } catch {}
    finished=true;window.location.replace(location);
  };
  const legacy=()=>window.tt?.requestAuthCode?window.tt.requestAuthCode({appId:config.appId,success,fail:fallback}):fallback();
  const start=()=>{
    if(finished)return;
    if(window.tt?.requestAccess)window.tt.requestAccess({appID:config.appId,scopeList:[],state:config.state,success,fail:error=>{if(error?.errno===103)return legacy();window.console?.warn?.('Feishu basic identity unavailable',Number.isInteger(error?.errno)?error.errno:'unknown');fallback();}});
    else legacy();
  };
  const script=document.createElement('script');
  script.src='https://lf1-cdn-tos.bytegoofy.com/goofy/lark/op/h5-js-sdk-1.5.26.js';
  script.onerror=fallback;
  script.onload=()=>{if(finished)return;if(!window.h5sdk)return fallback();window.h5sdk.error(fallback);window.h5sdk.ready(start);};
  document.head.append(script);
  return {fallback};
}
if(typeof document!=='undefined') {
  const element=document.getElementById('login-config');
  if(element)connectFeishuClient({config:JSON.parse(element.textContent),window,document});
}

import {randomUUID} from 'node:crypto';
import WebSocket from 'ws';

// Voice's only transport dependency is the versioned Gateway wire protocol.
// Requests are never replayed after reconnect (they may have side effects).
export class GatewayClient {
  constructor({url,token,getToken,onEvent=()=>{},onHelloOk=()=>{},onConnectError=()=>{},scopes=['operator.read','operator.write','operator.admin'],caps=['voice-direct-tools','tool-events'],subscribeSessions=false,WebSocketImpl=WebSocket,connectTimeoutMs=15000,reconnectMs=1000}) {
    const endpoint=new URL(url);
    if(endpoint.protocol!=='wss:'&&!(endpoint.protocol==='ws:'&&['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname)))throw Error('Gateway requires loopback or TLS');
    if(endpoint.username||endpoint.password||endpoint.search)throw Error('Gateway credentials must be server-side');
    Object.assign(this,{url,token,getToken,onEvent,onHelloOk,onConnectError,scopes,caps,subscribeSessions,WebSocketImpl,connectTimeoutMs,reconnectMs});
    this.pending=new Map();this.stopped=true;this.ready=false;this.generation=0;
  }
  start(){if(!this.stopped)return;this.stopped=false;this.open();}
  open(){
    if(this.stopped)return;
    const generation=++this.generation;
    const socket=this.socket=new this.WebSocketImpl(this.url,{maxPayload:26214400,handshakeTimeout:this.connectTimeoutMs});
    this.ready=false;let connecting=false,heartbeat,lastTick=Date.now();
    const fail=(code,error)=>this.onConnectError(Object.assign(Error(`Gateway ${code}`),{code,
      retryable:error?.retryable===true,retryAfterMs:error?.retryAfterMs,details:error?.details}));
    const deadline=setTimeout(()=>{fail('CONNECT_TIMEOUT');socket.terminate();},this.connectTimeoutMs);
    deadline.unref?.();
    socket.on('error',error=>this.onConnectError(Object.assign(Error('Gateway TRANSPORT_ERROR'),{code:'TRANSPORT_ERROR',transportCode:error.code})));
    socket.on('message',raw=>{
      if(generation!==this.generation||this.stopped)return;
      let frame;try{frame=JSON.parse(raw.toString());}catch{return;}
      if(frame.type==='res'){
        const row=this.pending.get(frame.id);if(!row)return;
        if(frame.ok&&row.expectFinal&&frame.payload?.status==='accepted')return;
        this.pending.delete(frame.id);row.cleanup();
        if(frame.ok)row.resolve(frame.payload);
        else row.reject(Object.assign(Error(`Gateway request ${row.method} failed (${frame.error?.code??'ERROR'})`),{code:frame.error?.code,details:frame.error?.details,retryable:frame.error?.retryable===true,retryAfterMs:frame.error?.retryAfterMs}));
        return;
      }
      if(frame.type!=='event')return;
      if(frame.event==='connect.challenge'){
        if(connecting||!frame.payload?.nonce)return;connecting=true;
        void Promise.resolve().then(()=>this.getToken?this.getToken():this.token).then(token=>{
          if(generation!==this.generation||this.stopped)throw Object.assign(Error('Gateway handshake retired'),{code:'CONNECTION_CLOSED'});
          return this.request('connect',{minProtocol:4,maxProtocol:4,client:{id:'cli',version:'2026.9.1',platform:process.platform,mode:'cli'},role:'operator',scopes:this.scopes,caps:this.caps,auth:{token}}, {timeoutMs:this.connectTimeoutMs,handshake:true});
        }).then(hello=>{
          if(generation!==this.generation||this.stopped)return;
          if(hello.protocol!==4){fail('PROTOCOL_MISMATCH');socket.terminate();return;}
          clearTimeout(deadline);this.ready=true;this.gatewayMethods=new Set(hello.features?.methods??[]);lastTick=Date.now();
          const tickMs=hello.policy?.tickIntervalMs;
          if(Number.isFinite(tickMs)&&tickMs>0){heartbeat=setInterval(()=>{if(Date.now()-lastTick>tickMs*3)socket.terminate();},tickMs);heartbeat.unref?.();}
          this.onHelloOk(hello);
          // A run started through a plugin method sends its tool events only to
          // session subscribers. The subscription belongs to this socket, so renew it.
          if(this.subscribeSessions)void this.request('sessions.subscribe',{}).catch(error=>this.onConnectError(Object.assign(Error('Gateway sessions.subscribe failed'),{code:'SUBSCRIBE_FAILED',cause:error})));
        }).catch(error=>{if(generation!==this.generation||this.stopped)return;fail(error.code??'CONNECT_REJECTED',error);socket.terminate();});
        return;
      }
      if(!this.ready)return;
      if(frame.event==='tick')lastTick=Date.now();
      this.onEvent(frame);
    });
    socket.on('close',()=>{
      clearTimeout(deadline);clearInterval(heartbeat);
      if(generation!==this.generation)return;
      this.ready=false;this.rejectPending('CONNECTION_CLOSED');
      if(this.stopped)return;
      this.onEvent({type:'event',event:'voice.gateway.disconnected',payload:{generation}});
      this.retry=setTimeout(()=>this.open(),this.reconnectMs);this.retry.unref?.();
    });
  }
  request(method,params={},options={}){
    if(!this.socket||this.socket.readyState!==1||!this.ready&&!options.handshake)return Promise.reject(Object.assign(Error('Gateway unavailable'),{code:'UNAVAILABLE',retryable:true}));
    if(options.signal?.aborted)return Promise.reject(options.signal.reason??Error('Request aborted'));
    const id=randomUUID();
    return new Promise((resolve,reject)=>{
      const retire=code=>{const row=this.pending.get(id);if(!row)return;this.pending.delete(id);row.cleanup();reject(Object.assign(Error(`Gateway request ${method} ${code}`),{code}));};
      const abort=()=>retire('ABORTED');
      const timer=setTimeout(()=>retire('TIMEOUT'),options.timeoutMs??30000);timer.unref?.();
      const cleanup=()=>{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);};
      this.pending.set(id,{resolve,reject,cleanup,method,expectFinal:options.expectFinal===true});
      options.signal?.addEventListener('abort',abort,{once:true});
      try{this.socket.send(JSON.stringify({type:'req',id,method,params}));}catch{retire('SEND_FAILED');}
    });
  }
  supportsMethod(method){return this.ready&&this.gatewayMethods?.has(method)===true;}
  rejectPending(code){for(const row of this.pending.values()){row.cleanup();row.reject(Object.assign(Error(`Gateway ${code}`),{code}));}this.pending.clear();}
  stop(){this.stopped=true;this.ready=false;clearTimeout(this.retry);this.rejectPending('STOPPED');this.socket?.close();}
}

// A Gateway that is restarting refuses or drops the socket for a few seconds.
// That is not a configuration error: keep waiting within the startup window.
const STARTUP_TRANSIENT=new Set(['TRANSPORT_ERROR','CONNECT_TIMEOUT','CONNECTION_CLOSED']);

/** Startup auth/protocol errors fail admission; transport errors wait for the
 * Gateway until startupTimeoutMs; later errors of any kind keep reconnecting. */
export function connectGatewayClient(options,{startupTimeoutMs=60000,onConnectError=()=>{}}={}) {
 let client,admitted=false;
 return new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>{client?.stop();reject(Error('Gateway startup timed out'));},startupTimeoutMs);
  client=new GatewayClient({...options,onHelloOk:()=>{admitted=true;clearTimeout(timeout);resolve(client);},onConnectError:error=>{
   onConnectError(error);
   if(admitted||error.code==='UNAVAILABLE'&&error.retryable===true||STARTUP_TRANSIENT.has(error.code))return;
   clearTimeout(timeout);client.stop();reject(error);
  }});
  client.start();
 });
}

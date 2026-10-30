package live.tianyi.vvoice.tv;

import android.Manifest;
import android.app.Service;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.os.IBinder;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.IntentFilter;
import android.graphics.PixelFormat;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Handler;
import android.view.*;
import android.webkit.*;
import org.json.*;
import java.nio.file.Files;
import java.io.File;

/** Window, input and lifecycle adapter. Every visible call control lives in shared H5. */
public final class CallService extends Service {
    private static CallService current;
    private static boolean entryVisible;
    static void entryStarted(){entryVisible=true;if(current!=null&&current.attached){current.windows.removeView(current.surface);current.attached=false;}}
    static void entryFinished(){entryVisible=false;if(current!=null)current.handler.postDelayed(()->{if(current!=null&&!entryVisible)current.resize(current.mode);},250);}
    private WindowManager windows;
    private WindowManager.LayoutParams window;
    private boolean attached,interactive=true,hadCall,closing,startupCueFinished;
    private String lastCall="idle";
    private long idleSince;
    private String lastDiagnostics="";
    private long lastDiagnosticsAt;
    private final String launcherPackage="live.tianyi.familytv.dev";
    private final Handler handler=new Handler();
    private WebView web;
    private android.widget.FrameLayout surface;
    private TvArrayCapture arrayCapture;
    private boolean visible,personal,surfaceAnnounced,visualPending,hostPresented,audioPageProvisioned,nativeMicReady,nativeFocusPending,pageFocusReady;
    private String personalUrl,projectionOwner,mode="medium";
    private long generation=-1,revision=-1,pageVersion;
    private String pendingLaunch;
    private static final String START_CALL="live.tianyi.vvoice.tv.action.START_CALL";
    private final String local="http://127.0.0.1:26326/?tv=1&tvShell=1&tvSurface=1&tvOverlay=1";
    private int dp(int n){return Math.round(n*getResources().getDisplayMetrics().density);}

    @Override public void onCreate(){
        super.onCreate();
        current=this;visible=true;
        getSharedPreferences("diagnostics",0).edit().clear().putBoolean("foreground",true).putString("projected_call","idle").putString("failure_code","").apply();
        startNotification();
        getSharedPreferences("diagnostics",0).edit().putString("web_instance",java.util.UUID.randomUUID().toString()).apply();
        windows=(WindowManager)getSystemService(WINDOW_SERVICE);
        // Keep companion keys on the transparent host. This TV Chromium paints
        // a viewport focus ring even when native default focus highlight is off.
        surface=new android.widget.FrameLayout(this){
            @Override public boolean dispatchKeyEvent(KeyEvent event){return handleKey(event)||super.dispatchKeyEvent(event);}
        };
        surface.setBackgroundColor(Color.TRANSPARENT);surface.setDefaultFocusHighlightEnabled(false);
        surface.setFocusableInTouchMode(true);
        web=new WebView(this){
            @Override protected void onSizeChanged(int w,int h,int oldw,int oldh){super.onSizeChanged(w,h,oldw,oldh);post(()->acknowledgeLayout());}
        };
        surface.addView(web,new android.widget.FrameLayout.LayoutParams(-1,-1));
        web.addJavascriptInterface(new Object(){
            @JavascriptInterface public void finish(){handler.post(()->finishStartupCue());}
        },"VTVStartupCue");
        arrayCapture=new TvArrayCapture(this,web);
        web.addJavascriptInterface(arrayCapture,"VTVArray");
        // This TV's WebView hardware layer becomes transparent after protected
        // Settings windows. Rasterize the small companion view in software; the
        // shared page and its worker/audio session remain unchanged.
        web.setLayerType(View.LAYER_TYPE_SOFTWARE,null);
        web.setAlpha(0);web.setBackgroundColor(Color.TRANSPARENT);web.setFocusable(false);web.setDefaultFocusHighlightEnabled(false);
        web.setOutlineProvider(new ViewOutlineProvider(){@Override public void getOutline(View v,android.graphics.Outline outline){outline.setRoundRect(0,0,v.getWidth(),v.getHeight(),dp(28));}});
        web.setClipToOutline(true);
        arrayCapture.foreground(true);
        web.setSystemUiVisibility(5894);
        WebSettings s=web.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);
        s.setSupportZoom(false);s.setTextZoom(100);s.setUseWideViewPort(true);
        // The trusted native home entry supplies the explicit gesture across navigation.
        s.setMediaPlaybackRequiresUserGesture(false);s.setAllowFileAccess(false);s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean onRenderProcessGone(WebView view,RenderProcessGoneDetail detail){stopSelf();return true;}
            @Override public void onPageStarted(WebView w,String u,android.graphics.Bitmap icon){arrayCapture.invalidate();surfaceAnnounced=false;visualPending=false;hostPresented=false;nativeFocusPending=false;pageFocusReady=false;pageVersion++;audioPageProvisioned=false;nativeMicReady=false;web.setAlpha(0);web.setFocusable(false);surface.requestFocus();web.setBackgroundColor(Color.TRANSPARENT);}
            @Override public boolean shouldOverrideUrlLoading(WebView w,WebResourceRequest r){return !EntryPolicy.trusted(r.getUrl().toString());}
            @Override public void onPageCommitVisible(WebView w,String u){
                // WebView can reset its backing canvas during a cold navigation.
                // Keep this software-rendered overlay transparent at that boundary.
                w.setBackgroundColor(Color.TRANSPARENT);
                prepareAudioPage(u);
            }
            @Override public void onPageFinished(WebView w,String u){
                if(!EntryPolicy.trusted(u))return;
                prepareAudioPage(u);

                web.evaluateJavascript("Boolean(window.vVoiceTV)",value->{
                    if("true".equals(value))acknowledgeLayout();
                    // A late shared host is expected during cold start. Keep Home
                    // visible and wait for its projection; never reveal a legacy
                    // full-page layout in the companion window.
                });
            }
            @Override public void onReceivedError(WebView w,WebResourceRequest r,WebResourceError e){
                if(r.isForMainFrame()){
                    resize("medium");
                    getSharedPreferences("diagnostics",0).edit().putString("failure_code","TV_PAGE_UNAVAILABLE").apply();
                    android.widget.Toast.makeText(CallService.this,"V 暂时连接不上，请稍后重试",android.widget.Toast.LENGTH_LONG).show();
                    stopSelf();
                }
            }
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onConsoleMessage(ConsoleMessage m){if(m.message().startsWith("VTVAudio stats ")&&m.message().length()<1024){android.util.Log.i("VTVAudio",m.message());return true;}return super.onConsoleMessage(m);}
            @Override public void onPermissionRequest(PermissionRequest p){handler.post(()->{
                if(!EntryPolicy.trusted(p.getOrigin().toString()+(p.getOrigin().toString().endsWith("/")?"voice/":"/voice/"))
                    ||!java.util.Arrays.asList(p.getResources()).contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)){p.deny();return;}
                if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED)p.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                else p.deny();
            });}
        });
        try{
            JSONObject c=new JSONObject(new String(Files.readAllBytes(new File(getFilesDir(),"entry.json").toPath()),java.nio.charset.StandardCharsets.UTF_8));
            String p=c.optString("personalUrl");
            if(EntryPolicy.trusted(p)&&p.startsWith("https://"))personalUrl=android.net.Uri.parse(p).buildUpon().appendQueryParameter("tv","1").appendQueryParameter("tvShell","1").appendQueryParameter("tvSurface","1").appendQueryParameter("tvOverlay","1").build().toString();
        }catch(Exception ignored){}
        resize("medium");
        web.loadUrl(local);
        IntentFilter filter=new IntentFilter(Intent.ACTION_SCREEN_OFF);filter.addAction(Intent.ACTION_CLOSE_SYSTEM_DIALOGS);
        registerReceiver(systemEvents,filter,Context.RECEIVER_NOT_EXPORTED);
        IntentFilter query=new IntentFilter("live.tianyi.vvoice.tv.QUERY_SURFACE");
        registerReceiver(surfaceQuery,query,"live.tianyi.familytv.permission.VOICE_SURFACE",null,Context.RECEIVER_EXPORTED);
        handler.post(poll);
        handler.postDelayed(()->{if(!surfaceAnnounced){getSharedPreferences("diagnostics",0).edit().putString("failure_code","TV_SURFACE_TIMEOUT").apply();android.widget.Toast.makeText(this,"V 暂时连接不上，请稍后重试",android.widget.Toast.LENGTH_LONG).show();stopSelf();}},30000);
    }
    private void prepareAudioPage(String url){
        if(audioPageProvisioned||!EntryPolicy.trusted(url))return;
        audioPageProvisioned=true;long page=pageVersion;
        String token=arrayCapture.newPage();
        web.evaluateJavascript(personal?"window.vTvAudioCapability=Object.freeze({version:1,pageToken:"+JSONObject.quote(token)+"})":"delete window.vTvAudioCapability",value->{
            if(visible&&page==pageVersion)nativeMicReady=true;
        });
    }
    // Keep the old Home portrait visible until this page has a committed visual frame.
    private void presentPage(){
        visualPending=true;long page=pageVersion;
        String expected="{owner:"+JSONObject.quote(projectionOwner)+",generation:"+generation+"}";
        web.evaluateJavascript("typeof window.vVoiceTV?.present==='function'?window.vVoiceTV.present("+expected+"):true",value->{
            if(!visible||page!=pageVersion)return;
            if("true".equals(value)){hostPresented=true;revealPaintedPage(page);}else visualPending=false;
        });
    }
    private void revealPaintedPage(long page){
        web.postVisualStateCallback(page,new WebView.VisualStateCallback(){@Override public void onComplete(long requestId){
            if(!visible||page!=pageVersion)return;
            web.setBackgroundColor(Color.TRANSPARENT);web.setAlpha(1);visualPending=false;
            // Keep Home underneath until the now-visible WebView has crossed a
            // compositor frame. Hiding it in the alpha callback leaves a gap.
            web.postOnAnimation(()->web.postOnAnimation(()->{
                if(!visible||page!=pageVersion)return;
                surfaceAnnounced=true;announce(true);
                prepareNativeFocus();
                web.evaluateJavascript("window.vVoiceTV?.reveal?.()",null);
            }));
        }});
    }
    private void prepareNativeFocus(){
        if(!surfaceAnnounced||!interactive||pageFocusReady||nativeFocusPending)return;
        nativeFocusPending=true;long page=pageVersion;
        // Entry authentication can finish after the avatar paints. Do not focus
        // the WebView while all shared controls are still disabled (body focus).
        web.evaluateJavascript("(()=>{window.vVoiceTV?.focusPrimary?.();return Boolean(window.vVoiceTV?.snapshot?.focus)})()",value->{
            if(!visible||page!=pageVersion)return;
            nativeFocusPending=false;
            if(interactive&&"true".equals(value)){pageFocusReady=true;if("full".equals(mode)){web.setFocusableInTouchMode(true);web.requestFocus();}}
        });
    }
    private void acknowledgeLayout(){
        if(web==null)return;
        web.scrollTo(0,0);web.invalidateOutline();
        float cssWidth=web.getWidth()/getResources().getDisplayMetrics().density;
        web.evaluateJavascript("window.vVoiceTV?.commitLayout("+JSONObject.quote(mode)+",undefined,{width:"+cssWidth+"})",null);
    }
    private void resize(String value){
        if(!java.util.Arrays.asList("compact","medium","full").contains(value))return;
        mode=value;
        getSharedPreferences("diagnostics",0).edit().putString("window_mode",value).apply();
        int screenW=getResources().getDisplayMetrics().widthPixels,screenH=getResources().getDisplayMetrics().heightPixels;
        if(window==null)window=new WindowManager.LayoutParams();
        window.type=WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY;
        window.format=PixelFormat.TRANSLUCENT;
        window.gravity=Gravity.TOP|Gravity.RIGHT;
        window.width=value.equals("full")?screenW-dp(48):dp(264);
        window.height=value.equals("full")?screenH-dp(40):dp(300);
        window.x=value.equals("full")?dp(24):dp(30);window.y=value.equals("full")?dp(16):dp(100);
        interactive=!value.equals("compact");
        window.flags=WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED|WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
            |WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN|WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            |(interactive?0:WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE|WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE);
        if(!entryVisible){if(attached)windows.updateViewLayout(surface,window);else{windows.addView(surface,window);attached=true;}}
        if(interactive){
            boolean textPage="full".equals(mode)&&pageFocusReady;
            web.setFocusableInTouchMode(textPage);web.setFocusable(textPage);
            if(textPage)web.requestFocus();else surface.requestFocus();
        }
        getSharedPreferences("diagnostics",0).edit().putBoolean("interactive",interactive).apply();
        web.post(this::acknowledgeLayout);
    }
    private void collapse(){
        if(web!=null)web.evaluateJavascript("window.vVoiceTV?.setLayout('compact')",null);
        resize("compact");
    }
    private void finishStartupCue(){if(startupCueFinished)return;startupCueFinished=true;sendBroadcast(new Intent("live.tianyi.vvoice.tv.STARTUP_CUE_END").setPackage(launcherPackage));}
    private void announce(boolean active){
        sendBroadcast(new Intent("live.tianyi.vvoice.tv.SURFACE_READY").setPackage(launcherPackage).putExtra("active",active));
    }
    private final BroadcastReceiver surfaceQuery=new BroadcastReceiver(){@Override public void onReceive(Context c,Intent i){if(surfaceAnnounced){if(i.getBooleanExtra("expand",false)){web.evaluateJavascript("window.vVoiceTV?.setLayout('medium')",null);resize("medium");}announce(true);web.evaluateJavascript("window.vVoiceTV?.passiveFocus?.("+i.getBooleanExtra("focused",false)+")",null);}}};
    private final BroadcastReceiver systemEvents=new BroadcastReceiver(){@Override public void onReceive(Context c,Intent i){
        if(Intent.ACTION_SCREEN_OFF.equals(i.getAction())){action("end");stopSelf();}
        else if("homekey".equals(i.getStringExtra("reason")))collapse();
    }};
    private void startNotification(){
        NotificationManager manager=getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel("v-call","V 通话",NotificationManager.IMPORTANCE_LOW));
        Intent open=new Intent(this,CallService.class).setAction("live.tianyi.vvoice.tv.action.SHOW_CALL");
        PendingIntent content=PendingIntent.getForegroundService(this,1,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        PendingIntent end=PendingIntent.getService(this,2,new Intent(this,CallService.class).setAction("END"),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        startForeground(11,new Notification.Builder(this,"v-call").setSmallIcon(android.R.drawable.sym_call_incoming).setContentTitle("V 语音")
            .setContentText("可继续使用电视；返回首页点头像可展开控制").setContentIntent(content).setOngoing(true).addAction(new Notification.Action.Builder(null,"挂断",end).build()).build());
    }
    @Override public IBinder onBind(Intent intent){return null;}
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        if(intent==null){stopSelf();return START_NOT_STICKY;}
        if("END".equals(intent.getAction())){action("end");handler.postDelayed(this::stopSelf,300);return START_NOT_STICKY;}
        closing=false;idleSince=0;
        if(START_CALL.equals(intent.getAction())&&"idle".equals(lastCall)){hadCall=false;pendingLaunch="launch-"+java.util.UUID.randomUUID();}
        if(surfaceAnnounced){web.evaluateJavascript("window.vVoiceTV?.setLayout('medium')",null);resize("medium");}
        return START_NOT_STICKY;
    }

    private void action(String name){
        if(projectionOwner==null)return;
        String expected="{owner:"+JSONObject.quote(projectionOwner)+",generation:"+generation+"}";
        web.evaluateJavascript("window.vVoiceTV?.action("+JSONObject.quote(name)+","+expected+")",null);
    }
    private final Runnable poll=new Runnable(){public void run(){
        if(!visible)return;
        web.evaluateJavascript("JSON.stringify(window.vVoiceTV?{...window.vVoiceTV.snapshot,surfaceReady:Boolean(document.querySelector('.call-page .avatar #avatar')?.naturalWidth&&!document.documentElement.dataset.tvTransition)}:null)",value->{
            if(!visible)return;
            try{
                Object raw=new JSONTokener(value).nextValue();if(!(raw instanceof String))return;
                JSONObject p=new JSONObject((String)raw);String owner=p.getString("owner");
                if(owner.length()>100||p.optInt("version")!=1)return;
                if(!owner.equals(projectionOwner)){projectionOwner=owner;generation=revision=-1;}
                long g=p.getLong("generation"),r=p.getLong("revision");if(g<generation||(g==generation&&r<revision))return;
                generation=g;revision=r;
                // Reveal only the shared host's committed avatar frame.
                if(!hostPresented&&!visualPending&&p.optBoolean("surfaceReady"))presentPage();
                String call=p.optString("call");
                if(!"idle".equals(call))finishStartupCue();
                if(!"idle".equals(call)){hadCall=true;idleSince=0;closing=false;}
                if(hadCall&&"idle".equals(call)&&!closing){
                    closing=true;pendingLaunch=null;
                    if(!p.optString("failureCode","").isEmpty()&&!"null".equals(p.optString("failureCode")))handler.postDelayed(()->{if(closing)stopSelf();},12000);
                    else{collapse();handler.postDelayed(()->{if(closing){announce(false);handler.postDelayed(()->{if(closing)stopSelf();},120);}},500);}
                }
                if(!hadCall&&pendingLaunch==null&&"idle".equals(call)){
                    if(idleSince==0)idleSince=android.os.SystemClock.elapsedRealtime();
                    if(android.os.SystemClock.elapsedRealtime()-idleSince>60000)stopSelf();
                }
                lastCall=call;
                JSONObject meter=p.optJSONObject("meter"),viewport=p.optJSONObject("viewport"),microphone=p.optJSONObject("microphone");
                JSONObject stable=new JSONObject(p.toString());stable.remove("revision");stable.remove("meter");stable.remove("label");
                String diagnosticKey=stable.toString();long now=android.os.SystemClock.elapsedRealtime();
                if(!diagnosticKey.equals(lastDiagnostics)||now-lastDiagnosticsAt>=2000){lastDiagnostics=diagnosticKey;lastDiagnosticsAt=now;getSharedPreferences("diagnostics",0).edit().putLong("generation",g).putLong("revision",r)
                    .putString("projected_call",p.optString("call")).putBoolean("muted",p.optBoolean("muted")).putBoolean("output_muted",p.optBoolean("outputMuted")).putString("model",p.optString("model",""))
                    .putString("mic_driver",microphone==null?"none":microphone.optString("driver","none")).putInt("mic_channels",microphone==null?0:microphone.optInt("channels",0))
                    .putString("failure_code",p.optString("failureCode",""))
                    .putString("focus",p.optString("focus","")).putBoolean("reading",p.optBoolean("reading"))
                    .putBoolean("has_document",p.optBoolean("hasDocument"))
                    .putString("meter_source",meter==null?"none":meter.optString("source","none"))
                    .putInt("meter_peak",meter==null?0:meter.optInt("peak",0))
                    .putInt("viewport_width",viewport==null?0:viewport.optInt("width",0)).putInt("viewport_height",viewport==null?0:viewport.optInt("height",0)).apply();}
                String next=p.optString("layout","full");if(!next.equals(mode))resize(next);
                prepareNativeFocus();
                JSONObject actions=p.optJSONObject("actions");
                if(pendingLaunch!=null&&!"idle".equals(p.optString("call")))pendingLaunch=null;
                if(pendingLaunch!=null&&(!personal||nativeMicReady)&&actions!=null&&actions.optBoolean("dial")&&checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED){
                    String request=pendingLaunch;pendingLaunch=null;
                    web.evaluateJavascript("window.vVoiceTV?.requestDial("+JSONObject.quote(request)+",{owner:"+JSONObject.quote(projectionOwner)+",generation:"+generation+"})",null);
                }
            }catch(Exception ignored){}
        });handler.postDelayed(this,interactive?250:1000);
    }};
    @Override public void onDestroy(){
        if(current==this)current=null;visible=false;handler.removeCallbacksAndMessages(null);
        try{unregisterReceiver(systemEvents);unregisterReceiver(surfaceQuery);}catch(Exception ignored){}
        if(arrayCapture!=null)arrayCapture.foreground(false);
        finishStartupCue();announce(false);
        if(web!=null){web.stopLoading();web.loadUrl("about:blank");if(attached)windows.removeView(surface);web.destroy();}
        getSharedPreferences("diagnostics",0).edit().putBoolean("foreground",false).putBoolean("interactive",false).putString("projected_call","idle")
          .putString("mic_driver","none").putInt("mic_channels",0).putString("meter_source","none").putInt("meter_peak",0).apply();
        stopForeground(STOP_FOREGROUND_REMOVE);super.onDestroy();
    }
    private boolean handleKey(KeyEvent e){
        int key=e.getKeyCode();
        if(key==KeyEvent.KEYCODE_BACK){if(e.getAction()==KeyEvent.ACTION_UP){if("full".equals(mode))web.evaluateJavascript("window.vVoiceTV?.back()",null);else if("idle".equals(lastCall)&&!hadCall)stopSelf();else collapse();}return true;}
        if(key==KeyEvent.KEYCODE_MENU){if(e.getAction()==KeyEvent.ACTION_UP)collapse();return true;}
        if(key>=KeyEvent.KEYCODE_DPAD_UP&&key<=KeyEvent.KEYCODE_DPAD_RIGHT){
            if(e.getAction()==KeyEvent.ACTION_DOWN){String dir=key==19?"up":key==20?"down":key==21?"left":"right";
                web.evaluateJavascript("window.vVoiceTV?.navigate("+JSONObject.quote(dir)+")",value->{if("\"exit\"".equals(value))collapse();});}return true;
        }
        if((key==KeyEvent.KEYCODE_DPAD_CENTER||key==KeyEvent.KEYCODE_ENTER||key==KeyEvent.KEYCODE_NUMPAD_ENTER)&&!web.hasFocus()){
            if(e.getAction()==KeyEvent.ACTION_UP&&surfaceAnnounced&&projectionOwner!=null){
                String expected="{owner:"+JSONObject.quote(projectionOwner)+",generation:"+generation+"}";
                web.evaluateJavascript("(()=>{const p=window.vVoiceTV?.snapshot,e="+expected+",a=document.activeElement;if(p?.owner===e.owner&&p.generation===e.generation&&a?.matches('button,a[href],input,select,textarea,[tabindex]')&&!a.disabled&&!a.closest('[inert]'))a.click()})()",null);
            }
            return true;
        }
        return false;
    }
}

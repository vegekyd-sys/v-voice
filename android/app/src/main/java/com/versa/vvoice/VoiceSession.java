package com.versa.vvoice;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Handler;
import android.os.Looper;
import android.webkit.*;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.util.Set;

/** One process-owned H5 engine survives Activity recreation while a call is active. */
final class VoiceSession {
    private static VoiceSession instance;
    static VoiceSession get(Context context) { if(instance==null)instance=new VoiceSession(context.getApplicationContext());return instance; }
    final Context context;
    final TrustedEndpoint endpoint = new TrustedEndpoint(BuildConfig.SERVICE_URL,BuildConfig.DEBUG);
    final EntryRepository entries;
    final WebView web;
    final Handler handler = new Handler(Looper.getMainLooper());
    MainActivity activity;
    String state="idle", label="Public", pageUrl;
    boolean muted, serviceStarted, loaded, rendererGone;
    private JavaScriptReplyProxy reply;
    private long pageRevision;
    private boolean pageFailed;
    long callGeneration;
    VoiceSession(Context context) {
        this.context=context;entries=new EntryRepository(context,endpoint);
        web=new WebView(context);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);settings.setSupportMultipleWindows(false);
        settings.setUserAgentString(settings.getUserAgentString()+" VVoiceAndroid/1");
        CookieManager.getInstance().setAcceptCookie(true);CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url=request.getUrl().toString();
                if(request.isForMainFrame() && request.hasGesture() && endpoint.page(url) && request.getUrl().getPath().equals("/voice/feishu")) {
                    if(activity!=null)activity.connectAccount(request.getUrl());return true;
                }
                if(endpoint.page(url))return false;
                if(request.isForMainFrame() && request.hasGesture() && activity!=null)activity.openExternal(request.getUrl());
                return true;
            }
            @Override public void onPageStarted(WebView view,String url,Bitmap icon) { pageRevision++;pageFailed=false;reply=null;if(activity!=null)activity.presentation(false);setState("idle",false); }
            @Override public void onPageFinished(WebView view,String url) { if(activity!=null && !pageFailed && endpoint.page(url))activity.loaded(); }
            @Override public void onReceivedSslError(WebView view,SslErrorHandler handler,SslError error) { handler.cancel();pageFailed=true;showError("连接证书无效，请稍后重试。"); }
            @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error) {
                if(request.isForMainFrame()){pageFailed=true;shutdownCall();showError("页面未能加载，请检查网络后重试。");}
            }
            @Override public boolean onRenderProcessGone(WebView view,RenderProcessGoneDetail detail) {
                setState("idle",false); loaded=false;rendererGone=true;
                if(web.getParent() instanceof android.view.ViewGroup parent)parent.removeView(web);
                web.destroy();instance=null;showError("网页进程已停止，重新打开应用即可恢复。");
                if(activity!=null)activity.recreate();return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) {
                if(!endpoint.sameOrigin(request.getOrigin().toString()) || !endpoint.page(web.getUrl()) || activity==null || !activity.isVisible) { request.deny();return; }
                boolean audio=false;for(String resource:request.getResources())if(resource.equals(PermissionRequest.RESOURCE_AUDIO_CAPTURE))audio=true;
                if(!audio){request.deny();return;}
                activity.microphone(request,pageRevision);
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) { if(activity!=null)activity.cancelPermission(request); }
            @Override public void onGeolocationPermissionsShowPrompt(String origin,GeolocationPermissions.Callback callback) {
                if(!endpoint.sameOrigin(origin) || !endpoint.page(web.getUrl()) || activity==null || !activity.isVisible) { callback.invoke(origin,false,false);return; }
                activity.location(origin,callback);
            }
        });
        if(!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) || !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT))
            throw new IllegalStateException("请先更新 Android System WebView 或 Chrome。");
        WebViewCompat.addWebMessageListener(web,"VVoiceHost",Set.of(endpoint.origin()),(view,message,origin,mainFrame,proxy)->{
            if(!mainFrame || !endpoint.sameOrigin(origin.toString()) || !endpoint.page(view.getUrl()))return;
            try {String data=message.getData();if(data==null || data.length()>600000)return;JSONObject value=new JSONObject(data);
                if("saveDocument".equals(value.optString("type")) && activity!=null && activity.isVisible) {
                    String text=value.optString("text"),title=value.optString("title","V 的方案");
                    if(text.length()<=500000 && title.length()<=100)activity.saveDocument(title,text);return;
                }
                if("presentation".equals(value.optString("type")) && activity!=null){activity.presentation(value.optBoolean("obscured"));return;}
                if(!"state".equals(value.optString("type")))return;
                String next=value.optString("state");if(!Set.of("idle","dialing","connected","ending").contains(next))return;
                reply=proxy;setState(next,value.optBoolean("muted"));
            }catch(Exception ignored){}
        });
        try(var input=context.getAssets().open("host-bridge.js")) {
            WebViewCompat.addDocumentStartJavaScript(web,new String(BoundedInput.read(input,65536),StandardCharsets.UTF_8),Set.of(endpoint.origin()));
        }catch(Exception e){throw new IllegalStateException("无法加载通话组件",e);}
    }
    boolean active(){return !state.equals("idle");}
    boolean permissionStillValid(long revision){return revision==pageRevision && activity!=null && activity.isVisible && endpoint.page(web.getUrl());}
    void authorized(EntryRepository.Authorized entry) {
        if(active())return;
        label=entry.label;pageUrl=entry.url;
        if(entry.notice!=null && activity!=null)android.widget.Toast.makeText(activity,entry.notice,android.widget.Toast.LENGTH_LONG).show();
        CookieManager.getInstance().setCookie(endpoint.base.toString(),entry.cookie,ok->{
            if(!ok){showError("无法保存通话授权，请重试。");return;}
            CookieManager.getInstance().flush();loaded=true;web.loadUrl(pageUrl);
        });
    }
    boolean ensureForeground() {
        if(serviceStarted)return true;
        if(context.checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED)return false;
        if(activity==null || !activity.isVisible)return false;
        try {context.startForegroundService(new Intent(context,CallService.class));serviceStarted=true;return true;}
        catch(Exception e){showError("无法启动后台通话，请返回应用后重试。");return false;}
    }
    void setState(String next,boolean muted) {
        if(state.equals("idle") && !next.equals("idle"))callGeneration++;
        state=next;this.muted=muted;
        if(active()) {
            if(context.checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED && !ensureForeground())shutdownCall();
            CallService.refresh(this);
        } else {context.stopService(new Intent(context,CallService.class));serviceStarted=false;}
        if(activity!=null)activity.refresh();
    }
    void control(String command) {
        if(!active() || reply==null)return;
        reply.postMessage("{\"type\":\""+command+"\"}");
        if(command.equals("hangup")) {
            long revision=pageRevision,generation=callGeneration;
            // A delayed teardown belongs to this dial, never a same-page redial.
            handler.postDelayed(()->{if(revision==pageRevision && generation==callGeneration && active()){web.loadUrl("about:blank");setState("idle",false);loaded=false;}},5000);
        }
    }
    void shutdownCall(){control("hangup");web.loadUrl("about:blank");loaded=false;setState("idle",false);}
    void showError(String message){if(activity!=null)activity.error(message);}
}

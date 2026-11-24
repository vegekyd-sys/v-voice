package live.tianyi.vvoice.tv;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.PowerManager;
import android.webkit.*;
import org.json.JSONObject;
import java.io.File;
import java.nio.file.Files;

/** One page may wait on the desktop. Only the call service can grant it a capture token. */
public final class DesktopPage extends BroadcastReceiver {
    private static Page idle;
    private static boolean homeSeen;
    static volatile String state = "empty";
    static final class Page extends WebView {
        final String entry;
        final TvArrayCapture capture;
        Runnable resized, finishCue;
        PortraitFlight flight;
        final BroadcastReceiver screenOff = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) { if (idle == Page.this) discard(); }
        };
        Page(Context context, String entry) {
            super(context.getApplicationContext());
            this.entry = entry;
            capture = new TvArrayCapture(getContext(), this);
            addJavascriptInterface(capture, "VTVArray");
            addJavascriptInterface(new Object() {
                @JavascriptInterface public void finish() { post(() -> { if (finishCue != null) finishCue.run(); }); }
            }, "VTVStartupCue");
            addJavascriptInterface(new Object(){
                @JavascriptInterface public void move(double x,double y,double width){
                    post(()->{if(flight!=null)flight.move(x,y,width);});
                }
            },"VTVPortrait");
            WebSettings settings = getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setSupportZoom(false);
            settings.setTextZoom(100);
            settings.setUseWideViewPort(true);
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setAllowFileAccess(false);
            settings.setAllowContentAccess(false);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, false);
        }
        @Override protected void onSizeChanged(int w, int h, int oldw, int oldh) {
            super.onSizeChanged(w, h, oldw, oldh);
            if (resized != null) post(resized);
        }
    }

    static String configured(Context context) {
        try {
            File file = new File(context.getFilesDir(), "entry.json");
            String url = new JSONObject(new String(Files.readAllBytes(file.toPath()), java.nio.charset.StandardCharsets.UTF_8)).getString("personalUrl");
            if (EntryPolicy.trusted(url) && url.startsWith("https://"))
                return android.net.Uri.parse(url).buildUpon().appendQueryParameter("tv","1").appendQueryParameter("tvShell","1")
                    .appendQueryParameter("tvSurface","1").appendQueryParameter("tvOverlay","1").build().toString();
        } catch (Exception ignored) {}
        return null;
    }
    @Override public void onReceive(Context context, Intent intent) {
        if (!"live.tianyi.vvoice.tv.QUERY_SURFACE".equals(intent.getAction())) return;
        homeSeen = true;
        warm(context);
    }
    static void warm(Context context) {
        if (!homeSeen || CallService.running() || !context.getSystemService(PowerManager.class).isInteractive()) return;
        String entry = configured(context);
        if (idle != null && idle.entry.equals(entry)) return;
        discard();
        if (entry == null) return;
        Page page = new Page(context, entry);
        idle = page;
        state = "loading";
        page.getContext().registerReceiver(page.screenOff, new IntentFilter(Intent.ACTION_SCREEN_OFF), Context.RECEIVER_NOT_EXPORTED);
        page.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !EntryPolicy.trusted(request.getUrl().toString());
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (idle == page && EntryPolicy.trusted(url)) state = "loaded";
            }
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                if (idle == page) discard();
                return true;
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (idle == page && request.isForMainFrame()) discard();
            }
        });
        page.loadUrl(entry);
    }
    static Page take(String entry) {
        Page page = idle;
        if (page == null) return null;
        if (!page.entry.equals(entry)) { discard(); return null; }
        idle = null;
        page.getContext().unregisterReceiver(page.screenOff);
        state = "adopted";
        return page;
    }
    static void discard() {
        Page page = idle;
        if (page == null) return;
        take(page.entry);
        page.destroy();
        state = "empty";
    }
}

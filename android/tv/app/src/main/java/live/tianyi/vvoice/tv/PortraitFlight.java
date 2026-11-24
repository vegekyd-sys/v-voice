package live.tianyi.vvoice.tv;

import android.graphics.*;
import android.view.*;
import android.view.animation.PathInterpolator;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.ImageView;
import org.json.JSONObject;

/** Keeps the source in screen coordinates while WindowManager replaces the WebView surface. */
final class PortraitFlight {
    private final WindowManager windows;
    private final WebView web;
    private FrameLayout layer;
    private ImageView face;
    private boolean moving;
    private final Runnable timeout=this::cancel;
    PortraitFlight(WindowManager windows,WebView web){this.windows=windows;this.web=web;}

    void begin(JSONObject origin){
        if(origin==null||layer!=null||!web.isAttachedToWindow())return;
        float density=web.getResources().getDisplayMetrics().density;
        int x=Math.round((float)origin.optDouble("x")*density);
        int y=Math.round((float)origin.optDouble("y")*density);
        int size=Math.round((float)origin.optDouble("size")*density);
        if(size<=0||size>web.getWidth()||size>1024)return;
        int[] at=new int[2];web.getLocationOnScreen(at);
        Bitmap frame=Bitmap.createBitmap(size,size,Bitmap.Config.ARGB_8888);
        Canvas canvas=new Canvas(frame);canvas.translate(at[0]-x,at[1]-y);web.draw(canvas);
        face=new ImageView(web.getContext());face.setImageBitmap(frame);face.setScaleType(ImageView.ScaleType.FIT_XY);
        face.setOutlineProvider(new ViewOutlineProvider(){@Override public void getOutline(View view,Outline outline){outline.setOval(0,0,size,size);}});
        face.setClipToOutline(true);face.setPivotX(0);face.setPivotY(0);
        face.setTranslationX(x);face.setTranslationY(y);
        layer=new FrameLayout(web.getContext());layer.addView(face,new FrameLayout.LayoutParams(size,size));
        WindowManager.LayoutParams params=new WindowManager.LayoutParams(-1,-1,WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE|WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE|
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN|WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,PixelFormat.TRANSLUCENT);
        params.gravity=Gravity.TOP|Gravity.LEFT;
        if(android.os.Build.VERSION.SDK_INT>=30)params.setFitInsetsTypes(0);
        windows.addView(layer,params);
        web.setAlpha(0);
        web.postDelayed(timeout,2800);
    }
    void move(double x,double y,double width){
        if(layer==null || moving || !(x>=0&&x<=1&&y>=0&&y<=1&&width>0&&width<=1))return;
        moving=true;
        FrameLayout owner=layer;
        web.postVisualStateCallback(0,new WebView.VisualStateCallback(){@Override public void onComplete(long id){
            if(layer!=owner)return;
            int span=web.getWidth();
            float endX=(float)x*span,endY=(float)y*span,endScale=(float)(width*span/face.getWidth());
            float startX=face.getTranslationX(),startY=face.getTranslationY();
            PathInterpolator ease=new PathInterpolator(.32f,0,.2f,1);
            // Relayout can occupy several vsyncs on first entry. Count displayed
            // frames so a stalled compositor cannot skip directly to the end.
            layer.postOnAnimation(new Runnable(){
                long previous; float elapsed;
                public void run(){
                    if(layer!=owner)return;
                    long now=android.os.SystemClock.uptimeMillis();
                    if(previous!=0)elapsed+=Math.min(28,now-previous);
                    previous=now;
                    float t=android.animation.ValueAnimator.areAnimatorsEnabled()?Math.min(1,elapsed/420):1;
                    float progress=ease.getInterpolation(t);
                    face.setTranslationX(startX+(endX-startX)*progress);
                    face.setTranslationY(startY+(endY-startY)*progress);
                    face.setScaleX(1+(endScale-1)*progress);face.setScaleY(face.getScaleX());
                    web.setAlpha(Math.min(1,t*2));
                    if(t<1){layer.postOnAnimation(this);return;}
                    web.evaluateJavascript("window.vVoiceTV?.finishEnter?.()",unused->{
                        if(layer==owner)web.postVisualStateCallback(1,new WebView.VisualStateCallback(){
                            @Override public void onComplete(long request){
                                // This callback guarantees the next draw contains the live
                                // portrait. Keep the copy until that draw is on screen.
                                if(layer==owner)web.postOnAnimation(()->web.postOnAnimation(()->{
                                    if(layer==owner)web.postDelayed(()->{if(layer==owner)clear();},80);
                                }));
                            }
                        });
                    });
                }
            });
        }});
    }
    void cancel(){
        if(layer==null)return;
        web.evaluateJavascript("window.vVoiceTV?.finishEnter?.()",null);
        clear();
    }
    private void clear(){
        web.removeCallbacks(timeout);face.animate().cancel();web.animate().cancel();web.setAlpha(1);
        windows.removeViewImmediate(layer);layer=null;face=null;moving=false;
    }
}

package live.tianyi.vvoice.tv;
import android.content.*;
import android.webkit.WebView;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.lang.reflect.Field;
import java.util.concurrent.*;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Signed test-only harness. Caller must verify idle before starting. Only
 * bounded timings are logged; no entry URL, model audio, or transcript is read. */
@RunWith(AndroidJUnit4.class)
public class CallPlaybackIntegrationTest {
 private WebView web;
 private Object field(Object target,String name)throws Exception{Field f=CallService.class.getDeclaredField(name);f.setAccessible(true);return f.get(target);}
 private String js(String code)throws Exception{
  CountDownLatch ready=new CountDownLatch(1);String[] result={null};
  InstrumentationRegistry.getInstrumentation().runOnMainSync(()->web.evaluateJavascript(code,v->{result[0]=v;ready.countDown();}));
  assertTrue("UI evaluation timeout",ready.await(8,TimeUnit.SECONDS));return result[0];
 }
 private JSONObject snapshot()throws Exception{
  String result=js("JSON.stringify({call:window.vVoiceTV?.snapshot?.call,timing:document.documentElement.dataset.voiceTiming,clock:document.documentElement.dataset.voicePlaybackClock,bundled:!!document.querySelector('script[src*=\"tv-entry.bundle\"]'),resources:performance.getEntriesByType('resource').filter(r=>/\\.(mjs|js|wasm|webp)(\\?|$)/.test(r.name)).map(r=>({file:new URL(r.name).pathname.split('/').pop(),ms:Math.round(r.duration),bytes:r.transferSize})),syntheticFrames:Number(document.documentElement.dataset.voiceSyntheticPromptFrames||0),mic:window.vVoiceTV?.snapshot?.microphone?.driver})");
  Object decoded=new JSONTokener(result).nextValue();return decoded instanceof String?new JSONObject((String)decoded):new JSONObject();
 }
 @Test public void coldEntryAndContinuousSpeechClock()throws Exception {
  var inst=InstrumentationRegistry.getInstrumentation();Context context=inst.getTargetContext();
  assertNull("Do not interrupt an existing service",field(null,"current"));
  long started=SystemClock.elapsedRealtime();JSONObject out=new JSONObject();JSONArray samples=new JSONArray();
  try{
   context.startActivity(new Intent("live.tianyi.vvoice.tv.action.START_CALL").setClassName(context.getPackageName(),"live.tianyi.vvoice.tv.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
   Object service=null;
   while(SystemClock.elapsedRealtime()-started<10000){service=field(null,"current");if(service!=null&&field(service,"web")!=null)break;Thread.sleep(100);}
   assertNotNull("Call service not started",service);web=(WebView)field(service,"web");JSONObject s=null;
   while(SystemClock.elapsedRealtime()-started<45000){s=snapshot();if("connected".equals(s.optString("call")))break;Thread.sleep(250);}
   assertEquals(s.toString(),"connected",s.optString("call"));out.put("connectedAfterMs",SystemClock.elapsedRealtime()-started).put("startup",s);
   Thread.sleep(3000);
   if("true".equals(InstrumentationRegistry.getArguments().getString("exerciseFull"))){
    if("true".equals(InstrumentationRegistry.getArguments().getString("hardwareFull")))inst.runOnMainSync(()->web.setLayerType(android.view.View.LAYER_TYPE_HARDWARE,null));
    js("window.vVoiceTV.setLayout('full')");Thread.sleep(800);
   }
   String prompt=android.util.Base64.encodeToString(inst.getContext().getAssets().open("synthetic-story-request.pcm").readAllBytes(),android.util.Base64.NO_WRAP);
   // Replace input only in this explicitly owned test call. This is generated
   // speech, not a recording of the room; normal capture resumes afterward.
   js("(()=>{const pcm=Uint8Array.from(atob("+JSONObject.quote(prompt)+"),c=>c.charCodeAt(0));const original=WebSocket.prototype.send;let offset=0,tail=50;WebSocket.prototype.send=function(data){if(data instanceof ArrayBuffer&&data.byteLength===960&&new URL(this.url).pathname.endsWith('/api/relay')){const frame=new Uint8Array(960);if(offset<pcm.length){frame.set(pcm.subarray(offset,offset+960));offset+=960;}else if(--tail<0){WebSocket.prototype.send=original;return original.call(this,data);}document.documentElement.dataset.voiceSyntheticPromptFrames=String(Math.ceil(offset/960));return original.call(this,frame.buffer);}return original.call(this,data);};return true;})()");
   out.put("syntheticSpeechStimulus",true);Thread.sleep(500);
   boolean crossApps="true".equals(InstrumentationRegistry.getArguments().getString("crossApps"));out.put("crossApps",crossApps);
   for(int i=0;i<Integer.parseInt(InstrumentationRegistry.getArguments().getString("samples","15"));i++){
    if(crossApps&&i==4)context.startActivity(new Intent(android.provider.Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    if(crossApps&&i==8)context.startActivity(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    if(crossApps&&i==11)js("window.vVoiceTV.setLayout('medium')");
    Thread.sleep(2000);s=snapshot();s.remove("resources");s.remove("timing");s.put("elapsedMs",SystemClock.elapsedRealtime()-started);samples.put(s);assertEquals("connected",s.optString("call"));}
   js("window.vVoiceTV.action('end',window.vVoiceTV.snapshot)");Thread.sleep(1500);
   out.put("samples",samples).put("humanSpeechStimulus",false).put("fixedTextPlaybackTest",false);
  }finally{
   inst.runOnMainSync(()->context.stopService(new Intent().setClassName(context.getPackageName(),"live.tianyi.vvoice.tv.CallService")));Thread.sleep(1800);
   out.put("samples",samples);String result=out.toString();
   try(var stream=context.openFileOutput("playback-test-timing.json",Context.MODE_PRIVATE)){stream.write(result.getBytes(java.nio.charset.StandardCharsets.UTF_8));}
   for(int i=0;i<result.length();i+=3000)android.util.Log.i("VTVCallClock",result.substring(i,Math.min(i+3000,result.length())));
  }
 }
}

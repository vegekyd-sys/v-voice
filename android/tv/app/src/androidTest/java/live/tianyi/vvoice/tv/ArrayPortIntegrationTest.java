package live.tianyi.vvoice.tv;

import android.content.Context;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.webkit.*;
import android.os.SystemClock;
import android.util.Base64;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.lang.reflect.*;
import java.util.ArrayDeque;
import java.util.concurrent.*;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Real Android WebMessagePort -> real shared DSP Worker -> shared capture owner.
 * Only the source is synthetic; no microphone recording, model call or PCM file. */
@RunWith(AndroidJUnit4.class)
public class ArrayPortIntegrationTest {
    private static final String ORIGIN="http://127.0.0.1:26326";
    private static Field field(String name)throws Exception {Field f=TvArrayCapture.class.getDeclaredField(name);f.setAccessible(true);return f;}
    public static final class Source {
        final TvArrayCapture capture;final String token;final int version;
        final CountDownLatch done=new CountDownLatch(1);String id,result;
        ScheduledExecutorService timer;int produced,peak,stops;volatile boolean stopped;
        Source(TvArrayCapture c,int version){capture=c;this.version=version;capture.foreground(true);token=capture.newPage();}
        @JavascriptInterface public String token(){return token;}
        @JavascriptInterface public synchronized String start(String token,String id){
            try{
                if(!this.token.equals(token))throw new IllegalStateException();this.id=id;stopped=false;
                // Placeholder owns a valid lifecycle but is never startRecording'ed.
                AudioRecord record=new AudioRecord.Builder().setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION).setAudioFormat(new AudioFormat.Builder().setSampleRate(16000).setChannelMask(AudioFormat.CHANNEL_IN_MONO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build()).setBufferSizeInBytes(6400).build();
                field("record").set(capture,record);field("captureId").set(capture,id);
                return "{\"version\":"+version+",\"sampleRate\":16000,\"channels\":4,\"source\":\"instrumented-synthetic\",\"channelLayout\":{\"version\":1,\"microphones\":[0,1],\"references\":[2,3]}}";
            }catch(Exception e){return "{\"error\":\"test source preparation failed\"}";}
        }
        @JavascriptInterface public String openStream(String token,String id){return capture.openStream(token,id);}
        @JavascriptInterface public String pull(String token,String id){return capture.pull(token,id);}
        @JavascriptInterface public synchronized String begin(String token,String id){
            if(!this.token.equals(token)||!this.id.equals(id))return "INVALID_OWNER";
            timer=Executors.newSingleThreadScheduledExecutor();timer.scheduleAtFixedRate(this::produce,0,20,TimeUnit.MILLISECONDS);return "ok";
        }
        private void produce(){
            if(stopped)return;
            synchronized(capture){try{
                if(stopped)return;
                @SuppressWarnings("unchecked") ArrayDeque<String> queue=(ArrayDeque<String>)field("frames").get(capture);
                peak=Math.max(peak,queue.size()+1);
                if(queue.size()>=25){field("captureError").set(capture,"TV_MIC_BACKPRESSURE");Method m=TvArrayCapture.class.getDeclaredMethod("notifyPortError");m.setAccessible(true);m.invoke(capture);timer.shutdown();return;}
                byte[] bytes=new byte[2560];int sequence=++produced;
                for(int i=0;i<320;i++){short sample=(short)(Math.sin((sequence*320+i)*2*Math.PI*230/16000)*1200);for(int c=0;c<2;c++){int offset=(i*4+c)*2;bytes[offset]=(byte)sample;bytes[offset+1]=(byte)(sample>>8);}}
                queue.add("{\"sequence\":"+sequence+",\"channels\":4,\"pcm\":\""+Base64.encodeToString(bytes,Base64.NO_WRAP)+"\"}");
                if(version==4){Method m=TvArrayCapture.class.getDeclaredMethod("pumpPort",AudioRecord.class);m.setAccessible(true);m.invoke(capture,field("record").get(capture));}
            }catch(Exception e){result="native producer: "+e;done.countDown();}}
        }
        @JavascriptInterface public synchronized void stop(String token,String id){stopped=true;if(timer!=null)timer.shutdownNow();capture.stop(token,id);stops++;}
        @JavascriptInterface public void finish(String value){result=value;done.countDown();}
    }
    private String run(int version,boolean stressed)throws Exception {
        var instrumentation=InstrumentationRegistry.getInstrumentation();Context context=instrumentation.getTargetContext();
        instrumentation.getUiAutomation().executeShellCommand("pm grant "+context.getPackageName()+" android.permission.RECORD_AUDIO").close();
        android.app.Activity activity=instrumentation.startActivitySync(new android.content.Intent(context,ArrayPortTestActivity.class).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK));
        WebView[] web={null};Source[] source={null};
        instrumentation.runOnMainSync(()->{
            web[0]=new WebView(activity);activity.setContentView(web[0]);web[0].getSettings().setJavaScriptEnabled(true);web[0].getSettings().setMediaPlaybackRequiresUserGesture(false);
            TvArrayCapture capture=new TvArrayCapture(context,web[0]);source[0]=new Source(capture,version);
            web[0].addJavascriptInterface(source[0],"VTVArray");
            String script="""
              <script type="module">
              import {captureTvArray} from '/tv-array-capture.mjs';
              let capture,context,timer;const result={frames:0,syntheticOnly:true,errors:[],stress:STRESSED,version:VERSION};
              const pause=ms=>{const end=performance.now()+ms;while(performance.now()<end){}};
              try{
                const source=await fetch('/tv-array-worker.js').then(r=>r.text());
                const absolute=source.replace("'./assets/","'http://127.0.0.1:26326/assets/").replace("'./tv-array-dsp.mjs'","'http://127.0.0.1:26326/tv-array-dsp.mjs'");
                // Match the observed 9-10 ms per-frame DSP cost on this TV.
                const delayed=absolute.replace('output=dsp.capture(pcm);','output=dsp.capture(pcm);const until=before+9;while(performance.now()<until){};');
                const blob=URL.createObjectURL(new Blob([delayed],{type:'text/javascript'}));
                const NativeWorker=Worker;globalThis.Worker=class extends NativeWorker{constructor(){super(blob);}};
                window.vTvAudioCapability={version:1,pageToken:VTVArray.token()};
                context=new AudioContext();await context.resume();
                capture=await captureTvArray({context,directPcm:true,onError:error=>result.errors.push(error.code)});
                capture.subscribePcm(buffer=>{if(buffer.byteLength!==960)throw Error('wrong output length');result.frames++;});
                await capture.startCapture();
                if(result.stress)timer=setInterval(()=>pause(180),250);
                await new Promise(resolve=>setTimeout(resolve,result.stress?20000:2500));
                clearInterval(timer);await new Promise(resolve=>setTimeout(resolve,500));
                result.transport=capture.snapshot().transport;capture.dispose();capture.dispose();await context.close();
                URL.revokeObjectURL(blob);VTVArray.finish(JSON.stringify(result));
              }catch(error){clearInterval(timer);capture?.dispose();context?.close();VTVArray.finish('JS failure: '+error.message);}
              </script>
              """.replace("STRESSED",String.valueOf(stressed)).replace("VERSION",String.valueOf(version));
            web[0].loadDataWithBaseURL(ORIGIN+"/array-port-instrumentation",script,"text/html","utf-8",ORIGIN+"/array-port-instrumentation");
        });
        try{
            assertTrue("transport test timed out",source[0].done.await(stressed?50:25,TimeUnit.SECONDS));
            assertNotNull(source[0].result);android.util.Log.i("VTVPortTest",source[0].result);assertTrue(source[0].result,source[0].result.startsWith("{"));
            JSONObject result=new JSONObject(source[0].result);result.put("nativeProduced",source[0].produced).put("nativeQueuePeak",source[0].peak).put("stopCount",source[0].stops);
            android.util.Log.i("VTVPortTest",result.toString());
            assertTrue(result.getInt("frames")>100);assertEquals(1,result.getInt("stopCount"));
            if(version==4){assertEquals("worker-port",result.getString("transport"));assertEquals("[]",result.getJSONArray("errors").toString());assertTrue(source[0].peak<=25);assertTrue("All but the bounded final in-flight frames were delivered",source[0].produced-result.getInt("frames")<=8);}
            return result.toString();
        }finally{source[0].stopped=true;if(source[0].timer!=null)source[0].timer.shutdownNow();instrumentation.runOnMainSync(()->{source[0].capture.foreground(false);web[0].destroy();activity.finish();});}
    }
    @Test public void workerPortTransfersNativeFramesAndStopsOnce()throws Exception {run(4,false);}
    @Test public void workerPortSurvivesRepeatedMainThreadStalls()throws Exception {run(4,true);}
    @Test public void legacyPullBaselineUnderSameStalls()throws Exception {run(3,true);}
}

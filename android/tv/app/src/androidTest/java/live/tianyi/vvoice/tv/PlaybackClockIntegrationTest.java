package live.tianyi.vvoice.tv;

import android.content.Context;
import android.webkit.*;
import android.view.View;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.*;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Silent local PCM through the real shared speaker and Android output clock.
 * No microphone, network, model, personal entry, or recorded PCM. */
@RunWith(AndroidJUnit4.class)
public class PlaybackClockIntegrationTest {
 public static final class Result {
  final CountDownLatch done=new CountDownLatch(1);String value;
  @JavascriptInterface public void finish(String value){this.value=value;done.countDown();}
 }
 @Test public void measureOutputClockForLatencyModes()throws Exception {
  var inst=InstrumentationRegistry.getInstrumentation();Context context=inst.getTargetContext();
  var activity=inst.startActivitySync(new android.content.Intent(context,ArrayPortTestActivity.class).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK));
  String worklet=new String(inst.getContext().getAssets().open("relay-worklet.js").readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);
  String buffered=new String(inst.getContext().getAssets().open("buffered-speaker.js").readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);
  Result result=new Result();WebView[] web={null};
  inst.runOnMainSync(()->{
   web[0]=new WebView(activity);web[0].setLayerType(View.LAYER_TYPE_SOFTWARE,null);activity.setContentView(web[0]);
   web[0].getSettings().setJavaScriptEnabled(true);web[0].getSettings().setMediaPlaybackRequiresUserGesture(false);web[0].addJavascriptInterface(result,"ClockResult");
   String script="""
    <script>const worklet=WORKLET;const createBufferedPcmSpeaker=BUFFERED;</script><script type="module">
    const rows=[];
    try{
     for(const mode of Array.from({length:12},()=>'buffered-scheduler')){const hint=mode;
      const c=new AudioContext({latencyHint:'interactive'});await c.resume();
      let s;
      if(mode==='buffered-scheduler'){s=createBufferedPcmSpeaker(c);s.connect(c.destination);}
      else if(mode==='worklet'){
       const url=URL.createObjectURL(new Blob([worklet],{type:'text/javascript'}));await c.audioWorklet.addModule(url);URL.revokeObjectURL(url);
       s=new AudioWorkletNode(c,'v-direct-speaker',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1]});s.connect(c.destination);
      }else if(mode==='buffer-source'){
       s=c.createBufferSource();s.buffer=c.createBuffer(1,24000*25,24000);s.connect(c.destination);s.start();s.port={postMessage(){},close(){}};
      }else{
       s=c.createScriptProcessor(4096,0,1);s.onaudioprocess=e=>e.outputBuffer.getChannelData(0).fill(0);s.connect(c.destination);s.port={postMessage(){},close(){}};
      }
      let last; s.port.onmessage=e=>{if(e.data.type==='playback')last=e.data;};
      const buffer=new Int16Array(24000*25).buffer;s.port.postMessage({type:'audio',buffer,epoch:0},[buffer]);s.port.postMessage({type:'done',epoch:0});
      await new Promise(r=>setTimeout(r,1000));const t=performance.now(),start=c.currentTime;
      const samples=[];for(let i=0;i<3;i++){await new Promise(r=>setTimeout(r,1000));samples.push({wallMs:performance.now()-t,audioMs:(c.currentTime-start)*1000,output:c.getOutputTimestamp?.(),last});}
      rows.push({hint,sampleRate:c.sampleRate,baseLatency:c.baseLatency,outputLatency:c.outputLatency,samples});s.disconnect();s.port.close();await c.close();
     }
     ClockResult.finish(JSON.stringify({syntheticSilence:true,rows}));
    }catch(e){ClockResult.finish(JSON.stringify({error:String(e),rows}));}
    </script>
    """.replace("WORKLET",JSONObject.quote(worklet)).replace("BUFFERED",buffered);
   web[0].loadDataWithBaseURL("https://test.invalid/",script,"text/html","utf-8",null);
  });
  try{assertTrue(result.done.await(65,TimeUnit.SECONDS));assertNotNull(result.value);for(int i=0;i<result.value.length();i+=3000)android.util.Log.i("VTVClockTest",result.value.substring(i,Math.min(i+3000,result.value.length())));assertFalse(result.value,result.value.contains("\"error\""));}
  finally{inst.runOnMainSync(()->{web[0].destroy();activity.finish();});}
 }
}

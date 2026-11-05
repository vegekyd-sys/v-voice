package live.tianyi.vvoice.tv;
import android.media.*;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;
/** Bounded synthetic silence only. Tests the hardware sink, not human hearing. */
@RunWith(AndroidJUnit4.class)
public class NativePlaybackClockIntegrationTest {
 @Test public void nativeOutputTracksWallClock()throws Exception{
  JSONArray rows=new JSONArray();
  for(int run=0;run<4;run++){
   int rate=24000,size=Math.max(AudioTrack.getMinBufferSize(rate,AudioFormat.CHANNEL_OUT_MONO,AudioFormat.ENCODING_PCM_16BIT),rate*2/5);
   AudioTrack track=new AudioTrack.Builder().setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()).setAudioFormat(new AudioFormat.Builder().setSampleRate(rate).setEncoding(AudioFormat.ENCODING_PCM_16BIT).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build()).setBufferSizeInBytes(size).setTransferMode(AudioTrack.MODE_STREAM).build();
   AtomicBoolean running=new AtomicBoolean(true);Thread worker=new Thread(()->{android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_AUDIO);short[] silence=new short[480];while(running.get()){int n=track.write(silence,0,silence.length,AudioTrack.WRITE_BLOCKING);if(n<0)break;}});
   double ratio;int underruns;
   try{track.play();worker.start();Thread.sleep(1000);long before=track.getPlaybackHeadPosition()&0xffffffffL,t=SystemClock.elapsedRealtime();Thread.sleep(5000);long after=track.getPlaybackHeadPosition()&0xffffffffL,wall=SystemClock.elapsedRealtime()-t;ratio=(after-before)*1000.0/rate/wall;underruns=track.getUnderrunCount();rows.put(new JSONObject().put("run",run).put("rate",rate).put("ratio",ratio).put("underruns",underruns).put("frames",after-before).put("wallMs",wall));}
   finally{running.set(false);track.pause();track.flush();worker.join(1500);track.release();}
   assertTrue(rows.toString(),ratio>.95&&ratio<1.05);
  }
  android.util.Log.i("VTVNativeClock",rows.toString());
 }
}

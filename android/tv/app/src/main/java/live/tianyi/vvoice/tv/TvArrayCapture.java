package live.tianyi.vvoice.tv;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.*;
import android.os.Process;
import android.os.Handler;
import android.os.HandlerThread;
import android.net.Uri;
import android.webkit.WebMessage;
import android.webkit.WebMessagePort;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import org.json.JSONObject;
import java.util.UUID;

/** Bounded hardware capture adapter. PCM exists only in memory, never in diagnostics/files. */
final class TvArrayCapture {
    private final Context context;
    private final WebView web;
    private volatile String pageToken="";
    private volatile boolean foreground;
    private volatile AudioRecord record;
    private volatile String captureId;
    private Thread worker;
    private final java.util.ArrayDeque<String> frames=new java.util.ArrayDeque<>();
    private volatile String captureError;
    private int captureChannels,captureRate;
    private long beganAt,captured,pulled,pullCount,firstFrameAt,maxReadMs;
    private int queuePeak;
    private WebMessagePort audioPort;
    private HandlerThread portThread;
    private boolean portRequested,portReady;
    private final CaptureCredits credits=new CaptureCredits();
    private long lastPullAt,maxPullGapMs;
    TvArrayCapture(Context context,WebView web){this.context=context;this.web=web;}
    void foreground(boolean value){foreground=value;if(!value)stopInternal();}
    String newPage(){stopInternal();pageToken=UUID.randomUUID().toString();return pageToken;}
    void invalidate(){pageToken="";stopInternal();}
    private boolean allowed(String token){return foreground&&!pageToken.isEmpty()&&pageToken.equals(token)&&context.checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED;}
    @JavascriptInterface public synchronized String start(String token,String id){
        if(!allowed(token)||id==null||!id.matches("capture-[a-zA-Z0-9-]{8,64}"))return "{\"error\":\"麦克风权限或页面已失效\"}";
        if(id.equals(captureId))return "{\"error\":\"采集已启动\"}";
        stopInternal();
        if(context.checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED)return "{\"error\":\"请允许麦克风权限\"}";
        AudioManager manager=(AudioManager)context.getSystemService(Context.AUDIO_SERVICE);
        AudioDeviceInfo builtin=null;
        for(AudioDeviceInfo device:manager.getDevices(AudioManager.GET_DEVICES_INPUTS))if(device.getType()==AudioDeviceInfo.TYPE_BUILTIN_MIC){builtin=device;break;}
        if(builtin==null)return "{\"error\":\"未找到电视本体麦克风\"}";
        AudioRecord selected=null;int selectedChannels=0,selectedRate=0;
        formats: for(int rate:new int[]{16000,48000})for(int channels:new int[]{4,6}){
            AudioRecord candidate=null;
            try{
                AudioFormat format=new AudioFormat.Builder().setSampleRate(rate).setEncoding(AudioFormat.ENCODING_PCM_16BIT).setChannelIndexMask((1<<channels)-1).build();
                candidate=new AudioRecord.Builder().setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION).setAudioFormat(format).setBufferSizeInBytes(rate*channels*2/5).build();
                if(candidate.getState()!=AudioRecord.STATE_INITIALIZED||candidate.getChannelCount()!=channels||candidate.getSampleRate()!=rate||!candidate.setPreferredDevice(builtin)){candidate.release();continue;}
                selected=candidate;selectedChannels=channels;selectedRate=rate;break formats;
            }catch(Exception error){if(candidate!=null)candidate.release();}
        }
        if(selected==null)return "{\"error\":\"电视阵列输入未就绪，不能退回单声道回采\"}";
        final AudioRecord active=selected;final int channels=selectedChannels;
        record=active;captureId=id;captureChannels=channels;captureRate=selectedRate;captureError=null;frames.clear();beganAt=captured=pulled=pullCount=firstFrameAt=maxReadMs=0;queuePeak=0;lastPullAt=maxPullGapMs=0;
        try{
            JSONObject info=new JSONObject().put("version",4).put("sampleRate",captureRate).put("channels",channels).put("source","voice-recognition-array").put("preferredDevice","builtin-mic");
            String layout=ArrayLayout.forCapture(android.os.Build.MODEL,channels,captureRate);
            if(layout!=null)info.put("channelLayout",new JSONObject(layout));
            return info.toString();
        }
        catch(Exception ignored){stopInternal();return "{\"error\":\"输入初始化失败\"}";}
    }
    // Transfer a capability-scoped channel once. Steady-state audio goes directly
    // to the shared DSP worker, without synchronous JavaScript/UI-thread pulls.
    @JavascriptInterface public synchronized String openStream(String token,String id){
        if(!allowed(token)||id==null||!id.equals(captureId)||record==null||worker!=null||portRequested)return "INVALID_OWNER";
        final AudioRecord active=record;portRequested=true;
        web.post(()->{
            synchronized(TvArrayCapture.this){
                if(record!=active||!allowed(token)||!id.equals(captureId))return;
                try{
                    String url=web.getUrl();if(!EntryPolicy.trusted(url))throw new IllegalStateException("untrusted-audio-page");
                    Uri page=Uri.parse(url),origin=new Uri.Builder().scheme(page.getScheme()).encodedAuthority(page.getEncodedAuthority()).build();
                    WebMessagePort[] pair=web.createWebMessageChannel();audioPort=pair[0];
                    portThread=new HandlerThread("v-tv-audio-port",Process.THREAD_PRIORITY_AUDIO);portThread.start();
                    audioPort.setWebMessageCallback(new WebMessagePort.WebMessageCallback(){@Override public void onMessage(WebMessagePort port,WebMessage message){
                        synchronized(TvArrayCapture.this){
                            if(record!=active||audioPort!=port||!allowed(token)||!id.equals(captureId))return;
                            try{
                                String raw=message.getData();if(raw==null||raw.length()>160)throw new IllegalArgumentException();
                                JSONObject command=new JSONObject(raw);String type=command.optString("type");
                                if("ready".equals(type)&&!portReady){portReady=true;port.postMessage(new WebMessage("{\"type\":\"ready\"}"));}
                                else if("consumed".equals(type)&&portReady){credits.acknowledge(command.getLong("sequence"));pumpPort(active);}
                                else throw new IllegalArgumentException();
                            }catch(Exception error){android.util.Log.w("VTVAudio","stream error "+error.getClass().getSimpleName());markError(active,"TV_MIC_STREAM");}
                        }
                    }},new Handler(portThread.getLooper()));
                    String envelope=new JSONObject().put("type","v-tv-array-port").put("version",1).put("pageToken",token).put("captureId",id).toString();
                    web.postWebMessage(new WebMessage(envelope,new WebMessagePort[]{pair[1]}),origin);
                }catch(Exception error){android.util.Log.w("VTVAudio","stream error "+error.getClass().getSimpleName());markError(active,"TV_MIC_STREAM");}
            }
        });return "ok";
    }
    private void notifyPortError(){if(audioPort!=null&&captureError!=null)try{audioPort.postMessage(new WebMessage("{\"error\":\""+captureError+"\"}"));}catch(Exception ignored){}}
    private void pumpPort(AudioRecord active){
        if(record!=active||audioPort==null||!portReady||captureError!=null)return;
        try{
            while(!frames.isEmpty()&&credits.available()){
                String payload=frames.remove();credits.sent();pulled++;
                audioPort.postMessage(new WebMessage(payload));
            }
        }catch(Exception error){android.util.Log.w("VTVAudio","stream error "+error.getClass().getSimpleName());markError(active,"TV_MIC_STREAM");}
    }
    // Prepare first, then begin only when the shared DSP and worklets are warm.
    @JavascriptInterface public synchronized String begin(String token,String id){
        if(!allowed(token)||id==null||!id.equals(captureId)||record==null||worker!=null||(portRequested&&!portReady))return "INVALID_OWNER";
        final AudioRecord active=record;final int channels=captureChannels;
        try{active.startRecording();if(active.getRecordingState()!=AudioRecord.RECORDSTATE_RECORDING)throw new IllegalStateException();}
        catch(Exception error){stopInternal();return "TV_MIC_START";}
        beganAt=android.os.SystemClock.elapsedRealtime();android.util.Log.i("VTVAudio","begin channels="+channels+" sampleRate="+active.getSampleRate()+" bufferFrames="+active.getBufferSizeInFrames());
        worker=new Thread(()->read(active,channels,token,id),"v-tv-array");worker.start();return "ok";
    }
    // One bounded pull replaces 50 evaluateJavascript calls/callbacks per second.
    // No sample is dropped or retained on disk; sustained lag is a visible failure.
    @JavascriptInterface public synchronized String pull(String token,String id){
        if(!allowed(token)||id==null||!id.equals(captureId))return "{\"error\":\"TV_MIC_OWNER\"}";
        if(captureError!=null)return "{\"error\":\""+captureError+"\"}";
        if(portRequested)return "{\"error\":\"TV_MIC_STREAM\"}";
        long now=android.os.SystemClock.elapsedRealtime();if(lastPullAt>0)maxPullGapMs=Math.max(maxPullGapMs,now-lastPullAt);lastPullAt=now;
        pullCount++;StringBuilder out=new StringBuilder("{\"frames\":[");
        for(int n=0;n<4&&!frames.isEmpty();n++){if(n>0)out.append(',');out.append(frames.remove());pulled++;}
        return out.append("]}").toString();
    }
    private void read(AudioRecord active,int channels,String token,String id){
        Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO);
        short[] samples=new short[(active.getSampleRate()/50)*channels];int filled=0;long sequence=0;
        while(record==active&&allowed(token)){
            long beforeRead=android.os.SystemClock.elapsedRealtime();int count;try{count=active.read(samples,filled,samples.length-filled,AudioRecord.READ_BLOCKING);}catch(IllegalStateException stopped){break;}
            if(count<=0){markError(active,"TV_MIC_READ");break;}
            maxReadMs=Math.max(maxReadMs,android.os.SystemClock.elapsedRealtime()-beforeRead);filled+=count;if(filled<samples.length)continue;
            AudioDeviceInfo routed=active.getRoutedDevice();if(routed!=null&&routed.getType()!=AudioDeviceInfo.TYPE_BUILTIN_MIC){markError(active,"TV_MIC_ROUTE");break;}
            byte[] bytes=new byte[samples.length*2];
            for(int i=0;i<samples.length;i++){bytes[i*2]=(byte)samples[i];bytes[i*2+1]=(byte)(samples[i]>>8);}
            String encoded=Base64.encodeToString(bytes,Base64.NO_WRAP);long seq=++sequence;
            synchronized(this){
                if(record!=active)break;
                captured++;if(firstFrameAt==0)firstFrameAt=android.os.SystemClock.elapsedRealtime();queuePeak=Math.max(queuePeak,frames.size()+1);
                if(frames.size()>=25){captureError="TV_MIC_BACKPRESSURE";logSummary();notifyPortError();break;}
                frames.add("{\"sequence\":"+seq+",\"channels\":"+channels+",\"pcm\":"+JSONObject.quote(encoded)+"}");
                pumpPort(active);
            }
            filled=0;
        }
        if(record==active&&foreground&&pageToken.equals(token)&&!allowed(token))markError(active,"TV_MIC_PERMISSION");
        // The page owns teardown; retain only the bounded error code until pulled.
        try{active.stop();}catch(Exception ignored){}
    }
    private synchronized void logSummary(){if(beganAt>0)android.util.Log.i("VTVAudio","summary elapsedMs="+(android.os.SystemClock.elapsedRealtime()-beganAt)+" firstFrameMs="+(firstFrameAt-beganAt)+" captured="+captured+" pulled="+pulled+" pullCount="+pullCount+" queuePeak="+queuePeak+" maxReadMs="+maxReadMs+" error="+captureError+" transport="+(portRequested?"worker-port":"ui-pull")+" inFlightPeak="+credits.peak()+" maxPullGapMs="+maxPullGapMs);}
    private synchronized void markError(AudioRecord active,String code){if(record==active){captureError=code;notifyPortError();}}
    @JavascriptInterface public synchronized void stop(String token,String id){if(pageToken.equals(token)&&id!=null&&id.equals(captureId))stopInternal();}
    private synchronized void stopInternal(){logSummary();beganAt=0;AudioRecord old=record;record=null;
        if(audioPort!=null){try{audioPort.close();}catch(Exception ignored){}audioPort=null;}
        if(portThread!=null){portThread.quitSafely();portThread=null;}portRequested=portReady=false;credits.reset();
        captureId=null;frames.clear();captureError=null;if(old!=null){try{old.stop();}catch(Exception ignored){}old.release();}worker=null;}
}

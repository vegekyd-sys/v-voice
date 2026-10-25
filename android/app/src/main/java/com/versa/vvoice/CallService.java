package com.versa.vvoice;

import android.app.*;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.*;
import android.os.*;

/** Foreground ownership starts from a visible, user-initiated microphone request. */
public final class CallService extends Service {
    private static CallService running;
    private PowerManager.WakeLock wake;
    private AudioManager audio;
    private AudioFocusRequest focus;
    private int previousMode;
    static void refresh(VoiceSession session){if(running!=null)running.notifyState(session);}
    @Override public void onCreate() {
        super.onCreate();running=this;
        getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel("voice-call","V Voice 通话",NotificationManager.IMPORTANCE_LOW));
    }
    private PendingIntent action(String action,int id) {
        return PendingIntent.getService(this,id,new Intent(this,CallService.class).setAction(action),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
    }
    private Notification notification(VoiceSession session) {
        PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Builder(this,"voice-call").setSmallIcon(R.drawable.ic_voice).setContentTitle("V Voice · "+session.label)
            .setContentText(session.state.equals("dialing")?"正在连接…":session.muted?"麦克风已静音":"正在通话")
            .setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true).setCategory(Notification.CATEGORY_CALL)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .addAction(new Notification.Action.Builder(null,session.muted?"取消静音":"静音",action("mute",1)).build())
            .addAction(new Notification.Action.Builder(null,"结束通话",action("hangup",2)).build()).build();
    }
    private void notifyState(VoiceSession session){getSystemService(NotificationManager.class).notify(39,notification(session));}
    @Override public int onStartCommand(Intent intent,int flags,int id) {
        VoiceSession session=VoiceSession.get(this);
        if(intent!=null && ("mute".equals(intent.getAction()) || "hangup".equals(intent.getAction()))) {
            session.control(intent.getAction());if(!session.active())stopSelf();return START_NOT_STICKY;
        }
        if(!session.active()){stopSelf();return START_NOT_STICKY;}
        try {
            startForeground(39,notification(session),ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE|ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            if(wake==null) {
                wake=getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"VVoice:Call");wake.acquire(2*60*60*1000L);
                audio=getSystemService(AudioManager.class);previousMode=audio.getMode();audio.setMode(AudioManager.MODE_IN_COMMUNICATION);
                long generation=session.callGeneration;
                focus=new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                    .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                    .setOnAudioFocusChangeListener(change->{if(running==this && generation==session.callGeneration && (change==AudioManager.AUDIOFOCUS_LOSS || change==AudioManager.AUDIOFOCUS_LOSS_TRANSIENT))session.control("hangup");}).build();
                if(audio.requestAudioFocus(focus)!=AudioManager.AUDIOFOCUS_REQUEST_GRANTED)session.control("hangup");
            }
        }catch(Exception e){session.shutdownCall();stopSelf();}
        return START_NOT_STICKY;
    }
    @Override public void onTaskRemoved(Intent root){VoiceSession.get(this).shutdownCall();stopSelf();}
    @Override public void onDestroy() {
        VoiceSession session=VoiceSession.get(this);
        if(session.active())session.shutdownCall();
        session.serviceStarted=false;
        if(wake!=null && wake.isHeld())wake.release();
        if(audio!=null){if(focus!=null)audio.abandonAudioFocusRequest(focus);audio.setMode(previousMode);}
        running=null;super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent){return null;}
}

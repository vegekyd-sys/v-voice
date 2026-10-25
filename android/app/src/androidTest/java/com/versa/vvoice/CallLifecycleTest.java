package com.versa.vvoice;

import android.content.Context;
import android.content.Intent;
import android.media.AudioManager;
import androidx.test.core.app.ActivityScenario;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.uiautomator.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.JSONObject;
import java.net.URL;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class CallLifecycleTest {
    private final Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
    private final UiDevice device=UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
    private JSONObject fixture() throws Exception {
        try(var stream=new URL("http://127.0.0.1:29849/fixture/state").openStream()) {
            return new JSONObject(new String(BoundedInput.read(stream,4096),java.nio.charset.StandardCharsets.UTF_8));
        }
    }
    private void tone() throws Exception {
        var conn=(java.net.HttpURLConnection)new URL("http://127.0.0.1:29849/fixture/tone").openConnection();conn.setRequestMethod("POST");
        try{assertEquals(200,conn.getResponseCode());}finally{conn.disconnect();}
    }
    interface Check {boolean run() throws Exception;}
    private void until(Check check) throws Exception {long deadline=System.currentTimeMillis()+20000;while(System.currentTimeMillis()<deadline){if(check.run())return;Thread.sleep(100);}fail("Timed out waiting for call lifecycle state");}
    private String state(ActivityScenario<MainActivity> scenario){AtomicReference<String> value=new AtomicReference<>();scenario.onActivity(a->value.set(a.session.state));return value.get();}
    private void js(ActivityScenario<MainActivity> scenario,String script){scenario.onActivity(a->a.session.web.evaluateJavascript(script,null));}
    private String readJs(ActivityScenario<MainActivity> scenario,String script) throws Exception {
        AtomicReference<String> value=new AtomicReference<>();var ready=new java.util.concurrent.CountDownLatch(1);
        scenario.onActivity(a->a.session.web.evaluateJavascript(script,result->{value.set(result);ready.countDown();}));
        assertTrue(ready.await(5,java.util.concurrent.TimeUnit.SECONDS));return value.get();
    }
    @Test public void publicWebCallSurvivesBackgroundAndEndsFromNotification() throws Exception {
        assertEquals("Fixture tests must never dial production", "http://127.0.0.1:29849/voice/",BuildConfig.SERVICE_URL);
        device.executeShellCommand("pm grant "+context.getPackageName()+" android.permission.RECORD_AUDIO");
        device.executeShellCommand("pm grant "+context.getPackageName()+" android.permission.POST_NOTIFICATIONS");
        int originalSessions=fixture().getInt("sessionRequests");
        try(var scenario=ActivityScenario.launch(MainActivity.class)) {
            until(()->device.hasObject(By.res("start")));
            Thread.sleep(1000);assertEquals("startup must not dial",originalSessions,fixture().getInt("sessionRequests"));
            device.findObject(By.res("start")).click();until(()->state(scenario).equals("connected"));
            until(()->fixture().getInt("inputFrames")>20);
            tone();until(()->fixture().optBoolean("played"));
            until(()->fixture().getJSONObject("playbackStats").optInt("outputBytes")>0 && fixture().getJSONObject("playbackStats").optInt("queuedOutputBytes",-1)==0);
            until(()->"true".equals(readJs(scenario,"document.querySelector('[role=log]')?.textContent.includes('安卓本地验证')")));
            device.pressHome();int before=fixture().getInt("inputFrames");Thread.sleep(3500);
            assertTrue("microphone frames continue with Activity backgrounded",fixture().getInt("inputFrames")>before+20);
            device.sleep();before=fixture().getInt("inputFrames");Thread.sleep(3500);
            assertTrue("microphone frames continue with screen off",fixture().getInt("inputFrames")>before+20);device.wakeUp();
            context.startService(new Intent(context,CallService.class).setAction("mute"));
            until(()->{AtomicReference<Boolean> muted=new AtomicReference<>(false);scenario.onActivity(a->muted.set(a.session.muted));return muted.get();});
            device.openNotification();until(()->device.hasObject(By.text("结束通话")));
            device.findObject(By.text("结束通话")).click();until(()->!fixture().getBoolean("connected"));
            until(()->state(scenario).equals("idle"));
            until(()->context.getSystemService(AudioManager.class).getActiveRecordingConfigurations().isEmpty());
            device.pressBack();context.startActivity(context.getPackageManager().getLaunchIntentForPackage(context.getPackageName()));
            until(()->device.hasObject(By.res("start")));device.findObject(By.res("start")).click();until(()->state(scenario).equals("connected"));
            Thread.sleep(6000);assertEquals("previous hangup watchdog must not end a redial","connected",state(scenario));
            js(scenario,"document.getElementById('stop').click()");until(()->state(scenario).equals("idle"));until(()->!fixture().getBoolean("connected"));
            js(scenario,"var f=document.createElement('iframe');f.srcdoc='<script>VVoiceHost.postMessage(JSON.stringify({type:\"state\",state:\"connected\"}))<\\/script>';document.body.append(f)");
            Thread.sleep(500);assertEquals("subframes cannot start native ownership","idle",state(scenario));
            assertEquals(originalSessions+2,fixture().getInt("sessionRequests"));
        }
    }
}

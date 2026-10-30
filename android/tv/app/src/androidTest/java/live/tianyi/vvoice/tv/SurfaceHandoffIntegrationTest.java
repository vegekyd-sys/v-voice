package live.tianyi.vvoice.tv;

import android.content.Intent;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.webkit.WebView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.lang.reflect.Field;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** The actual WebView must not own keyboard focus before its page can focus a control. */
@RunWith(AndroidJUnit4.class)
public class SurfaceHandoffIntegrationTest {
    private Object field(Object owner,String name)throws Exception {
        Field f=CallService.class.getDeclaredField(name);f.setAccessible(true);return f.get(owner);
    }
    @Test public void companionKeepsHostFocusAndEnterStillHangsUp()throws Exception {
        var instrumentation=InstrumentationRegistry.getInstrumentation();var context=instrumentation.getTargetContext();
        assertNull(field(null,"current"));
        try {
            context.startActivity(new Intent("live.tianyi.vvoice.tv.action.START_CALL")
                .setClassName(context.getPackageName(),"live.tianyi.vvoice.tv.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            long deadline=SystemClock.elapsedRealtime()+20000;boolean checkedLoading=false,connected=false;
            while(SystemClock.elapsedRealtime()<deadline) {
                Object service=field(null,"current");
                if(service!=null) {
                    instrumentation.runOnMainSync(()->{try {
                        WebView web=(WebView)field(service,"web");
                        if(!(boolean)field(service,"surfaceAnnounced"))assertFalse("Loading WebView cannot own focus",web.hasFocus());
                    }catch(Exception e){throw new AssertionError(e);}});
                    if(!(boolean)field(service,"surfaceAnnounced"))checkedLoading=true;
                    if("connected".equals(field(service,"lastCall"))){connected=true;break;}
                }
                Thread.sleep(50);
            }
            assertTrue("observed loading phase",checkedLoading);assertTrue("fixture connected",connected);
            Object service=field(null,"current");WebView web=(WebView)field(service,"web");
            CountDownLatch focused=new CountDownLatch(1);String[] control={null};
            instrumentation.runOnMainSync(()->{assertFalse("Companion keeps native focus on host",web.hasFocus());web.evaluateJavascript("document.activeElement?.getAttribute('data-tv-control')",value->{control[0]=value;focused.countDown();});});
            assertTrue(focused.await(3,TimeUnit.SECONDS));assertEquals("\"end\"",control[0]);
            instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_CENTER);
            deadline=SystemClock.elapsedRealtime()+6000;
            while(field(null,"current")!=null&&SystemClock.elapsedRealtime()<deadline)Thread.sleep(100);
            assertNull("Enter reaches the shared hangup control",field(null,"current"));
        } finally {context.stopService(new Intent(context,CallService.class));}
    }
}

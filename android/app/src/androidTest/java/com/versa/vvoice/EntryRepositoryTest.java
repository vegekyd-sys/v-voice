package com.versa.vvoice;
import android.content.Context;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.JSONObject;
import java.net.URL;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class EntryRepositoryTest {
    @Test public void publicFallbackPreservesBoundEntriesAndRejectsForeignLinks() throws Exception {
        assertEquals("http://127.0.0.1:29849/voice/",BuildConfig.SERVICE_URL);
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        var repo=new EntryRepository(context,new TrustedEndpoint(BuildConfig.SERVICE_URL,true));
        var publicEntry=repo.publicEntry();assertEquals("Public",publicEntry.label);
        String link;
        try(var input=new URL("http://127.0.0.1:29849/fixture/binding").openStream()){
            link=new JSONObject(new String(BoundedInput.read(input,4096),java.nio.charset.StandardCharsets.UTF_8)).getString("bindingUrl");
        }
        var bound=repo.bind(link);assertEquals("http://127.0.0.1:29849/voice/",bound.url);
        assertEquals(1,repo.entries().length());assertEquals(bound.url,repo.initial().url);
        // A consumed handoff still selects the already saved destination.
        assertEquals(bound.url,repo.bind(link).url);
        assertEquals(publicEntry.url,repo.publicEntry().url);assertEquals(1,repo.entries().length());
        assertEquals(bound.url,repo.select("tianyi").url);
        assertThrows(Exception.class,()->repo.bind(link.replace("127.0.0.1","evil.example")));
        assertThrows(Exception.class,()->repo.bind(link+"&bind="+"x".repeat(40)));
        var store=new SecureStore(context,BuildConfig.SERVICE_URL);var root=store.read();root.getJSONObject("entries").getJSONObject("tianyi").put("credential","x".repeat(43)).put("cookie","v_voice_access=invalid");store.write(root);
        var fallback=repo.initial();assertEquals("Public",fallback.label);assertNotNull(fallback.notice);assertEquals(1,repo.entries().length());
        String sealed=context.getSharedPreferences(store.preferencesName,0).getString("sealed","");
        assertFalse(sealed.contains(root.getString("publicKey")));assertFalse(sealed.contains("credential"));
    }
}

package live.tianyi.vvoice.tv;
import org.junit.Test;
import static org.junit.Assert.*;

public class EntryPolicyTest {
    @Test public void stableEntryUsesOnlyItsExactHttpsHostAndPaths(){
        assertTrue(EntryPolicy.trusted("https://openclaw.tianyi.live/voice/?phone=fixture"));
        assertTrue(EntryPolicy.trusted("https://openclaw.tianyi.live:443/tv-voice-candidate/?tv=1"));
        assertTrue(EntryPolicy.trusted("https://openclaw.tianyi.live/voice/%E8%AE%B2%E8%A7%A3"));
        for(String url:new String[]{"https://openclaw.tianyi.live.evil.test/tv-voice-candidate/",
            "http://openclaw.tianyi.live/voice/","https://attacker@openclaw.tianyi.live/voice/",
            "https://openclaw.tianyi.live:444/voice/","https://openclaw.tianyi.live/tv-voice-candidate-other/",
            "https://openclaw.tianyi.live/tv-voice-candidate/../other/","https://openclaw.tianyi.live/tv-voice-candidate/%2e%2e/other/",
            "https://openclaw.tianyi.live/other/","https://example.trycloudflare.com/voice/","file:///entry.json","intent://voice"})
            assertFalse(url,EntryPolicy.trusted(url));
    }
    @Test public void loopbackPolicyMatchesBuild(){
        assertTrue(EntryPolicy.trusted("http://127.0.0.1:26326/?tv=1"));
        assertFalse(EntryPolicy.trusted("http://127.0.0.1:8000/"));
    }
}

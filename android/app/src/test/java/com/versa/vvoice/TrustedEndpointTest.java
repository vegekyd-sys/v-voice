package com.versa.vvoice;
import org.junit.Test;
import static org.junit.Assert.*;
public class TrustedEndpointTest {
    @Test public void originAndPathAreBothRequired() {
        var endpoint=new TrustedEndpoint("https://openclaw.tianyi.live/voice/",false);
        assertTrue(endpoint.page("https://openclaw.tianyi.live/voice/?phone=public"));
        assertFalse(endpoint.page("https://openclaw.tianyi.live.evil.test/voice/"));
        assertFalse(endpoint.page("https://openclaw.tianyi.live:444/voice/"));
        assertFalse(endpoint.page("https://openclaw.tianyi.live/voice/../private"));
        assertFalse(endpoint.page("https://attacker@openclaw.tianyi.live/voice/"));
        assertFalse(endpoint.page("http://openclaw.tianyi.live/voice/"));
        assertFalse(endpoint.page("javascript:alert(1)"));
    }
    @Test public void cleartextIsOnlyAllowedOnDebugLoopback() {
        assertTrue(new TrustedEndpoint("http://127.0.0.1:29849/voice/",true).page("http://127.0.0.1:29849/voice/"));
        for(String url:new String[]{"http://127.0.0.1:29849/voice/","https://example.com/voice/?x=1","https://example.com/"}) {
            assertThrows(IllegalArgumentException.class,()->new TrustedEndpoint(url,false));
        }
        assertThrows(IllegalArgumentException.class,()->new TrustedEndpoint("http://example.com/voice/",true));
    }
}

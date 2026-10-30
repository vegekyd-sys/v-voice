package live.tianyi.vvoice.tv;
import java.net.URI;
final class EntryPolicy  {
    static boolean trusted(String value) {
        try {
            URI u=URI.create(value);
            return u.getUserInfo()==null&&(("https".equals(u.getScheme())&&"openclaw.tianyi.live".equals(u.getHost())&&(u.getPort()==-1||u.getPort()==443)&&u.getPath().startsWith("/voice/"))||("http".equals(u.getScheme())&&"127.0.0.1".equals(u.getHost())&&u.getPort()==26326));
        }
        catch(Exception e) {
            return false;
        }
    }
}

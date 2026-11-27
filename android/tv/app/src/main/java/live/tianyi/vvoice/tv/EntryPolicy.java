package live.tianyi.vvoice.tv;
import java.net.URI;
final class EntryPolicy  {
    private static boolean trustedPath(URI uri) {
        String path=uri.getRawPath(),decoded=uri.getPath();
        return path!=null && path.equals(uri.normalize().getRawPath()) && !decoded.contains("%") && !decoded.contains("\\")
            && !decoded.contains("/../") && !decoded.endsWith("/..")
            && (path.startsWith("/voice/") || path.startsWith("/tv-voice-candidate/"));
    }
    static boolean trusted(String value) {
        try {
            URI u=URI.create(value);
            return u.getUserInfo()==null&&(("https".equals(u.getScheme())&&"openclaw.tianyi.live".equals(u.getHost())&&(u.getPort()==-1||u.getPort()==443)&&trustedPath(u))||("http".equals(u.getScheme())&&"127.0.0.1".equals(u.getHost())&&u.getPort()==26326));
        }
        catch(Exception e) {
            return false;
        }
    }
}

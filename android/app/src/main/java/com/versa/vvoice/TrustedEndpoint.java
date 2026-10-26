package com.versa.vvoice;

import java.net.URI;

/** Only the configured Voice origin can receive capabilities or native access. */
public final class TrustedEndpoint {
    public final URI base;
    public TrustedEndpoint(String url, boolean debug) {
        base = URI.create(url);
        boolean local = debug && "http".equals(base.getScheme()) &&
            ("127.0.0.1".equals(base.getHost()) || "10.0.2.2".equals(base.getHost()));
        if ((!"https".equals(base.getScheme()) && !local) || base.getHost() == null || base.getUserInfo() != null ||
            !"/voice/".equals(base.getPath()) || base.getQuery() != null || base.getFragment() != null)
            throw new IllegalArgumentException("无效的 Voice 服务地址");
    }
    private int port(URI u) { return u.getPort() == -1 ? ("https".equals(u.getScheme()) ? 443 : 80) : u.getPort(); }
    public boolean sameOrigin(String url) {
        try { URI u = URI.create(url); return base.getScheme().equals(u.getScheme()) && base.getHost().equals(u.getHost()) &&
            port(base) == port(u) && u.getUserInfo() == null; } catch (Exception e) { return false; }
    }
    public boolean page(String url) {
        try { String raw=URI.create(url).getRawPath().toLowerCase(java.util.Locale.ROOT);
            return sameOrigin(url) && !raw.contains("%2e") && !raw.contains("%2f") && !raw.contains("%5c") && URI.create(url).normalize().getPath().startsWith(base.getPath()); }
        catch (Exception e) { return false; }
    }
    public String origin() { return base.getScheme() + "://" + base.getRawAuthority(); }
}

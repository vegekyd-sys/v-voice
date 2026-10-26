package com.versa.vvoice;

import android.content.Context;
import android.net.Uri;
import android.util.Base64;
import org.json.JSONObject;
import org.json.JSONArray;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;

/** Uses the existing device grant protocol. No actor/session or shared token is invented locally. */
final class EntryRepository {
    final TrustedEndpoint endpoint;
    private final SecureStore store;
    EntryRepository(Context context, TrustedEndpoint endpoint) { this.endpoint = endpoint; store = new SecureStore(context,endpoint.base.toString()); }
    private static final class HttpFailure extends Exception {
        final int status;
        HttpFailure(int status){super(status==401||status==403?"这个入口已失效，请重新获取绑定链接。":"暂时无法连接 V（"+status+"），请重试。");this.status=status;}
    }
    static final class Authorized {
        final String url, cookie, label;
        String notice;
        Authorized(String url, String cookie, String label) { this.url=url; this.cookie=cookie; this.label=label; }
    }
    private static final class Reply {
        JSONObject value; String cookie;
        Reply(JSONObject value, String cookie) { this.value=value; this.cookie=cookie; }
    }
    private Reply request(String route, String phone, JSONObject body, String cookie) throws Exception {
        String suffix = phone == null || phone.equals("tianyi") ? "" : "?phone=" + Uri.encode(phone);
        HttpURLConnection conn = (HttpURLConnection) endpoint.base.resolve("api/"+route+suffix).toURL().openConnection();
        conn.setInstanceFollowRedirects(false); conn.setConnectTimeout(12000); conn.setReadTimeout(15000);
        conn.setRequestProperty("Origin", endpoint.origin()); conn.setRequestProperty("Accept", "application/json");
        if (cookie != null) conn.setRequestProperty("Cookie", cookie.split(";",2)[0]);
        try {
            if (body != null) {
                conn.setRequestMethod("POST"); conn.setDoOutput(true); conn.setRequestProperty("Content-Type", "application/json");
                try (var output=conn.getOutputStream()) { output.write(body.toString().getBytes(StandardCharsets.UTF_8)); }
            }
            int status=conn.getResponseCode();
            if (status < 200 || status >= 300) throw new HttpFailure(status);
            byte[] bytes; try(var input=conn.getInputStream()) { bytes=BoundedInput.read(input,65536); }
            if(bytes.length>65536) throw new Exception("服务返回异常");
            return new Reply(new JSONObject(new String(bytes, StandardCharsets.UTF_8)), conn.getHeaderField("Set-Cookie"));
        } finally { conn.disconnect(); }
    }
    synchronized JSONArray entries() throws Exception {
        JSONObject items=store.read().optJSONObject("entries"); JSONArray out=new JSONArray();
        if(items!=null) for(var keys=items.keys();keys.hasNext();) { String id=keys.next(); JSONObject item=items.getJSONObject(id);
            if(!item.optBoolean("public"))out.put(new JSONObject().put("id",id).put("label",item.optString("label","已连接会话"))); }
        return out;
    }
    synchronized Authorized initial() throws Exception {
        JSONObject root=store.read(); String selected=root.optString("selected", "");
        JSONObject items=root.optJSONObject("entries");
        if (!selected.isEmpty() && items!=null && items.has(selected)) {
            try{return authorize(items.getJSONObject(selected), root);}
            catch(Exception e){
                var fallback=publicEntry();
                if(!items.getJSONObject(selected).optBoolean("public"))fallback.notice="原入口暂不可用，已回到 Public。可在「入口」中重新连接。";
                return fallback;
            }
        }
        return publicEntry();
    }
    synchronized Authorized publicEntry() throws Exception {
        JSONObject root=store.read(); String key=root.optString("publicKey","");
        if(key.isEmpty()) { byte[] bytes=new byte[32]; new SecureRandom().nextBytes(bytes);
            key=Base64.encodeToString(bytes,Base64.URL_SAFE|Base64.NO_PADDING|Base64.NO_WRAP); root.put("publicKey",key); store.write(root); }
        JSONObject reply=request("ios-public", null, new JSONObject().put("deviceKey",key), null).value;
        String phone=reply.getString("phone");
        if(!phone.matches("ios-[a-f0-9]{40}") || !key.equals(reply.getString("deviceAccess"))) throw new Exception("Public 授权返回异常");
        JSONObject items=root.optJSONObject("entries"),entry=items!=null?items.optJSONObject(phone):null;
        if(entry==null)entry=new JSONObject();
        return authorize(entry.put("phone",phone).put("credential",key).put("device",true).put("public",true).put("label","Public"),root);
    }
    synchronized Authorized select(String phone) throws Exception {
        JSONObject root=store.read(); return authorize(root.getJSONObject("entries").getJSONObject(phone),root);
    }
    synchronized Authorized bind(String link) throws Exception {
        Uri uri=Uri.parse(link.trim());
        if(!endpoint.page(link) || !endpoint.base.getPath().equals(uri.getPath()) || link.length()>12000) throw new Exception("请粘贴此 Voice 服务生成的绑定链接。");
        String phone=uri.getQueryParameter("phone");
        if(phone==null)phone="tianyi";
        if(!phone.matches("[a-z0-9][a-z0-9_-]{0,63}") || uri.getQueryParameters("phone").size()>1)throw new Exception("无效的入口");
        Uri fragment=Uri.parse("https://fragment.invalid/?"+uri.getEncodedFragment());
        String token=fragment.getQueryParameter("bind"), access=fragment.getQueryParameter("access");
        if((token==null)==(access==null) || fragment.getQueryParameterNames().size()!=1 || fragment.getQueryParameters(token!=null?"bind":"access").size()!=1)throw new Exception("链接缺少唯一的绑定凭证");
        String credential=token!=null?token:access;
        if(credential.length()<32 || credential.length()>4096)throw new Exception("无效的绑定凭证");
        JSONObject root=store.read(), items=root.optJSONObject("entries");
        if(token!=null && items!=null && items.has(phone)) {
            try { return authorize(items.getJSONObject(phone),root); } catch(Exception ignored) { /* Fresh grant can replace a revoked one. */ }
        }
        if(token!=null)credential=request("ios-binding/redeem",phone,new JSONObject().put("token",token),null).value.getString("deviceAccess");
        return authorize(new JSONObject().put("phone",phone).put("credential",credential).put("device",token!=null),root);
    }
    private Authorized authorize(JSONObject entry, JSONObject root) throws Exception {
        String phone=entry.getString("phone"); boolean device=entry.optBoolean("device");
        String cookie=entry.optString("cookie", ""),name=phone.equals("tianyi")?"v_voice_access":"v_voice_"+phone;
        JSONObject status=null;
        if(!cookie.isEmpty()) {
            try {status=request("status",phone,null,cookie).value;}
            catch(HttpFailure e){if(e.status!=401&&e.status!=403)throw e;}
        }
        if(status==null){
            cookie=request(device?"ios-binding/access":"access",phone,new JSONObject().put(device?"deviceAccess":"access",entry.getString("credential")),null).cookie;
        }
        if(cookie==null || !cookie.startsWith(name+"=") || cookie.length()>8192 || cookie.indexOf('\n')>=0 || cookie.indexOf('\r')>=0)throw new Exception("入口授权无效");
        if(status==null)status=request("status",phone,null,cookie).value;
        if(!status.optBoolean("ready"))throw new Exception("V 暂未就绪，请稍后重试。");
        if(entry.optBoolean("public") && !status.optBoolean("unidentified"))throw new Exception("Public 身份不匹配");
        JSONObject conversation=status.optJSONObject("conversation");
        String label=entry.optBoolean("public")?"Public":conversation==null?"固定入口":conversation.optString("name","已连接会话");
        // Scope a fresh cookie locally; never accept a response's arbitrary Domain.
        String safeCookie=cookie.split(";",2)[0]+"; Path=/voice/; HttpOnly; SameSite=Strict"+(endpoint.base.getScheme().equals("https")?"; Secure":"");
        entry.put("label",label).put("cookie",safeCookie); JSONObject items=root.optJSONObject("entries");if(items==null)items=new JSONObject();
        items.put(phone,entry);root.put("entries",items).put("selected",phone);store.write(root);
        return new Authorized(endpoint.base+(phone.equals("tianyi")?"":"?phone="+Uri.encode(phone)),safeCookie,label);
    }
}

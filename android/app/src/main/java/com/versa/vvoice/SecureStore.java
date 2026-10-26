package com.versa.vvoice;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONObject;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Credentials are encrypted by an app-private Android Keystore key; backups are disabled. */
final class SecureStore {
    private final Context context;
    final String preferencesName;
    SecureStore(Context context,String serviceURL) {
        this.context = context;
        try {preferencesName="voice-v1-"+Base64.encodeToString(java.security.MessageDigest.getInstance("SHA-256").digest(serviceURL.getBytes(java.nio.charset.StandardCharsets.UTF_8)),Base64.URL_SAFE|Base64.NO_WRAP|Base64.NO_PADDING);}
        catch(Exception e){throw new IllegalStateException(e);}
    }
    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (!store.containsAlias("voice-bindings")) {
            KeyGenerator generator = KeyGenerator.getInstance("AES", "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder("voice-bindings", KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            generator.generateKey();
        }
        return (SecretKey) store.getKey("voice-bindings", null);
    }
    synchronized JSONObject read() throws Exception {
        String raw = context.getSharedPreferences(preferencesName, 0).getString("sealed", null);
        if (raw == null) return new JSONObject();
        JSONObject sealed = new JSONObject(raw);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(sealed.getString("iv"), Base64.NO_WRAP)));
        c.updateAAD(preferencesName.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        return new JSONObject(new String(c.doFinal(Base64.decode(sealed.getString("data"), Base64.NO_WRAP)), java.nio.charset.StandardCharsets.UTF_8));
    }
    synchronized void write(JSONObject value) throws Exception {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.ENCRYPT_MODE, key());
        c.updateAAD(preferencesName.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        JSONObject sealed = new JSONObject().put("iv", Base64.encodeToString(c.getIV(), Base64.NO_WRAP))
            .put("data", Base64.encodeToString(c.doFinal(value.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8)), Base64.NO_WRAP));
        if (!context.getSharedPreferences(preferencesName, 0).edit().putString("sealed", sealed.toString()).commit()) throw new Exception("入口保存失败");
    }
}

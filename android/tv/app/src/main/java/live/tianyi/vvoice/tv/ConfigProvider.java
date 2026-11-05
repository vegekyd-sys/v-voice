package live.tianyi.vvoice.tv;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import java.io.File;
import java.io.FileNotFoundException;

/** Shell-only provisioning and bounded diagnostics. No URL/token read API. */
public final class ConfigProvider extends ContentProvider {
    @Override public boolean onCreate() { return true; }
    @Override public String getType(Uri uri) { return "application/json"; }
    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"/config".equals(uri.getPath()) || !"w".equals(mode)) throw new FileNotFoundException();
        return ParcelFileDescriptor.open(new File(getContext().getFilesDir(), "entry.json"),
            ParcelFileDescriptor.MODE_WRITE_ONLY | ParcelFileDescriptor.MODE_CREATE | ParcelFileDescriptor.MODE_TRUNCATE);
    }
    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String order) {
        if (!"/status".equals(uri.getPath())) throw new IllegalArgumentException("Unknown diagnostics");
        var prefs = getContext().getSharedPreferences("diagnostics", 0);
        MatrixCursor cursor = new MatrixCursor(new String[]{
            "configured", "window_mode", "web_instance", "call_state", "generation", "foreground", "muted", "focus", "reading", "has_document", "meter_source", "meter_peak", "viewport_width", "viewport_height", "model", "mic_driver", "mic_channels", "output_muted", "failure_code", "interactive", "host_kind"
        });
        cursor.addRow(new Object[]{new File(getContext().getFilesDir(), "entry.json").isFile() ? 1 : 0,
            prefs.getString("window_mode", ""), prefs.getString("web_instance", ""),
            prefs.getString("projected_call", "idle"), prefs.getLong("generation", 0),
            prefs.getBoolean("foreground", false) ? 1 : 0,prefs.getBoolean("muted",false)?1:0,prefs.getString("focus",""),prefs.getBoolean("reading",false)?1:0,
            prefs.getBoolean("has_document",false)?1:0,prefs.getString("meter_source","none"),prefs.getInt("meter_peak",0),prefs.getInt("viewport_width",0),prefs.getInt("viewport_height",0),prefs.getString("model",""),prefs.getString("mic_driver","none"),prefs.getInt("mic_channels",0),prefs.getBoolean("output_muted",false)?1:0,prefs.getString("failure_code",""),prefs.getBoolean("interactive",false)?1:0,"foreground-service"});
        return cursor;
    }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String selection, String[] args) { throw new UnsupportedOperationException(); }
}

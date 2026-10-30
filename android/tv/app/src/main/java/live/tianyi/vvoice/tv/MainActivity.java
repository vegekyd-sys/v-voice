package live.tianyi.vvoice.tv;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;

/** User-visible permission/launch entry. The foreground service owns the one call. */
public final class MainActivity extends Activity {
    private boolean overlayRequested,launchedCall;
    @Override public void onCreate(Bundle state){super.onCreate(state);CallService.entryStarted();getWindow().setBackgroundDrawableResource(android.R.color.transparent);getWindow().getDecorView().setSystemUiVisibility(5894);launch();}
    private void launch(){
        if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},7);return;}
        if(!Settings.canDrawOverlays(this)){
            if(overlayRequested){finish();return;}
            overlayRequested=true;
            new AlertDialog.Builder(this).setMessage("允许 V 显示在其他应用上方，通话时即可继续使用电视。")
                .setPositiveButton("前往设置",(d,w)->startActivityForResult(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,Uri.parse("package:"+getPackageName())),8))
                .setNegativeButton("返回",(d,w)->finish()).setOnCancelListener(d->finish()).show();return;
        }
        startForegroundService(new Intent(this,CallService.class).setAction(getIntent().getAction()));
        launchedCall=true;
        finish();overridePendingTransition(0,0);
    }
    @Override protected void onDestroy(){
        if(!launchedCall&&!isChangingConfigurations()){
            sendBroadcast(new Intent("live.tianyi.vvoice.tv.STARTUP_CUE_END").setPackage("live.tianyi.familytv.dev"));
            sendBroadcast(new Intent("live.tianyi.vvoice.tv.SURFACE_READY").setPackage("live.tianyi.familytv.dev").putExtra("active",false));
        }
        super.onDestroy();CallService.entryFinished();
    }
    @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);launch();}
    @Override protected void onActivityResult(int q,int r,Intent data){super.onActivityResult(q,r,data);if(q==8)launch();}
    @Override public void onRequestPermissionsResult(int q,String[] p,int[] r){super.onRequestPermissionsResult(q,p,r);if(q==7){if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED)launch();else finish();}}
}

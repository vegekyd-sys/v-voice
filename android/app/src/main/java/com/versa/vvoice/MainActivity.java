package com.versa.vvoice;

import android.Manifest;
import android.app.*;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import org.json.JSONArray;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    VoiceSession session;
    boolean isVisible, busy;
    private static final int BACKGROUND=Color.rgb(246,243,249), INK=Color.rgb(42,32,48), SOFT=Color.rgb(110,91,124), FAINT=Color.rgb(142,128,157);
    private TextView status;
    private LinearLayout notice;
    private boolean pageObscured, backPending;
    private Dialog settingsDialog;
    private android.window.OnBackInvokedCallback backCallback;
    private Button manage, retry;
    private PermissionRequest pendingMicrophone;
    private long permissionRevision;
    private GeolocationPermissions.Callback pendingLocation;
    private String locationOrigin;
    private String pendingBinding;
    private String pendingDocument;
    private final java.util.concurrent.ExecutorService network=Executors.newSingleThreadExecutor();
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().setDecorFitsSystemWindows(false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);getWindow().setNavigationBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarContrastEnforced(false);
        FrameLayout layout=new FrameLayout(this);layout.setBackgroundColor(BACKGROUND);
        layout.setOnApplyWindowInsetsListener((view,insets)->{var bars=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout()|WindowInsets.Type.ime());view.setPadding(bars.left,bars.top,bars.right,bars.bottom);return WindowInsets.CONSUMED;});
        setContentView(layout);
        getWindow().getInsetsController().setSystemBarsAppearance(WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS|WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS|WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
        notice=new LinearLayout(this);notice.setOrientation(LinearLayout.VERTICAL);notice.setGravity(Gravity.CENTER);notice.setPadding(dp(28),dp(28),dp(28),dp(28));notice.setBackgroundColor(BACKGROUND);notice.setClickable(true);
        status=text("正在准备 Public…",16,SOFT);status.setGravity(Gravity.CENTER);status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);notice.addView(status);
        retry=button("重新连接");retry.setVisibility(View.GONE);notice.addView(retry);
        manage=button("设置");manage.setTextSize(12);manage.setTextColor(FAINT);manage.setContentDescription("通话设置");manage.setMinWidth(0);manage.setMinimumWidth(0);manage.setPadding(0,0,0,0);
        FrameLayout.LayoutParams settingsPosition=new FrameLayout.LayoutParams(dp(56),dp(48),Gravity.TOP|Gravity.END);settingsPosition.topMargin=dp(8);settingsPosition.setMarginEnd(dp(12));
        try {session=VoiceSession.get(this);}catch(Exception e){layout.addView(notice,new FrameLayout.LayoutParams(-1,-1));status.setText(e.getMessage());return;}
        session.activity=this;
        if(session.web.getParent() instanceof ViewGroup parent)parent.removeView(session.web);
        layout.addView(session.web,new FrameLayout.LayoutParams(-1,-1));layout.addView(notice,new FrameLayout.LayoutParams(-1,-1));layout.addView(manage,settingsPosition);
        manage.setOnClickListener(v->showEntries());retry.setOnClickListener(v->runEntry(()->session.entries.initial()));
        if(Build.VERSION.SDK_INT>=33){backCallback=this::handleBack;getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,backCallback);}
        if(!session.loaded)runEntry(()->session.entries.initial());else loaded();
        handleDeepLink(getIntent());
    }
    @Override protected void onResume(){super.onResume();isVisible=true;if(session!=null){session.activity=this;session.web.onResume();refresh();if(pendingMicrophone!=null && checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED)finishMicrophone();}}
    @Override protected void onPause(){isVisible=false;super.onPause();}
    @Override protected void onDestroy(){
        if(pendingMicrophone!=null)pendingMicrophone.deny();
        if(pendingLocation!=null)pendingLocation.invoke(locationOrigin,false,false);
        if(session!=null && session.activity==this){session.activity=null;if(!session.active() && !session.rendererGone)session.web.onPause();}
        if(settingsDialog!=null)settingsDialog.dismiss();
        if(Build.VERSION.SDK_INT>=33 && backCallback!=null)getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backCallback);
        network.shutdown();super.onDestroy();
    }
    @Override public void onBackPressed(){handleBack();}
    private void handleBack(){
        var insets=getWindow().getDecorView().getRootWindowInsets();
        if(insets!=null && insets.isVisible(WindowInsets.Type.ime())){getWindow().getInsetsController().hide(WindowInsets.Type.ime());return;}
        if(backPending)return;
        if(session==null || !session.endpoint.page(session.web.getUrl())){finish();return;}
        backPending=true;
        session.web.evaluateJavascript("window.__vVoiceAndroidBack?.() === true",handled->{
            backPending=false;if(isDestroyed() || "true".equals(handled))return;
            if(session.active()){moveTaskToBack(true);return;}
            if(session.web.canGoBack()){session.web.goBack();return;}finish();
        });
    }
    @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);handleDeepLink(intent);}
    private void handleDeepLink(Intent intent){
        Uri uri=intent.getData();if(uri==null)return;
        if("vvoice".equals(uri.getScheme()) && "settings".equals(uri.getHost()) && "/bind".equals(uri.getPath()) && uri.getQuery()==null) {
            String value=Uri.parse("https://fragment.invalid/?"+uri.getEncodedFragment()).getQueryParameter("url");
            if(value!=null && value.length()<12000){if(busy)pendingBinding=value;else showBinding(value);}
        }
    }
    interface EntryWork {EntryRepository.Authorized run() throws Exception;}
    private void runEntry(EntryWork work){
        if(busy || session.active())return;busy=true;refresh();status.setText("正在连接入口…");notice.setVisibility(View.VISIBLE);retry.setVisibility(View.GONE);
        network.execute(()->{try {var entry=work.run();runOnUiThread(()->{busy=false;if(isDestroyed())return;if(entry!=null)session.authorized(entry);else loaded();refresh();});}
            catch(Exception e){runOnUiThread(()->{busy=false;if(!isDestroyed()){error(e.getMessage());refresh();}});}});
    }
    void refresh(){
        if(session==null)return;
        manage.setEnabled(!busy);manage.setVisibility(pageObscured?View.GONE:View.VISIBLE);
        manage.setText(session.active()?"":"设置");
        int inset=session.active()?dp(19):0;manage.setPadding(inset,0,inset,0);
        manage.setCompoundDrawablesWithIntrinsicBounds(session.active()?R.drawable.ic_settings:0,0,0,0);
    }
    void presentation(boolean obscured){pageObscured=obscured;refresh();}
    void loaded(){notice.setVisibility(View.GONE);retry.setVisibility(View.GONE);refresh();if(pendingBinding!=null && !busy){String value=pendingBinding;pendingBinding=null;showBinding(value);}}
    void error(String message){
        if(session!=null && session.active()){
            new AlertDialog.Builder(this).setMessage(message).setPositiveButton("继续通话",null)
                .setNegativeButton("结束通话",(d,w)->session.control("hangup")).show();return;
        }
        status.setText(message);notice.setVisibility(View.VISIBLE);retry.setVisibility(View.VISIBLE);
    }
    private int dp(float value){return Math.round(value*getResources().getDisplayMetrics().density);}
    private TextView text(String value,int size,int color){TextView v=new TextView(this);v.setText(value);v.setTextSize(size);v.setTextColor(color);return v;}
    private Button button(String label){Button v=new Button(this,null,android.R.attr.borderlessButtonStyle);v.setText(label);v.setAllCaps(false);v.setTextColor(SOFT);return v;}
    private android.graphics.drawable.GradientDrawable panel(int color,float radius){var d=new android.graphics.drawable.GradientDrawable();d.setColor(color);d.setCornerRadius(dp(radius));return d;}
    private void closeSettings(){if(settingsDialog!=null)settingsDialog.dismiss();}
    private void showEntries(){
        if(busy || session==null)return;
        try {
            JSONArray entries=session.entries.entries();boolean locked=session.active();
            Dialog dialog=new Dialog(this);settingsDialog=dialog;dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
            LinearLayout content=new LinearLayout(this);content.setOrientation(LinearLayout.VERTICAL);content.setPadding(dp(24),dp(12),dp(24),dp(24));content.setBackground(panel(BACKGROUND,24));
            LinearLayout header=new LinearLayout(this);header.setGravity(Gravity.CENTER_VERTICAL);
            TextView title=text("设置",16,INK);title.setGravity(Gravity.CENTER_VERTICAL);header.addView(title,new LinearLayout.LayoutParams(0,dp(48),1));Button done=button("完成");done.setOnClickListener(v->dialog.dismiss());header.addView(done);content.addView(header);
            TextView heading=text("通话入口",27,INK);heading.setPadding(0,dp(14),0,dp(8));content.addView(heading);
            TextView subtitle=text("选一个入口，和 V 继续聊。",14,SOFT);subtitle.setPadding(0,0,0,dp(24));content.addView(subtitle);
            LinearLayout list=new LinearLayout(this);list.setOrientation(LinearLayout.VERTICAL);list.setBackground(panel(Color.WHITE,23));
            addEntryRow(list,"Public","与 V 直接聊，无需绑定",session.entries.publicSelected(),locked,()->{dialog.dismiss();runEntry(()->session.entries.publicEntry());},null);
            for(int i=0;i<entries.length();i++){
                var entry=entries.getJSONObject(i);String id=entry.getString("id"),label=entry.getString("label");
                addEntryRow(list,label,"已保存的会话",entry.optBoolean("selected"),locked,()->{dialog.dismiss();runEntry(()->session.entries.select(id));},()->confirmRemove(id,label));
            }
            Button add=button("＋  添加入口");add.setGravity(Gravity.START|Gravity.CENTER_VERTICAL);add.setPadding(dp(20),0,dp(20),0);add.setEnabled(!locked);add.setOnClickListener(v->{dialog.dismiss();showBinding("");});list.addView(add,new LinearLayout.LayoutParams(-1,dp(60)));content.addView(list);
            TextView hint=text(locked?"通话结束后可以切换或管理入口。":"通知栏的通话控制跟随当前入口。",12,FAINT);hint.setPadding(dp(4),dp(12),dp(4),dp(24));content.addView(hint);
            LinearLayout permissions=new LinearLayout(this);permissions.setOrientation(LinearLayout.VERTICAL);permissions.setPadding(dp(18),dp(16),dp(18),dp(16));permissions.setBackground(panel(Color.WHITE,21));
            permissions.addView(text("声音与通话",16,INK));
            boolean mic=checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED;
            TextView permission=text("麦克风 · "+(mic?"已允许":"未允许"),14,SOFT);permission.setPadding(0,dp(14),0,dp(6));permissions.addView(permission);
            if(!mic){Button open=button("前往系统设置允许麦克风");open.setOnClickListener(v->startActivity(new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+getPackageName()))));permissions.addView(open);}
            boolean notifications=getSystemService(NotificationManager.class).areNotificationsEnabled();
            TextView notification=text("通话通知 · "+(notifications?"已允许":"未允许"),14,SOFT);notification.setPadding(0,dp(8),0,dp(6));permissions.addView(notification);
            if(!notifications){Button open=button("开启通话通知");open.setOnClickListener(v->startActivity(new Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE,getPackageName())));permissions.addView(open);}
            TextView privacy=text("声音在通话首页选择。仅通话时使用麦克风，结束后停止收音。入口授权加密保存在本机。",12,FAINT);privacy.setPadding(0,dp(12),0,0);permissions.addView(privacy);content.addView(permissions);
            TextView version=text("V Voice · "+BuildConfig.VERSION_NAME,11,FAINT);version.setGravity(Gravity.CENTER);version.setPadding(0,dp(22),0,0);content.addView(version);
            ScrollView scroll=new ScrollView(this);scroll.setFillViewport(true);scroll.addView(content);dialog.setContentView(scroll);dialog.show();
            Window window=dialog.getWindow();window.setBackgroundDrawableResource(android.R.color.transparent);window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);window.setDimAmount(.16f);window.setGravity(Gravity.BOTTOM);
            int width=Math.min(getResources().getDisplayMetrics().widthPixels,dp(560));int height=(int)(getResources().getDisplayMetrics().heightPixels*.88);
            window.setLayout(width,height);
        }catch(Exception e){error("无法读取已保存入口，请重新打开应用。");}
    }
    private void addEntryRow(LinearLayout list,String name,String detail,boolean selected,boolean locked,Runnable choose,Runnable remove){
        LinearLayout row=new LinearLayout(this);row.setGravity(Gravity.CENTER_VERTICAL);row.setPadding(dp(18),dp(8),dp(8),dp(8));
        LinearLayout copy=new LinearLayout(this);copy.setOrientation(LinearLayout.VERTICAL);copy.setPadding(0,dp(12),dp(8),dp(12));copy.setMinimumHeight(dp(64));
        copy.addView(text(name,15,INK));TextView sub=text(detail,12,FAINT);sub.setPadding(0,dp(5),0,0);copy.addView(sub);copy.setContentDescription(name+(selected?"，当前入口":"，切换到这个入口"));copy.setClickable(true);copy.setEnabled(!locked);copy.setOnClickListener(v->{if(!session.active())choose.run();});copy.setAlpha(locked?.55f:1f);row.addView(copy,new LinearLayout.LayoutParams(0,-2,1));
        if(selected){TextView check=text("✓",18,SOFT);check.setGravity(Gravity.CENTER);check.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);row.addView(check,new LinearLayout.LayoutParams(dp(32),dp(48)));}
        if(remove!=null){Button trash=button("移除");trash.setTextSize(12);trash.setMinWidth(0);trash.setMinimumWidth(0);trash.setPadding(0,0,0,0);trash.setContentDescription("移除「"+name+"」的本机绑定");trash.setEnabled(!locked);trash.setOnClickListener(v->{if(!session.active())remove.run();});row.addView(trash,new LinearLayout.LayoutParams(dp(48),dp(48)));}
        list.addView(row);View divider=new View(this);divider.setBackgroundColor(Color.rgb(238,231,244));LinearLayout.LayoutParams line=new LinearLayout.LayoutParams(-1,dp(1));line.setMargins(dp(18),0,dp(18),0);list.addView(divider,line);
    }
    private void confirmRemove(String id,String label){
        if(session.active())return;
        new AlertDialog.Builder(this).setTitle("移除「"+label+"」？").setMessage("仅移除本机绑定，不删除远端会话或历史。移除当前入口后回到 Public。")
            .setNegativeButton("取消",null).setPositiveButton("从本机移除",(d,w)->{closeSettings();runEntry(()->session.entries.remove(id));}).show();
    }
    private void showBinding(String value){
        if(session==null || session.active()){if(session!=null)error("请先结束通话，再切换入口。");return;}
        EditText field=new EditText(this);field.setPadding(dp(20),dp(16),dp(20),dp(16));field.setHint("粘贴飞书或网页生成的绑定链接");field.setSingleLine(false);field.setMaxLines(5);field.setText(value);
        field.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD);
        new AlertDialog.Builder(this).setTitle("添加通话入口").setMessage("绑定后会保存此入口，Public 仍可随时使用。").setView(field)
            .setNegativeButton("取消",null).setPositiveButton("绑定",(d,w)->runEntry(()->session.entries.bind(field.getText().toString()))).show();
    }
    void microphone(PermissionRequest request,long revision){
        if(pendingMicrophone!=null)pendingMicrophone.deny();pendingMicrophone=request;permissionRevision=revision;
        if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED){finishMicrophone();return;}
        requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},100);
    }
    void cancelPermission(PermissionRequest request){if(request==pendingMicrophone)pendingMicrophone=null;}
    private void finishMicrophone(){
        if(!isVisible && checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED)return;
        PermissionRequest request=pendingMicrophone;pendingMicrophone=null;if(request==null)return;
        if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED && session.permissionStillValid(permissionRevision) && session.ensureForeground()) {
            request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            if(Build.VERSION.SDK_INT>=33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},102);
        }else request.deny();
    }
    void location(String origin,GeolocationPermissions.Callback callback){
        if(pendingLocation!=null)pendingLocation.invoke(locationOrigin,false,false);
        pendingLocation=callback;locationOrigin=origin;
        if(checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED){finishLocation();return;}
        requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION},101);
    }
    private void finishLocation(){
        if(pendingLocation!=null){pendingLocation.invoke(locationOrigin,isVisible && session.endpoint.page(session.web.getUrl()) && checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED,false);pendingLocation=null;}
    }
    @Override public void onRequestPermissionsResult(int code,String[] permissions,int[] results){super.onRequestPermissionsResult(code,permissions,results);if(code==100)finishMicrophone();if(code==101)finishLocation();}
    void openExternal(Uri uri){
        if(!java.util.Set.of("https","http").contains(uri.getScheme()))return;
        try{startActivity(new Intent(Intent.ACTION_VIEW,uri));}catch(Exception e){error("找不到可以打开链接的应用。");}
    }
    void connectAccount(Uri uri){
        if(session.active())return;
        new AlertDialog.Builder(this).setTitle("连接飞书账号")
            .setMessage("在浏览器完成登录，从会话页面获取 App 绑定链接，再返回这里粘贴。已保存入口可随时切回 Public。")
            .setNegativeButton("粘贴已有链接",(d,w)->showBinding(""))
            .setPositiveButton("打开登录页面",(d,w)->openExternal(uri)).show();
    }
    void saveDocument(String title,String text){
        if(pendingDocument!=null)return;pendingDocument=text;
        String safe=title.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]","_").trim();if(safe.isEmpty())safe="V 的方案";
        try {startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
            .setType("text/markdown").putExtra(Intent.EXTRA_TITLE,safe+".md"),200);}
        catch(Exception e){pendingDocument=null;error("暂时无法保存文档。");}
    }
    @Override protected void onActivityResult(int request,int result,Intent data){
        super.onActivityResult(request,result,data);
        if(request!=200)return;String text=pendingDocument;pendingDocument=null;
        if(result!=RESULT_OK || data==null || data.getData()==null || text==null)return;
        Uri destination=data.getData();network.execute(()->{
            try(var output=getContentResolver().openOutputStream(destination)){
                if(output==null)throw new java.io.IOException("No destination");output.write(text.getBytes(java.nio.charset.StandardCharsets.UTF_8));
                runOnUiThread(()->Toast.makeText(this,"文档已保存",Toast.LENGTH_SHORT).show());
            }catch(Exception e){runOnUiThread(()->error("保存失败，请重试。"));}
        });
    }
}

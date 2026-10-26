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
    private TextView title, status;
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
        LinearLayout layout=new LinearLayout(this);layout.setOrientation(LinearLayout.VERTICAL);layout.setBackgroundColor(Color.rgb(247,244,251));
        layout.setOnApplyWindowInsetsListener((view,insets)->{var bars=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.ime());view.setPadding(bars.left,bars.top,bars.right,bars.bottom);return insets;});
        setContentView(layout);
        LinearLayout bar=new LinearLayout(this);bar.setGravity(Gravity.CENTER_VERTICAL);bar.setPadding(24,4,12,4);
        title=new TextView(this);title.setText("V Voice · Public");title.setTextSize(15);title.setTextColor(Color.rgb(84,66,109));bar.addView(title,new LinearLayout.LayoutParams(0,48,1));
        manage=new Button(this,null,android.R.attr.borderlessButtonStyle);manage.setText("入口");manage.setTextColor(Color.rgb(84,66,109));manage.setContentDescription("管理通话入口");bar.addView(manage);layout.addView(bar);
        status=new TextView(this);status.setPadding(28,20,28,20);status.setText("正在准备 Public…");layout.addView(status);
        retry=new Button(this);retry.setText("重新连接");retry.setVisibility(View.GONE);layout.addView(retry);
        try {session=VoiceSession.get(this);}catch(Exception e){status.setText(e.getMessage());manage.setEnabled(false);return;}
        session.activity=this;
        if(session.web.getParent() instanceof ViewGroup parent)parent.removeView(session.web);
        layout.addView(session.web,new LinearLayout.LayoutParams(-1,0,1));
        manage.setOnClickListener(v->showEntries());retry.setOnClickListener(v->runEntry(()->session.entries.initial()));
        if(!session.loaded)runEntry(()->session.entries.initial());else loaded();
        handleDeepLink(getIntent());
    }
    @Override protected void onResume(){super.onResume();isVisible=true;if(session!=null){session.activity=this;session.web.onResume();refresh();if(pendingMicrophone!=null && checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED)finishMicrophone();}}
    @Override protected void onPause(){isVisible=false;super.onPause();}
    @Override protected void onDestroy(){
        if(pendingMicrophone!=null)pendingMicrophone.deny();
        if(pendingLocation!=null)pendingLocation.invoke(locationOrigin,false,false);
        if(session!=null && session.activity==this){session.activity=null;if(!session.active() && !session.rendererGone)session.web.onPause();}
        network.shutdown();super.onDestroy();
    }
    @Override public void onBackPressed(){
        if(session!=null && session.active()){moveTaskToBack(true);return;}
        if(session!=null && session.web.canGoBack()){session.web.goBack();return;}super.onBackPressed();
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
        if(busy || session.active())return;busy=true;refresh();status.setText("正在连接入口…");status.setVisibility(View.VISIBLE);retry.setVisibility(View.GONE);
        network.execute(()->{try {var entry=work.run();runOnUiThread(()->{busy=false;if(isDestroyed())return;session.authorized(entry);refresh();});}
            catch(Exception e){runOnUiThread(()->{busy=false;if(!isDestroyed()){error(e.getMessage());refresh();}});}});
    }
    void refresh(){if(session==null)return;title.setText("V Voice · "+session.label);manage.setEnabled(!busy&&!session.active());}
    void loaded(){status.setVisibility(View.GONE);retry.setVisibility(View.GONE);refresh();if(pendingBinding!=null && !busy){String value=pendingBinding;pendingBinding=null;showBinding(value);}}
    void error(String message){status.setText(message);status.setVisibility(View.VISIBLE);retry.setVisibility(View.VISIBLE);}
    private void showEntries(){
        if(session.active())return;
        try {JSONArray entries=session.entries.entries();java.util.ArrayList<String> labels=new java.util.ArrayList<>();labels.add("Public · 直接试用");
            for(int i=0;i<entries.length();i++)labels.add(entries.getJSONObject(i).getString("label"));labels.add("粘贴绑定链接");
            new AlertDialog.Builder(this).setTitle("通话入口").setItems(labels.toArray(new String[0]),(dialog,index)->{
                if(index==0)runEntry(()->session.entries.publicEntry());
                else if(index==labels.size()-1)showBinding("");
                else runEntry(()->session.entries.select(entries.getJSONObject(index-1).getString("id")));
            }).setNegativeButton("返回",null).show();
        }catch(Exception e){error("无法读取已保存入口，请重新打开应用。");}
    }
    private void showBinding(String value){
        if(session==null || session.active()){if(session!=null)error("请先结束通话，再切换入口。");return;}
        EditText field=new EditText(this);field.setHint("粘贴飞书或网页生成的绑定链接");field.setSingleLine(false);field.setText(value);
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

import sys,time,json,urllib.request
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent));import local
local.guard();local.install();local.adb('shell','appops','set',local.PACKAGE,'SYSTEM_ALERT_WINDOW','allow')
r=Path(__file__).resolve().parents[1]/'evidence/tv-companion-20261029'
r.mkdir(parents=True,exist_ok=True)
def scenario(mode):urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:26326/__fixture/scenario?mode='+mode,data=b'',method='POST')).read()
def status():return dict(p.split('=',1) for p in local.status().split('Row: 0 ',1)[1].strip().split(', '))
def wait(test,seconds=20):
 end=time.monotonic()+seconds
 while time.monotonic()<end:
  s=status()
  if test(s):return s
  time.sleep(.3)
 raise AssertionError(s)
try:
 scenario('fail-session');local.adb('shell','am','start','-a','live.tianyi.vvoice.tv.action.START_CALL','-n',local.COMPONENT)
 s=wait(lambda s:s['call_state']=='idle' and s['generation']=='1' and s['failure_code'] not in ('','null'));print('FAILURE_VISIBLE',s)
 scenario('normal');local.adb('shell','input','keyevent','23');s=wait(lambda s:s['call_state']=='connected');instance=s['web_instance'];time.sleep(14)
 s=status();assert s['call_state']=='connected' and s['web_instance']==instance
 local.adb('shell','input','keyevent','4');wait(lambda s:s['window_mode']=='compact');local.adb('shell','input','keyevent','223');s=wait(lambda s:s['foreground']=='0')
 assert 'ServiceRecord{' not in local.adb('shell','dumpsys','activity','services',local.PACKAGE+'/live.tianyi.vvoice.tv.CallService')
 (r/'local-retry-screenoff.json').write_text(json.dumps({'checks':['session failure remains visible','H5 retry uses same WebView','old idle timer cannot stop resumed call after 14s','screen off releases service and overlay'],'finalStatus':s},indent=2))
 print('RETRY_AND_SCREEN_OFF_PASSED')
finally:
 scenario('normal');local.adb('shell','input','keyevent','224');local.adb('shell','input','keyevent','3')

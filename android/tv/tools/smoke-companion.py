import sys,time,json,subprocess,re,xml.etree.ElementTree as ET
from pathlib import Path
root=Path(__file__).resolve().parents[2];sys.path.insert(0,str(root/'v-voice-tv-island/tools'));import local
local.guard();r=root/'v-voice-tv-island/evidence/tv-companion-20261029';r.mkdir(exist_ok=True)
checks=[]
portraitPoint=None
def status():
 raw=local.status();return dict(part.strip().split('=',1) for part in raw.split('Row: 0 ',1)[1].strip().split(', '))
def wait(k,v,seconds=15):
 until=time.monotonic()+seconds
 while time.monotonic()<until:
  s=status()
  if s.get(k)==v:return s
  time.sleep(.2)
 raise AssertionError((k,v,s))
def launch():
 global portraitPoint
 local.adb('shell','am','start','-a','android.intent.action.MAIN','-c','android.intent.category.HOME','-n','live.tianyi.familytv.dev/com.gathin.tvhome.MainActivity');time.sleep(1)
 local.adb('shell','uiautomator','dump','/sdcard/v-companion-home.xml')
 tree=ET.fromstring(local.adb('shell','cat','/sdcard/v-companion-home.xml'))
 n=next((n for n in tree.iter('node') if n.get('resource-id')=='live.tianyi.familytv.dev:id/btnVIsland'),None)
 if n is not None:
  x1,y1,x2,y2=map(int,re.findall(r'\d+',n.get('bounds')));portraitPoint=((x1+x2)//2,(y1+y2)//2)
 assert portraitPoint is not None
 local.adb('shell','input','tap',str(portraitPoint[0]),str(portraitPoint[1]))
def key(k):local.adb('shell','input','keyevent',str(k))
def shot(name):(r/(name+'.png')).write_bytes(local.adb('exec-out','screencap','-p',binary=True))
local.adb('shell','am','force-stop',local.PACKAGE)
local.adb('shell','am','start','-n','live.tianyi.familytv.dev/com.gathin.tvhome.MainActivity');time.sleep(.5)
record=subprocess.Popen([str(local.ADB),'-s',local.SERIAL,'shell','screenrecord','--time-limit','30','/sdcard/companion-motion.mp4'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
launch();s=wait('call_state','connected');instance=s['web_instance'];generation=s['generation'];checks.append('local fixture connected')
time.sleep(1);shot('local-expanded');key(4);wait('window_mode','compact');time.sleep(.7);shot('local-compact')
key(22);key(23);time.sleep(1)
s=status();assert s['web_instance']==instance and s['generation']==generation and s['call_state']=='connected';checks.append('third-party fixture opens with same live owner and generation');shot('local-other-app')
key(4);launch();wait('window_mode','medium');time.sleep(.6);key(23);wait('foreground','0');checks.append('hangup releases foreground service');shot('local-ended')
record.wait(timeout=35);local.adb('pull','/sdcard/companion-motion.mp4',str(r/'local-motion.mp4'))
launch();s=wait('call_state','connected');instance=s['web_instance'];key(3);wait('window_mode','compact');assert status()['web_instance']==instance;checks.append('system HOME collapses without disconnect')
# Exercise real settings Activity while the same WebView remains attached.
local.adb('shell','am','start','-a','android.settings.SETTINGS');time.sleep(1);assert status()['call_state']=='connected';checks.append('Android Settings preserves call')
key(3);time.sleep(1);launch();wait('window_mode','medium');time.sleep(1);key(23);wait('foreground','0')
checks.append('second call hangs up and removes overlay')
assert '(nothing)' in local.adb('shell','dumpsys','activity','services',local.PACKAGE)
(r/'local-checks.json').write_text(json.dumps({'checks':checks,'finalStatus':status(),'scope':'FamilyTV_UI only; synthetic fixture audio, no model or real TV'},indent=2,ensure_ascii=False));print(json.dumps(checks,ensure_ascii=False))

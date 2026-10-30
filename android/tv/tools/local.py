"""Only this lab APK on the named Android emulator; no network TV fallback."""
from pathlib import Path
import subprocess,json,time,xml.etree.ElementTree as ET,re
ROOT=Path(__file__).resolve().parents[1]
ADB=Path('/opt/homebrew/share/android-commandlinetools/platform-tools/adb')
SERIAL='emulator-5580';PACKAGE='live.tianyi.vvoice.tv.lab';COMPONENT=PACKAGE+'/live.tianyi.vvoice.tv.MainActivity'
def adb(*args,binary=False,stdin=None):
 return subprocess.run([str(ADB),'-s',SERIAL,*args],input=stdin,check=True,capture_output=True,text=not binary,timeout=45).stdout
def guard():
 if adb('shell','getprop','ro.kernel.qemu').strip()!='1' or adb('emu','avd','name').splitlines()[0].strip()!='FamilyTV_UI':raise RuntimeError('Only FamilyTV_UI emulator-5580 allowed')
def install():
 guard();adb('install','-r',str(ROOT/'app/build/outputs/apk/release/app-release.apk'));adb('reverse','tcp:26326','tcp:26326');adb('shell','pm','grant',PACKAGE,'android.permission.RECORD_AUDIO')
def nodes():
 guard();adb('shell','uiautomator','dump','/sdcard/v-island-local.xml');return list(ET.fromstring(adb('shell','cat','/sdcard/v-island-local.xml')).iter('node'))
def click(text):
 n=next(n for n in nodes() if n.get('text')==text and n.get('clickable')=='true' and n.get('enabled')=='true')
 x1,y1,x2,y2=map(int,re.findall(r'\d+',n.get('bounds')));adb('shell','input','tap',str((x1+x2)//2),str((y1+y2)//2))
def status():return adb('shell','content','query','--uri','content://'+PACKAGE+'.config/status')
def wait_for(expected,seconds=10):
 until=time.monotonic()+seconds
 while time.monotonic()<until:
  value=status()
  if expected in value:return value
  time.sleep(.2)
 raise AssertionError(expected+' not observed; '+value)
def shot(name):
 (ROOT/'evidence'/name).write_bytes(adb('exec-out','screencap','-p',binary=True))
if __name__=='__main__':install();print('Installed only on named local emulator')

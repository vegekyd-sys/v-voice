"""Selected Reaction dock on the named emulator; only loopback fixture calls."""
from local import *
import datetime
OUT=ROOT/'evidence/firstpaint-20261027';OUT.mkdir(exist_ok=True)
checks=[]
def passed(name):checks.append({'case':name,'passed':True})
def screenshot(name): (OUT/name).write_bytes(adb('exec-out','screencap','-p',binary=True))
def key(code,expected=None):
 adb('shell','input','keyevent',str(code))
 if expected:return wait_for(expected)
def field(value,name):return re.search(r'(?:^|, )'+name+r'=([^,\n]+)',value).group(1)
def same_call():
 s=status();assert field(s,'web_instance')==instance;assert field(s,'generation')==generation;assert 'call_state=connected' in s

guard()
if 'call_state=connected' in status():raise RuntimeError('Finish the current local call before this test')
adb('shell','am','force-stop',PACKAGE)
adb('shell','am','start','-a','android.intent.action.MAIN','-c','android.intent.category.HOME','-n','live.tianyi.familytv.dev/com.gathin.tvhome.MainActivity')
time.sleep(.8);screenshot('dock-idle.png')
key(19);time.sleep(.4);screenshot('dock-focus.png')
key(23,'call_state=connected');wait_for('focus=end');connected=status()
assert field(connected,'model')=='seeduplex'
instance=field(connected,'web_instance');generation=field(connected,'generation')
passed('one_home_confirm_dials_Doubao_without_a_second_dialog')
wait_for('meter_source=output');time.sleep(2);screenshot('dock-connected.png');passed('orbital_waveform_uses_actual_fixture_playback')
adb('shell','am','start','-a','live.tianyi.vvoice.tv.action.START_CALL','-n',COMPONENT);time.sleep(.4);same_call();passed('repeated_entry_keeps_same_webview_and_call')
key(21,'focus=speaker');key(23,'output_muted=1');assert 'muted=0,' in status();screenshot('dock-muted.png');same_call();passed('remote_speaker_mute_keeps_microphone_on')
key(23,'output_muted=0');passed('remote_speaker_unmute')
key(19,'focus=expand');key(23,'window_mode=full');wait_for('focus=return');same_call();time.sleep(.5);screenshot('dock-full.png');passed('portrait_expands_same_webpage_and_call')
key(4,'window_mode=medium');wait_for('focus=end');same_call();passed('back_returns_to_connected_dock')
key(4,'window_mode=compact');wait_for('focus=compact');same_call();screenshot('dock-compact-call.png');passed('compact_keeps_call_alive')
key(23,'window_mode=medium');wait_for('focus=end');same_call();passed('compact_expand_never_redials_active_call')
key(23,'call_state=idle');wait_for('window_mode=compact');wait_for('focus=compact');screenshot('dock-ended.png');passed('hangup_restores_small_portrait_and_does_not_redial')
key(23,'call_state=connected');wait_for('window_mode=medium');assert field(status(),'web_instance')==instance;assert int(field(status(),'generation'))==int(generation)+1;passed('idle_small_portrait_directly_dials_next_call')
key(3,'foreground=0');assert 'call_state=idle' in status();assert 'mic_driver=none' in status();passed('home_ends_call_and_releases_capture')
(OUT/'dock-checks.json').write_text(json.dumps({'time':datetime.datetime.now().astimezone().isoformat(),'environment':'FamilyTV_UI / emulator-5580','onlyLocalFixture':True,'realTvChanged':False,'realIdentityCall':False,'checks':checks},ensure_ascii=False,indent=2)+'\n')
print(json.dumps(checks,ensure_ascii=False))

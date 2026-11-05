"""Local fixture report through remote text input, shared Voice and the actual reader."""
import time,json,re,sys
from pathlib import Path
from local import guard,adb,wait_for,status,nodes,PACKAGE,COMPONENT

def key(k,s):
 adb('shell','input','keyevent',str(k));return wait_for(s)
guard()
if 'call_state=connected' in status():raise RuntimeError('Finish the current call before report smoke')
adb('shell','am','force-stop',PACKAGE);adb('shell','am','start','-n',COMPONENT)
wait_for('focus=dial');key(23,'call_state=connected');original=status();key(19,'focus=expand');key(23,'window_mode=full');wait_for('focus=return');Path('/tmp/v-voice-tv-redesign/09-conversation-viewport.png').write_bytes(adb('exec-out','screencap','-p',binary=True));key(20,'focus=compose');key(23,'focus=input')
# Let Android show its IME; Space commits the composing candidate before Back.
time.sleep(1);adb('shell','input','text','report12345' if '--long' in sys.argv else 'tvreport');adb('shell','input','keyevent','62');time.sleep(.3);adb('shell','input','keyevent','4');time.sleep(.5)
key(22,'focus=send');key(23,'has_document=1');wait_for('reading=1');wait_for('window_mode=full');wait_for('focus=reader-body')
# Files open on the body; arrows scroll without moving focus to controls.
if '--long' in sys.argv:
 Path('/tmp/v-voice-tv-redesign/12-body-top.png').write_bytes(adb('exec-out','screencap','-p',binary=True))
 key(20,'focus=reader-body');time.sleep(.5)
 Path('/tmp/v-voice-tv-redesign/13-body-down.png').write_bytes(adb('exec-out','screencap','-p',binary=True))
 for attempt in range(3):
  if any('准备喜欢的故事' in n.get('text','') for n in nodes()):break
 else:raise AssertionError('Long fixture section must actually be rendered')
 key(19,'focus=reader-body');time.sleep(.5)
 Path('/tmp/v-voice-tv-redesign/14-body-up.png').write_bytes(adb('exec-out','screencap','-p',binary=True))
# Right enters original bottom controls; Up returns directly to the text.
key(22,'focus=compose');key(22,'focus=mute');key(23,'muted=1');key(23,'muted=0');key(22,'focus=end');key(19,'focus=reader-body')
Path('/tmp/v-voice-tv-redesign/07-report.png').write_bytes(adb('exec-out','screencap','-p',binary=True))
key(4,'reading=0');key(4,'window_mode=medium');wait_for('focus=end');key(4,'window_mode=compact');wait_for('focus=compact');key(23,'reading=1');wait_for('window_mode=full')
final=status();assert 'call_state=connected' in final
for field in ('web_instance','generation'):
 assert re.search(field+r'=([^,]+)',original).group(1)==re.search(field+r'=([^,]+)',final).group(1)
Path('/tmp/v-voice-tv-redesign/report.json').write_text(json.dumps({'onlyLocalFixture':True,'remote_text_send':True,'report_reader':True,'body_focus_on_open':True,'long_document_scrolled_down_and_up':'--long' in sys.argv,'horizontal_mute_and_hangup_navigation':True,'back_closes_reader_first':True,'compact_document_opens_same_call_reader':True})+'\n')
if '--keep-open' in sys.argv:
 key(22,'focus=compose');key(22,'focus=mute');key(23,'muted=1');key(19,'focus=reader-body')
else:
 key(3,'foreground=0');time.sleep(.3);assert 'call_state=idle' in status()
print('Report path passed')

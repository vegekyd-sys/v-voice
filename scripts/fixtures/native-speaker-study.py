from pathlib import Path
import subprocess,json,random,hashlib,sys
if len(sys.argv) not in [2,3]:raise SystemExit("Usage: native-speaker-study.py OUTPUT_DIRECTORY [--numeric|--female-only]")
mode=sys.argv[2] if len(sys.argv)==3 else "names"
if mode not in ["names","--numeric","--female-only"]:raise SystemExit("Unsupported study mode")
numeric=mode!="names"
p=Path(sys.argv[1]).resolve();p.mkdir(parents=True,exist_ok=True)
voices={'ting':'Tingting','eddy':'Eddy (中文（中国大陆）)','sandy':'Sandy (中文（中国大陆）)','mei':'Meijia (中文（台湾）)'}
names={'a':'一号','b':'二号'} if numeric else {'a':'小林','b':'小周'};colors={'a':'紫色','b':'绿色'}
def audio(voice,text,gain=1):
 key=hashlib.sha256((voice+text+str(gain)).encode()).hexdigest()[:16]
 file=key+'.pcm'
 if not (p/file).exists():
  subprocess.run(['say','-v',voices[voice],'-r','185','-o',str(p/(key+'.aiff')),text],check=True)
  subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-i',str(p/(key+'.aiff')),'-ar','16000','-ac','1','-af','volume='+str(gain),'-f','s16le',str(p/file)],check=True)
 return file
sessions=[]
config=[('numeric-wide',['eddy','ting'],False),('numeric-same-gender',['sandy','ting'],False)] if numeric else [('wide',['ting','eddy'],False),('wide-labels-reversed',['eddy','ting'],False),('same-gender',['ting','sandy'],False),('same-voice-text-control',['ting','ting'],True)]
if mode=='--female-only':config=[('numeric-two-female-voices',['mei','ting'],False)]
for index,(id,pair,control) in enumerate(config):
 turns=[]
 def add(kind,person,text,expected=None,gain=1,voice=None):
  v=voice or pair[0 if person=='a' else 1]
  other=[x for x in (list(names.values()) if kind=='identity' else list(colors.values()) if kind=='preference' else []) if x!=expected]
  turns.append({'id':str(len(turns)+1),'kind':kind,'voice':v,'file':audio(v,text,gain),'text':text,'expected':expected,'otherAnswers':other})
 for person in ['a','b']:
  add('enrollment',person,f'我是{names[person]}。请记住我的声音和名字，我喜欢{colors[person]}。只回答记住了。')
 order=list('aabbab');random.Random(20261022+index).shuffle(order)
 for i,person in enumerate(order):add('identity',person,'现在说话的是谁？只说名字。',names[person],.55 if i==4 else 1)
 for person in ['b','a']:add('preference',person,'我喜欢什么颜色？只说颜色。',colors[person])
 if not control:add('unseen','a','现在说话的是谁？只说名字。','未登记',voice='sandy' if 'mei' in pair else 'mei')
 sessions.append({'id':id,'voices':pair,'control':control,'turns':turns})
study={'synthetic':True,'sampleRate':16000,'instructions':'这是多人声音识别实验。不同的人会先用语音介绍自己的名字和喜欢的颜色。请根据实际听到的声音区分不同人，记住每种声音对应的名字与颜色。之后有人问现在说话的是谁，只回答当前说话人的名字；问喜欢的颜色，只回答该人的颜色。不得根据提问顺序或轮流规律猜人，不得默认沿用上一位说话人。确实没有听过的声音回答未登记，无法确定时回答不确定。每次只回答所问的一项，不解释。实验不需要工具。','sessions':sessions}
(p/'study.json').write_text(json.dumps(study,ensure_ascii=False,indent=2));print(json.dumps({'sessions':len(sessions),'turns':sum(len(s['turns']) for s in sessions),'assets':len(list(p.glob('*.pcm')))},ensure_ascii=False))

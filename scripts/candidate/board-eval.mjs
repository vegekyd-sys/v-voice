// Runs the board director against a real text model on fixed conversations and
// prints what it drew and how fast. No voice call, Gateway or page is involved;
// the only cost is a few short text completions per model.
//
//   VOICE_BOARD=1 node scripts/candidate/board-eval.mjs [model ...]
//
// Uses the same credentials as the service (DEEPSEEK_API_KEY, else
// OPENROUTER_API_KEY). Conversations here are invented, not call records.
import {boardCompletionFromEnv, createBoardDirector} from '../../lab/gpt-live-h5/board-director.mjs';

const steps = {id: 's', t: 'steps', items: [{id: 'a', h: '拨号', d: '要通话名额，开麦克风'}, {id: 'b', h: '建立连接', d: '声音转给语音模型'}, {id: 'c', h: '直接说话', d: '随时可以打断'}]};
const calendar = JSON.stringify({ok: true, events: [{summary: '产品周会', start: '10:00', end: '11:00', location: '3F 会议室'}, {summary: '和馨仪过夜班方案', start: '14:30', end: '15:00'}, {summary: '牙医', start: '18:15', end: '19:00', location: '静安'}]});
// expect: what a good director does; checked by eye and by the rough rule below.
const CASES = [
  {name: '闲聊', expect: 'none', trigger: 'assistant_end', turns: [['user', '你好呀，在干嘛'], ['assistant', '嗨，我在呢，刚整理完今天的记忆。你呢？']]},
  {name: '一句话事实', expect: 'none', trigger: 'assistant_end', turns: [['user', '现在几点了'], ['assistant', '现在是下午三点二十。']]},
  {name: '提问可预判结构', expect: 'draw', trigger: 'user', turns: [['user', '给我讲讲 HTTPS 握手是怎么回事']]},
  {name: '提问拿不准', expect: 'none', trigger: 'user', turns: [['user', '夜班那边现在什么情况']]},
  {name: 'V 讲到一半', expect: 'draw', trigger: 'assistant_progress', turns: [['user', '电话是怎么接通的'], ['assistant', '好，电话接通分三步。第一步是拨号，页面向语音服务要一个通话名额，同时打开麦克风。第二步是建立连接，服务把你的声音转给语音模型。']]},
  {name: '跟随焦点', expect: 'focus', trigger: 'assistant_progress', scene: ['电话怎么接通', steps], turns: [['user', '电话是怎么接通的'], ['assistant', '好，电话接通分三步。第一步是拨号，页面向语音服务要一个通话名额，同时打开麦克风。第二步是建立连接，服务把你的声音转给语音模型，模型的声音再传回来。']]},
  {name: '指代已有条目', expect: 'edit', trigger: 'assistant_end', scene: ['电话怎么接通', steps], turns: [['user', '电话是怎么接通的'], ['assistant', '分三步：拨号、建立连接、直接说话。'], ['user', '第二步展开讲讲'], ['assistant', '建立连接其实有两段。先是页面和语音服务之间开一条 WebSocket，然后服务再连上语音模型。两段都通了才算接通，一般一秒左右。']]},
  {name: '日程证据', expect: 'draw', trigger: 'evidence', evidence: [['feishu_calendar', calendar]], turns: [['user', '我今天有什么安排'], ['assistant', '我看一下。']]},
  {name: '取舍比较', expect: 'draw', trigger: 'assistant_end', turns: [['user', '画面这块用实时视频还是讲解画面好'], ['assistant', '我建议先做讲解画面。实时视频画面最有感染力，但首帧要等十几秒，还按秒计费，也承载不了准确的数字。讲解画面一秒内就能出来，信息准确，成本也低。实时视频可以留给陪伴的场景。']]},
  {name: '数字汇报', expect: 'draw', trigger: 'assistant_end', turns: [['user', '夜班现在怎么样'], ['assistant', '夜班一切正常。在产十二张卡，今晚已经交付三十一条，有两条在等你确认。并发上限十五，现在用了八个。']]},
  {name: '换话题', expect: 'scene', trigger: 'assistant_end', scene: ['电话怎么接通', steps], turns: [['user', '好，懂了。那说说 V 的记忆是怎么分层的'], ['assistant', 'V 的记忆分三层。最上面是每次对话都带着的索引，中间是按主题分开的记忆文件，最下面是原始的对话记录，需要时再检索。']]},
  {name: '不许编造', expect: 'none', trigger: 'assistant_end', turns: [['user', '我下周的行程帮我排一下'], ['assistant', '好，我先查一下你下周的日程，稍等。']]},
];

const models = process.argv.slice(2);
const brief = op => op.op === 'put' ? `put ${op.block.t}#${op.block.id}(${(op.block.items ?? op.block.cols ?? op.block.nodes ?? op.block.rows ?? [op.block.text]).length})` : op.op === 'scene' ? `scene「${op.title}」` : op.op === 'focus' ? `focus ${op.id || '∅'}` : op.op;
const verdict = (expect, ops) => {
  const kinds = ops.map(op => op.op);
  if (expect === 'none') return kinds.length === 0;
  if (expect === 'draw') return kinds.includes('put');
  if (expect === 'focus') return kinds.includes('focus') && !kinds.includes('scene');
  if (expect === 'edit') return (kinds.includes('put') || kinds.includes('focus')) && !kinds.includes('scene');
  if (expect === 'scene') return kinds[0] === 'scene' && kinds.includes('put');
  return false;
};
for (const model of models.length ? models : [undefined]) {
  const rows = [];
  for (const item of CASES) {
    // A fresh director per case. A case that starts with a picture already up
    // gets it through one scripted first run; every later run is the model.
    const model_ = boardCompletionFromEnv({...process.env, VOICE_BOARD: '1', ...(model ? {VOICE_BOARD_MODEL: model} : {})});
    if (!model_) throw Error('No board model credential in this environment');
    let seeding = Boolean(item.scene);
    const director = createBoardDirector({complete: request => seeding
      ? (async function* () { yield JSON.stringify({op: 'scene', title: item.scene[0]}) + '\n' + JSON.stringify({op: 'put', block: item.scene[1]}) + '\n'; })()
      : model_(request)});
    const owner = 'eval-' + item.name;
    if (seeding) { await director.run({owner, trigger: 'user', turns: [{role: 'user', text: item.turns[0][1]}]}); seeding = false; }
    for (const [name, text] of item.evidence ?? []) director.observe({type: 'tool.delivered', voiceSessionId: owner, name, result: text});
    const ops = [];
    const result = await director.run({owner, trigger: item.trigger, clientRev: director.scene(owner).rev,
      turns: item.turns.map(([role, text]) => ({role, text})), onOp: op => ops.push(op)});
    rows.push({name: item.name, expect: item.expect, ok: verdict(item.expect, ops), reason: result.reason, firstOpMs: result.firstOpMs, durationMs: result.durationMs, ops: ops.map(brief), scene: director.scene(owner)});
  }
  console.log(`\n=== ${model ?? 'default model'} · ${rows.filter(row => row.ok).length}/${rows.length} as expected`);
  for (const row of rows) {
    console.log(`${row.ok ? 'ok ' : 'XX '} ${row.name} [want ${row.expect}] ${row.reason} first=${row.firstOpMs ?? '-'}ms total=${row.durationMs}ms :: ${row.ops.join(' · ') || '—'}`);
    if (process.env.BOARD_EVAL_VERBOSE === '1' && row.ops.length) console.log('    ' + JSON.stringify({title: row.scene.title, focus: row.scene.focus, blocks: row.scene.blocks}));
  }
  const first = rows.map(row => row.firstOpMs).filter(Number.isFinite).sort((a, b) => a - b);
  if (first.length) console.log(`first operation: median ${first[first.length >> 1]}ms, slowest ${first.at(-1)}ms over ${first.length} drawing runs`);
}

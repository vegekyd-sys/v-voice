export const CLI_SCHEMA = 'v-voice-cli/v1';
export class VoiceCliError extends Error {
  constructor(code, message, next, exitCode = 2) { super(message); Object.assign(this, {code, next, exitCode}); }
}
export const COMMANDS = {
  capabilities: {description:'Discover commands, arguments and authority without connecting.', args:{}},
  status: {description:'Service readiness, models, call counts and CLI identity.', args:{}},
  'entries.list': {description:'List only CLI-managed entries; never enumerate personal bindings.', args:{}},
  'entries.create': {description:'Create an isolated guest conversation or a Feishu login destination. Lazy: no call, model or Feishu session is created.', args:{id:'required:string',kind:'required:guest|feishu',account:'string',chat:'string','request-id':'required:string'}},
  'entries.get': {description:'Read entry, binding and effective scope.', args:{id:'required:string'}},
  'entries.bind': {description:'Bind an unused Feishu destination to a configured account/chat. Does not authorize an actor.', args:{id:'required:string',account:'required:string',chat:'required:string','request-id':'required:string'}},
  'entries.disable': {description:'Disable own entry, invalidate its links and end its own active calls.', args:{id:'required:string','request-id':'required:string'}},
  'links.create': {description:'Issue a guest conversation capability or a Feishu login invitation. Write the URL to a new private --out file.', args:{entry:'required:string',ttl:'required:integer',out:'required:local-path','request-id':'required:string'}},
  'links.list': {description:'Read link states without bearer tokens.', args:{entry:'required:string'}},
  'links.get': {description:'Read one link, expiry, revocation and exact access scope.', args:{id:'required:string'}},
  'links.export': {description:'Recover the same link after a lost response; --out must be a new private file.', args:{id:'required:string',out:'required:local-path'}},
  'links.revoke': {description:'Revoke own link; invalidates guest cookies and ends its active calls. Feishu invitations revoke only invitation use.', args:{id:'required:string','request-id':'required:string'}},
  'auth.check': {description:'Check server-side link validity and authority. Does not perform a call or impersonate a Feishu actor.', args:{id:'required:string'}},
  'sessions.status': {description:'Read only CLI-managed conversation activity and lazy binding; no chat history.', args:{entry:'required:string'}},
  doctor: {description:'Read service and CLI configuration diagnostics without credentials.', args:{}},
};
const SUMMARIES = {
  capabilities:'查询完整命令、参数、权限范围和退出码（JSON，离线可用）',
  status:'查看服务就绪状态、模型、通话计数和管理身份',
  'entries.list':'列出 CLI 管理的对话入口',
  'entries.create':'新建独立访客对话或飞书登录邀请入口，不拨号',
  'entries.get':'查看入口绑定及有效权限范围',
  'entries.bind':'为尚未发出链接的飞书入口绑定账号和会话',
  'entries.disable':'停用入口，使其链接失效并结束对应活动通话',
  'links.create':'生成有期限的授权/邀请链接，保存到私有文件',
  'links.list':'列出入口的链接及有效、过期、撤销状态',
  'links.get':'查看链接期限、状态和权限范围',
  'links.export':'将原链接重新保存到新的私有文件',
  'links.revoke':'撤销链接并清理对应活动通话',
  'auth.check':'检查链接当前有效性及实际授权范围',
  'sessions.status':'查看入口对应会话绑定和活动状态，不读取聊天正文',
  doctor:'检查服务连接、配置和管理身份',
};
const ARG_HELP = {
  id:['ID','入口 ID 或链接 ID；按当前命令指定'],
  entry:['入口ID','CLI 管理的对话入口 ID'],
  kind:['guest|feishu','guest：独立访客；feishu：收件人自行登录的飞书邀请'],
  account:['账号ID','服务已配置的飞书账号 ID；用 doctor 查询'],
  chat:['oc_会话ID','精确的飞书群/DM 会话 ID，收件人仍需通过成员准入'],
  ttl:['秒','有效期，60–86400 秒'],
  out:['新文件','链接输出文件；父目录须由当前用户持有且为 0700，文件须不存在'],
  'request-id':['请求ID','8–128 位字母/数字/_/-；重试同一操作时复用，避免重复创建'],
};
const EXAMPLES = {
  capabilities:['v-voice capabilities'],status:['v-voice status'],doctor:['v-voice doctor'],
  'entries.list':['v-voice entries list'],
  'entries.create':['v-voice entries create --id demo-room --kind guest --request-id entry-demo-001','v-voice entries create --id team-room --kind feishu --account default --chat oc_example --request-id entry-team-001'],
  'entries.get':['v-voice entries get --id demo-room'],
  'entries.bind':['v-voice entries bind --id team-room --account default --chat oc_example --request-id bind-team-001'],
  'entries.disable':['v-voice entries disable --id demo-room --request-id disable-demo-001'],
  'links.create':['mkdir -m 700 ./private-links','v-voice links create --entry demo-room --ttl 600 --out ./private-links/demo.url --request-id link-demo-001'],
  'links.list':['v-voice links list --entry demo-room'],
  'links.get':['v-voice links get --id LINK_ID'],
  'links.export':['v-voice links export --id LINK_ID --out ./private-links/recovered.url'],
  'links.revoke':['v-voice links revoke --id LINK_ID --request-id revoke-demo-001'],
  'auth.check':['v-voice auth check --id LINK_ID'],
  'sessions.status':['v-voice sessions status --entry demo-room'],
};
export const commandGroup = name => ['entries','links','auth','sessions'].includes(name);
export function helpResult(target='capabilities') {
  if(commandGroup(target))return {group:target,commands:Object.fromEntries(Object.entries(COMMANDS).filter(([name])=>name.startsWith(target+'.'))),globalArgs:capabilities().globalArgs};
  return target==='capabilities'?capabilities():{command:target,...COMMANDS[target],globalArgs:capabilities().globalArgs};
}
export function renderHelp(target='capabilities') {
  const root=target==='capabilities',group=commandGroup(target),lines=[];
  const name=target.replaceAll('.',' ');
  lines.push(`V Voice CLI ${capabilities().version}`, '');
  if(root||group){
    lines.push(`用法：v-voice ${group?target+' <子命令>':'<命令>'} [参数] [全局选项]`, '', '命令：');
    for(const command of Object.keys(COMMANDS).filter(key=>root||key.startsWith(target+'.')))
      lines.push(`  ${command.replaceAll('.',' ').padEnd(20)} ${SUMMARIES[command]}`);
  }else{
    const spec=COMMANDS[target];
    lines.push(SUMMARIES[target], '', `用法：v-voice ${name}${Object.entries(spec.args).map(([key,type])=>{
      const option=`--${key} <${ARG_HELP[key][0]}>`;return ' '+(type.startsWith('required:')?option:`[${option}]`);
    }).join('')} [全局选项]`);
    if(Object.keys(spec.args).length){
      lines.push('', '参数：');
      for(const [key,type] of Object.entries(spec.args))lines.push(`  ${('--'+key+' <'+ARG_HELP[key][0]+'>').padEnd(27)} ${type.startsWith('required:')?'必填':'可选'}；${ARG_HELP[key][1]}`);
    }
    if(target==='entries.create')lines.push('', 'guest 使用独立上下文；feishu 必须同时指定 --account 和 --chat。入口 ID 为 8–64 位小写字母/数字/_/-，首位为字母或数字。');
    if(target==='entries.bind')lines.push('', '仅允许绑定未签发过链接的飞书入口，不能借此改变已发邀请的会话。');
    if(target.startsWith('links.')||target==='auth.check')lines.push('', 'guest 链接授予独立访客上下文；feishu 链接仅为登录邀请，不携带任何人的账号身份。撤销飞书邀请不会撤回已独立建立的账号/设备授权。');
    lines.push('', '示例：', ...EXAMPLES[target].map(example=>'  '+example));
  }
  lines.push('', '全局选项：',
    '  --socket <绝对路径>   Voice 私有 Unix socket；也可设置 V_VOICE_SOCKET',
    '  --json               操作结果始终为 JSON；与 --help 同用时返回 JSON 帮助',
    '  -h, --help           显示当前命令或分组帮助，无需连接服务',
    '  -v, --version        显示版本，无需连接服务');
  if(root||group)lines.push('', '示例：',
    `  v-voice ${group?target+' '+Object.keys(COMMANDS).find(k=>k.startsWith(target+'.')).split('.')[1]:'entries create'} --help`,
    '  v-voice --help --json',
    '  v-voice capabilities');
  lines.push('', '退出码：0 成功；2 输入错误；3 连接不可用；4 不存在；5 权限拒绝；6 冲突/容量；7 服务/存储不可用；8 结果待确认。',
    '有副作用的命令需 --request-id；连接或输出失败后先回读，再使用原请求 ID 重试。',
    '完整文档：安装包 README.md 或仓库 docs/voice-cli.md。');
  return lines.join('\n')+'\n';
}
export function capabilities() {
  return {schema:CLI_SCHEMA, version:'0.1.0', transport:'private-unix-socket', node:'>=22', commands:COMMANDS,
    globalArgs:{socket:'absolute Unix socket; or V_VOICE_SOCKET',json:'operations always return JSON; combine with --help for JSON help',help:'offline text help; combine with --json for structured help',version:'offline version'},
    exitCodes:{0:'success',2:'invalid input',3:'transport unavailable',4:'not found',5:'authority or access denied',6:'conflict or capacity',7:'service/storage unavailable',8:'outcome unknown; read back before retry'},
    authority:{management:'OS identity with access to the 0600 socket in an owned 0700 directory',guest:'isolated context; existing Public capabilities only; no personal account tools or source-chat history',feishu:'invitation only; recipient must complete existing identity confirmation and Gateway membership/tool admission',scopeEscalation:false},
    limits:{entries:256,links:1024,requestJournal:4096,ttlSeconds:{min:60,max:86400}},
    sideEffects:'Never dials, invokes a paid model, sends messages, edits existing human/device bindings, changes Gateway policy or deploys.'};
}
export function validateCommand(command, args, {wire=false}={}) {
  const spec=Object.hasOwn(COMMANDS,command)?COMMANDS[command]:null;
  if(!spec)throw new VoiceCliError('UNKNOWN_COMMAND','Unknown command.','Run v-voice capabilities.');
  if(!args||typeof args!=='object'||Array.isArray(args))throw new VoiceCliError('INVALID_ARGUMENT','Arguments must be an object.','Read command capabilities.');
  for(const key of Object.keys(args))if(!(key in spec.args)||wire&&key==='out')throw new VoiceCliError('INVALID_ARGUMENT',`Unsupported argument: ${key}.`,'Read command capabilities.');
  for(const [key,type] of Object.entries(spec.args)){
    if(wire&&key==='out')continue;
    if(type.startsWith('required:')&&args[key]===undefined)throw new VoiceCliError('INVALID_ARGUMENT',`Missing --${key}.`,'Read command capabilities.');
    if(args[key]!==undefined&&(typeof args[key]!=='string'||!args[key]||args[key].length>512||/[\u0000-\u001f\u007f]/u.test(args[key])))throw new VoiceCliError('INVALID_ARGUMENT',`Invalid --${key}.`,'Use a bounded nonempty string.');
  }
  if(args['request-id']&&!/^[A-Za-z0-9_-]{8,128}$/u.test(args['request-id']))throw new VoiceCliError('INVALID_ARGUMENT','Invalid request ID.','Use 8–128 URL-safe characters and reuse it for retries.');
}

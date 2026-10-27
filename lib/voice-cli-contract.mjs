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
export function capabilities() {
  return {schema:CLI_SCHEMA, version:'0.1.0', transport:'private-unix-socket', node:'>=22', commands:COMMANDS,
    globalArgs:{socket:'absolute Unix socket; or V_VOICE_SOCKET',json:'JSON is always the output format',help:'offline command discovery',version:'offline version'},
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

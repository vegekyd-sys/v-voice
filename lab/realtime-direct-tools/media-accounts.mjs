import {constants} from 'node:fs';
import {open} from 'node:fs/promises';

const blocked = message => Object.assign(new Error(message), {submission:'not-submitted', code:'account_unavailable'});

// The session and native DM chat id come from the admitted server binding.
export function mediaAccountScope(sessionKey, nativeChatId) {
  const group = /^agent:makaron:feishu:group:(oc_[A-Za-z0-9_]+)$/u.exec(sessionKey);
  if (group) return {chat:group[1]};
  const dm = /^agent:makaron:feishu:(?:direct|dm):(ou_[A-Za-z0-9_]+)$/u.exec(sessionKey);
  if (dm) return {chat:/^oc_[A-Za-z0-9_]+$/u.test(nativeChatId) ? nativeChatId : dm[1], user:dm[1]};
  return null;
}

async function readPrivateFile(path) {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o077)) throw Error();
    return await file.readFile('utf8');
  } finally { await file?.close(); }
}

export function createMediaAccounts(storePath, companyKeyPath) {
  const registrations = new Map();
  async function lookup({chat, user}) {
    let store;
    try {
      store = JSON.parse(await readPrivateFile(storePath));
      if (!store || typeof store !== 'object' || Array.isArray(store)) throw Error();
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw blocked('暂时读不到这个会话的 Makaron 账号，请在原飞书会话检查绑定后再试。');
    }
    const aliases = [`chat:${chat}`, chat];
    if (user) aliases.push(`chat:${user}`, user, `user:${user}`, `chat:user:${user}`);
    for (const alias of aliases) {
      if (!Object.hasOwn(store, alias)) continue;
      const row = store[alias];
      if (typeof row?.api_key !== 'string' || !row.api_key.trim())
        throw blocked('这个会话的 Makaron 绑定缺少有效密钥，请在原飞书会话更新绑定。');
      // The existing chat router lets a binding explicitly select the company
      // account for agent work. Its ordinary group key must not pay in that case.
      if (row.agent_default === 'company') {
        const key = companyKeyPath && (await readPrivateFile(companyKeyPath).catch(() => '')).trim();
        if (!key) throw blocked('这个会话指定的 Makaron 公司账号暂不可用，请检查会话绑定。');
        return {key, claimed:true};
      }
      return {key:row.api_key, claimed:row.claimed};
    }
    return null;
  }
  // The owner's own entries pay with the owner's account, the one the Gateway gives the
  // same session's background tasks, never with a group's self-registered account.
  async function owner() {
    const key = companyKeyPath && (await readPrivateFile(companyKeyPath).catch(() => '')).trim();
    if (!key) throw blocked('你的 Makaron 主账号暂时读不到，创作还没有提交。');
    return {key, claimed:true, owner:true};
  }
  return {async resolve(scope, register) {
    if (scope?.owner) return owner();
    let account = await lookup(scope);
    if (account) return account;
    // Registration belongs to the existing Feishu workflow, which writes the
    // canonical binding. Voice only reads it. Never trust a key in task text.
    const id = scope.user ?? scope.chat;
    let pending = registrations.get(id);
    if (!pending) {
      pending = Promise.resolve().then(() => register(scope.chat));
      registrations.set(id, pending);
    }
    try { await pending; } catch { /* A lost reply may still have stored the binding. */ }
    finally { if (registrations.get(id) === pending) registrations.delete(id); }
    account = await lookup(scope);
    if (!account) throw blocked('尚未确认这个会话的 Makaron 注册或绑定，创作还没有提交。请在原飞书会话让 V 完成账号绑定。');
    return account;
  }};
}

export function mediaAccountFailure(text, account, scope) {
  if (/insufficient[ _-](?:credits?|balance)|not enough credits|(?:积分|点数|余额)不足|(?:MCP error|Error|HTTP) 402\b/iu.test(text)) {
    if (account?.owner) return {code:'insufficient_credits', message:'你的 Makaron 主账号积分不足，充值到账后再告诉我继续生成。'};
    const chat = scope && !scope.user ? '原飞书群' : '原飞书会话';
    const owner = scope && !scope.user ? '这个飞书群' : '这个会话';
    const claim = account.claimed === false ? '先认领这个账号，再' : '';
    const message = `${owner}绑定的 Makaron 账号积分不足。请回到${chat}，让 V 帮你${claim}给这个账号充值。到账后再告诉我继续生成。`;
    return {code:'insufficient_credits', message};
  }
  if (/invalid[ _-]api[ _-]key|(?:MCP error|Error|HTTP) 401\b/iu.test(text))
    return {code:'invalid_account_key', message:'这个会话的 Makaron 密钥已失效，请在原飞书会话更新绑定。'};
  return null;
}

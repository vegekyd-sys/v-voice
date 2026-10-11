import {randomBytes} from 'node:crypto';
import {createConversationEntries} from './conversation-entries.mjs';

// Resolving a key is read-only. Never allowMissing or silently bind an alias:
// a configured phone must continue precisely the conversation selected by its operator.
export async function verifyPhoneSession(gateway, binding) {
  const result = await gateway.request('sessions.resolve', {
    key: binding.sessionKey, agentId: binding.agentId,
  // The current Gateway's exact-key resolver still parses the agent store.
  // A real VLab response took 15 s; retain strict verification within the
  // transport's normal 30 s budget rather than creating media on timeout.
  }, {timeoutMs: 30000});
  if (result?.key !== binding.sessionKey || result.agentId && result.agentId !== binding.agentId) {
    throw new Error('Gateway did not confirm the exact phone session');
  }
  return {key: result.key, agentId: binding.agentId};
}

export async function provisionPhone({gateway, records, id, sessionKey, accountId, kind, legacyAccessToken = ''}) {
  const record = {id, agentId: 'makaron', sessionKey, accountId, kind,
    callerId: 'tianyi', permissionProfile: 'personal-tianyi',
    accessToken: randomBytes(32).toString('base64url'), disabled: false};
  createConversationEntries([...records, record], legacyAccessToken);
  await verifyPhoneSession(gateway, record);
  return record;
}

export function phoneLink(origin, basePath, record) {
  const base = new URL(origin);
  if (base.protocol !== 'https:' || base.origin !== origin || !/^\/[a-zA-Z0-9_-]+$/u.test(basePath)) {
    throw new Error('Phone sharing requires an HTTPS origin and a base path');
  }
  const url = new URL(`${basePath}/`, base);
  url.searchParams.set('phone', record.id);
  url.hash = new URLSearchParams({access: record.accessToken}).toString();
  return url.href;
}

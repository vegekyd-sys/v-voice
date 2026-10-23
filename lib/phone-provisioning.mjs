import {randomBytes} from 'node:crypto';
import {createConversationEntries} from './conversation-entries.mjs';

// Describe reads the exact existing session and its direct children. Resolve's
// key path loads the entire agent store (5+ seconds on production), so it must
// not sit on every dial. No cache or allowMissing: deleted/aliased entries fail.
export async function verifyPhoneSession(gateway, binding) {
  const {session} = await gateway.request('sessions.describe', {
    key: binding.sessionKey, includeDerivedTitles: false, includeLastMessage: false,
  }, {timeoutMs: 30000});
  if (session?.key !== binding.sessionKey || session.agentId !== binding.agentId) {
    throw new Error('Gateway did not confirm the exact phone session');
  }
  return {key: session.key, agentId: session.agentId};
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

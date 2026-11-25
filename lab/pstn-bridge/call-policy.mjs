// Who may make V dial whom. This is the whole outbound surface: one person-to-
// person call at a time, to a number whose owner agreed to receive it, started by
// a designated person. Not a dialer: no lists, no campaigns, no automatic redial.

/** Mainland mobile numbers in E.164; the prototype dials nothing else. */
export const CN_MOBILE = /^\+861[3-9]\d{9}$/u;

export function parsePolicy(raw) {
  const initiators = raw?.initiators, callees = raw?.callees;
  if (!Array.isArray(initiators) || !initiators.length || initiators.some(id => typeof id !== 'string' || !/^ou_[A-Za-z0-9]+$/u.test(id))) throw Error('Name the Feishu users allowed to start calls');
  if (!Array.isArray(callees) || !callees.length) throw Error('List the consenting callee numbers');
  const seen = new Set();
  for (const c of callees) {
    if (!CN_MOBILE.test(c?.number ?? '')) throw Error('Callee numbers must be +86 mainland mobiles');
    if (seen.has(c.number)) throw Error('Duplicate callee number');seen.add(c.number);
    // Consent is a record of who agreed and when, not a flag the caller can set.
    if (typeof c.consent?.by !== 'string' || !c.consent.by || Number.isNaN(Date.parse(c.consent?.at))) throw Error('Each callee needs a consent record (by, at)');
  }
  const perNumberDaily = raw.perNumberDaily ?? 3;
  if (!Number.isInteger(perNumberDaily) || perNumberDaily < 1 || perNumberDaily > 5) throw Error('perNumberDaily must be 1-5');
  const [startHour, endHour] = raw.hours ?? [8, 21];
  if (!(Number.isInteger(startHour) && Number.isInteger(endHour) && startHour >= 8 && endHour <= 21 && startHour < endHour)) throw Error('Calling hours must stay within 08-21 Asia/Shanghai');
  return Object.freeze({initiators:Object.freeze([...initiators]), callees:Object.freeze(callees.map(c => Object.freeze({number:c.number, label:c.label ?? null}))), perNumberDaily, startHour, endHour});
}

const shanghaiHour = at => (new Date(at).getUTCHours() + 8) % 24;
const shanghaiDay = at => new Date(at + 8 * 3600e3).toISOString().slice(0, 10);

/** Admission is decided once per attempt; a refused or failed attempt is final. */
export function createCallPolicy(policy, {now = Date.now} = {}) {
  let active = null;
  const attempts = new Map();  // `${day}|${number}` -> count, including failures
  return {
    admit({initiator, to, callerId}) {
      // Caller ID comes only from the provisioned trunk. A request that tries to
      // choose it is refused outright rather than silently ignored.
      if (callerId !== undefined) return {ok:false, reason:'caller-id-not-selectable'};
      if (!policy.initiators.includes(initiator)) return {ok:false, reason:'initiator-not-designated'};
      if (!CN_MOBILE.test(to ?? '')) return {ok:false, reason:'number-format'};
      const callee = policy.callees.find(c => c.number === to);
      if (!callee) return {ok:false, reason:'callee-not-consented'};
      const at = now(), hour = shanghaiHour(at);
      if (hour < policy.startHour || hour >= policy.endHour) return {ok:false, reason:'outside-hours'};
      if (active) return {ok:false, reason:'line-busy'};
      const key = `${shanghaiDay(at)}|${to}`, used = attempts.get(key) ?? 0;
      if (used >= policy.perNumberDaily) return {ok:false, reason:'daily-limit'};
      attempts.set(key, used + 1);
      active = {initiator, to, label:callee.label, admittedAt:at};
      return {ok:true, attempt:active};
    },
    release(attempt) {if (active === attempt) active = null;},
    active:() => active,
  };
}

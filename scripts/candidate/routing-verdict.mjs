// How a routing case's record is read (routing-eval.mjs records, routing-report.mjs tabulates): where the
// last thing said went, and whether that is what the case allows. Kept apart so that a case's
// expectation can be corrected and old records judged again without running the voice model.

/** What the last thing said set going, in the order it happened: make / back / lookup / lesson / control / talk. */
export function routeOf(record) {
  const kinds = [];
  for (const row of record.effects.filter(row => row.turn)) if (!kinds.includes(row.kind)) kinds.push(row.kind);
  for (const call of record.calls.filter(call => call.turn)) {
    const kind = call.name === 'delegate_to_v' ? 'back' : ['end_call', 'cancel_task', 'openclaw_agent_control'].includes(call.name) ? 'control' : call.name === 'current_time' ? 'lookup' : call.name === 'show_content' ? 'show' : '';
    if (kind && !kinds.includes(kind)) kinds.push(kind);
  }
  return kinds.length ? kinds : ['talk'];
}
/** A case's verdict: {ok, why}. `expect.route` lists the acceptable routes (each a kind, or kinds joined with "+", all of which must be there); `expect.never` lists kinds that must not be there. */
export function verdict(item, record) {
  if (record.errors.some(error => /did not become ready|credential/u.test(error))) return {ok: false, why: 'not run: ' + record.errors[0]};
  const kinds = routeOf(record), expect = item.expect ?? {};
  const fits = (expect.route ?? []).some(route => route.split('+').every(kind => kinds.includes(kind)));
  if (expect.route && !fits) return {ok: false, why: `went ${kinds.join('+')}, wanted ${expect.route.join(' or ')}`};
  for (const kind of expect.never ?? []) if (kinds.includes(kind)) return {ok: false, why: `went ${kind}, which it must not`};
  const made = record.effects.filter(row => row.turn && row.kind === 'make').map(row => row.detail).join('\n'), asked = record.calls.filter(call => call.turn && call.name === 'exec').map(call => call.args).join('\n');
  if (expect.command && kinds.includes('make') && !new RegExp(expect.command, 'u').test(asked + '\n' + made)) return {ok: false, why: `made without ${expect.command}`};
  return {ok: true, why: kinds.join('+')};
}

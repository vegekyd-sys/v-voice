import { readFile } from 'node:fs/promises';
import { createHash, createHmac } from 'node:crypto';

// Read existing credentials in memory; never copy them into the experiment.
export async function loadCredentials(path = process.env.VOLC_SPEAKER_ENV_FILE) {
  const result = { ...process.env };
  if (path) for (const line of (await readFile(path, 'utf8')).split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || Object.hasOwn(result, match[1])) continue;
    const value = match[2];
    result[match[1]] = /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value;
  }
  return result;
}

export async function rtcRequest(env, action, body, version = '2023-11-01') {
  return openApiRequest(env, {action,body,version});
}

export async function openApiRequest(env, {action,body,version,host='rtc.volcengineapi.com',region='cn-north-1',service='rtc'}) {
  const key = env.VOLCENGINE_ACCESS_KEY_ID;
  const secret = env.VOLCENGINE_SECRET_ACCESS_KEY;
  if (!key || !secret) throw Error('RTC OpenAPI credentials missing');
  const hash = value => createHash('sha256').update(value).digest('hex');
  const hmac = (key, value) => createHmac('sha256', key).update(value).digest();
  const date = new Date().toISOString().replace(/[:-]|\.\d{3}/g, ''), day = date.slice(0,8);
  const query = new URLSearchParams({Action:action,Version:version}).toString();
  const payload = JSON.stringify(body), digest = hash(payload);
  const names = 'content-type;host;x-content-sha256;x-date';
  const headers = `content-type:application/json\nhost:${host}\nx-content-sha256:${digest}\nx-date:${date}\n`;
  const scope = `${day}/${region}/${service}/request`;
  const canonical = ['POST','/',query,headers,names,digest].join('\n');
  const signing = hmac(hmac(hmac(hmac(secret,day),region),service),'request');
  const signature = createHmac('sha256',signing).update(['HMAC-SHA256',date,scope,hash(canonical)].join('\n')).digest('hex');
  const response = await fetch(`https://${host}/?${query}`, {method:'POST',signal:AbortSignal.timeout(20000),
    headers:{'Content-Type':'application/json','X-Date':date,'X-Content-Sha256':digest,
      Authorization:`HMAC-SHA256 Credential=${key}/${scope}, SignedHeaders=${names}, Signature=${signature}`},body:payload});
  return {status:response.status, data:await response.json()};
}

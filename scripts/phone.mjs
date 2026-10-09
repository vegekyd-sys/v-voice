#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {GatewayClient} from '../lib/gateway-client.mjs';
import {provisionPhone, phoneLink} from '../lib/phone-provisioning.mjs';
import {readPhoneFile, updatePhoneFile} from '../lib/private-phone-file.mjs';

export async function runPhoneCommand(args, env = process.env) {
  const {values, positionals} = parseArgs({args, allowPositionals: true, options: Object.fromEntries(
    ['entries', 'id', 'session', 'account', 'kind', 'gateway-config', 'gateway-url', 'origin', 'base-path', 'out'].map(k => [k, {type: 'string'}]))});
  const command = positionals[0];
  if (!['add', 'list', 'link'].includes(command) || positionals.length !== 1 || !values.entries) {
    throw new Error('Usage: phone <add|list|link> --entries <private-json-file> (see docs/conversation-entries.md)');
  }
  if (command === 'list') {
    return {phones: (await readPhoneFile(values.entries)).map(({id, kind, sessionKey, accountId, disabled}) => ({id, kind, sessionKey, accountId, disabled}))};
  }
  if (command === 'link') {
    const record = (await readPhoneFile(values.entries)).find(r => r.id === values.id && !r.disabled);
    if (!record || !values.out) throw new Error('Select an enabled phone ID and a new private --out file');
    const link = phoneLink(values.origin, values['base-path'] ?? '/voice', record);
    await writeFile(resolve(values.out), link + '\n', {flag: 'wx', mode: 0o600});
    return {id: record.id, linkFile: resolve(values.out), secretPrinted: false};
  }
  for (const key of ['id', 'session', 'account', 'kind', 'gateway-config']) if (!values[key]) throw new Error(`Missing --${key}`);
  const config = JSON.parse(await readFile(values['gateway-config'], 'utf8'));
  const rawToken = config.gateway?.auth?.token;
  if (typeof rawToken !== 'string') throw new Error('Gateway token is not configured');
  const token = rawToken.replace(/\$\{([^}]+)\}/gu, (_, key) => env[key] ?? '');
  if (!token) throw new Error('Gateway token environment is unavailable');
  let client;
  try {
    await new Promise((accept, reject) => {
      client = new GatewayClient({url: values['gateway-url'] ?? `ws://127.0.0.1:${config.gateway.port}`,
        token, scopes: ['operator.read'], caps: [], onHelloOk: accept, onConnectError: reject});
      client.start();
    });
    await updatePhoneFile(values.entries, async records => [...records, await provisionPhone({gateway: client,
      records, id: values.id, sessionKey: values.session, accountId: values.account, kind: values.kind,
      legacyAccessToken: env.RTC_H5_ACCESS_TOKEN ?? env.GPT_LIVE_H5_ACCESS_TOKEN ?? ''})]);
    return {id: values.id, existingSessionVerified: true, callsCreated: 0, configurationOnly: true};
  } finally {client?.stop();}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {console.log(JSON.stringify(await runPhoneCommand(process.argv.slice(2))));}
  catch {console.error('Phone command failed. Check arguments, private file permissions and the exact Gateway session; no credential is printed.'); process.exitCode = 1;}
}

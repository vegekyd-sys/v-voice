import {connect} from 'node:net';

// Dialer for a self-hosted Asterisk in front of a carrier SIP trunk. Asterisk
// owns SIP, RTP, codec negotiation and the caller ID the trunk was provisioned
// with; this only asks it to originate one call and, on answer, to run
// AudioSocket(<uuid>, <bridge host:port>). Credentials come from private config
// and are never logged. Verified against a scripted AMI peer only, not a live
// Asterisk: confirm the OriginateResponse reasons on the deployed version.
const REASONS = {0:'failed', 1:'hangup', 3:'no-answer', 4:'answered', 5:'busy', 8:'congestion'};
const SAFE = /^[A-Za-z0-9_.:-]+$/u;

export function originateAction({actionId, to, trunk, uuid, audioSocket, ringTimeoutMs = 45000}) {
  // The dialed string is built here from validated parts, never passed through.
  // Mainland trunks usually take the national 11-digit form; confirm with the carrier.
  if (!/^\+861[3-9]\d{9}$/u.test(to)) throw Error('Invalid callee');
  for (const v of [actionId, trunk, uuid, audioSocket]) if (!SAFE.test(v)) throw Error('Unsafe AMI field');
  const lines = ['Action: Originate', `ActionID: ${actionId}`, `Channel: PJSIP/${to.slice(3)}@${trunk}`,
    'Application: AudioSocket', `Data: ${uuid},${audioSocket}`, `Timeout: ${ringTimeoutMs}`, 'Async: true'];
  return lines.join('\r\n') + '\r\n\r\n';
}

export function parseMessages(onMessage) {
  let text = '';
  return chunk => {
    text += chunk.toString('utf8');
    let at;
    while ((at = text.indexOf('\r\n\r\n')) >= 0) {
      const block = text.slice(0, at);text = text.slice(at + 4);
      const message = {};
      for (const line of block.split('\r\n')) {const i = line.indexOf(':');if (i > 0) message[line.slice(0, i).trim()] = line.slice(i + 1).trim();}
      if (Object.keys(message).length) onMessage(message);
    }
  };
}

export function createAmiDialer({host = '127.0.0.1', port = 5038, username, secret, trunk, audioSocket, ringTimeoutMs = 45000}) {
  if (!username || !secret || !trunk || !audioSocket) throw Error('AMI dialer needs username, secret, trunk and audioSocket');
  return {
    originate({to, uuid}) {
      return new Promise(resolve => {
        const socket = connect(port, host), actionId = `v-${uuid.slice(0, 8)}`;
        let loggedIn = false, settled = false;
        const done = result => {if (settled) return;settled = true;socket.end('Action: Logoff\r\n\r\n');resolve(result);};
        socket.on('error', () => done({answered:false, reason:'dialer-unreachable'}));
        socket.on('close', () => done({answered:false, reason:'dialer-closed'}));
        socket.on('data', parseMessages(m => {
          if (!loggedIn && m.Response === 'Success' && m.ActionID === 'login') {
            loggedIn = true;socket.write(originateAction({actionId, to, trunk, uuid, audioSocket, ringTimeoutMs}));return;
          }
          if (m.Response === 'Error' && m.ActionID === 'login') return done({answered:false, reason:'dialer-auth'});
          if (m.Response === 'Error' && m.ActionID === actionId) return done({answered:false, reason:'originate-refused'});
          if (m.Event === 'OriginateResponse' && m.ActionID === actionId) {
            const reason = REASONS[Number(m.Reason)] ?? 'failed';
            return done(m.Response === 'Success' ? {answered:true} : {answered:false, reason});
          }
        }));
        socket.once('connect', () => socket.write(`Action: Login\r\nActionID: login\r\nUsername: ${username}\r\nSecret: ${secret}\r\nEvents: call\r\n\r\n`));
      });
    },
  };
}

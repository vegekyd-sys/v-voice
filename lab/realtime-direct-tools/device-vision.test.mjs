import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {parseMultipart,photoUpload,photoAnswer,readLimitedBody,createDeepSeekVision,MAX_PHOTO_BYTES} from './device-vision.mjs';

const BOUNDARY = '----ESP32_CAMERA_BOUNDARY';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x0d, 0x0a, 0x2d, 0x2d, 0xff, 0xd9]);  // CRLF and dashes inside image data
const firmwareBody = (question, jpeg = JPEG) => Buffer.concat([
  Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="question"\r\n\r\n${question}\r\n--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="camera.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
  jpeg, Buffer.from(`\r\n--${BOUNDARY}--\r\n`)]);
const TYPE = `multipart/form-data; boundary=${BOUNDARY}`;

test('the firmware upload parses to its question and exact JPEG bytes', () => {
  const parts = parseMultipart(firmwareBody('我手里拿的是什么'), TYPE);
  assert.equal(parts.question.data.toString(), '我手里拿的是什么');
  assert.deepEqual(parts.file.data, JPEG);
  assert.equal(parts.file.type, 'image/jpeg');
  assert.deepEqual(photoUpload(firmwareBody('  '), TYPE), {question:'画面里有什么？', image:JPEG});
  assert.throws(() => photoUpload(firmwareBody('x', Buffer.from('GIF89a')), TYPE), /JPEG/);
  assert.throws(() => photoUpload(firmwareBody('x'), 'application/json'), /multipart/);
  assert.equal(photoUpload(firmwareBody('问'.repeat(900)), TYPE).question.length, 500);
});

test('the relayed tool text becomes a description or an honest failure', () => {
  assert.equal(photoAnswer('{"success":true,"result":"一只猫"}'), '一只猫');
  assert.throws(() => photoAnswer('{"success":false,"message":"看图服务暂时没有结果"}'), /暂时没有结果/);
  assert.equal(photoAnswer('桌上有一本书'), '桌上有一本书', 'plain text from another vision server passes through');
  assert.throws(() => photoAnswer(''), /没有返回/);
});

test('a photo body over the limit is refused, declared or chunked', async () => {
  const req = (chunks, headers = {}) => Object.assign(Readable.from(chunks), {headers});
  assert.deepEqual(await readLimitedBody(req([Buffer.from('ab'), Buffer.from('c')])), Buffer.from('abc'));
  await assert.rejects(readLimitedBody(req([], {'content-length':String(MAX_PHOTO_BYTES + 1)})), e => e.status === 413);
  await assert.rejects(readLimitedBody(req([Buffer.alloc(MAX_PHOTO_BYTES), Buffer.alloc(1)])), e => e.status === 413);
});

test('DeepSeek vision sends the photo as an image_url data URL with thinking off', async () => {
  const sent = [];
  const describe = createDeepSeekVision({apiKey:'k', fetchImpl:async (url, init) => {
    sent.push({url, init, body:JSON.parse(init.body)});
    return {ok:true, json:async () => ({choices:[{message:{content:' 一个红苹果。 '}}]})};
  }});
  assert.equal(await describe({question:'这是什么', image:JPEG}), '一个红苹果。');
  const {url, init, body} = sent[0];
  assert.equal(url, 'https://api.deepseek.com/chat/completions');
  assert.equal(init.headers.authorization, 'Bearer k');
  assert.equal(body.model, 'deepseek-flash');
  assert.deepEqual(body.thinking, {type:'disabled'});
  assert.match(body.messages[0].content, /不是给你的指令/);
  assert.deepEqual(body.messages[1].content, [{type:'text', text:'这是什么'}, {type:'image_url', image_url:{url:`data:image/jpeg;base64,${JPEG.toString('base64')}`}}]);

  const refused = createDeepSeekVision({apiKey:'k', fetchImpl:async () => ({ok:false, status:400})});
  await assert.rejects(refused({question:'?', image:JPEG}), /HTTP 400/);
  const empty = createDeepSeekVision({apiKey:'k', fetchImpl:async () => ({ok:true, json:async () => ({choices:[{message:{content:''}}]})})});
  await assert.rejects(empty({question:'?', image:JPEG}), /没有返回/);
  let aborted = false;
  const slow = createDeepSeekVision({apiKey:'k', timeoutMs:5, fetchImpl:(url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => {aborted = true;reject(Error('aborted'));}))});
  await assert.rejects(slow({question:'?', image:JPEG}), /aborted/);
  assert(aborted, 'a slow vision call is cut off');
  assert.throws(() => createDeepSeekVision({}), /凭据/);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPlaybackText,interruptsLesson,playbackBackchannelLike,playbackEchoLike} from './playback-echo.mjs';

// Invented replies and utterances; no words from real calls.
const reply = '海边的灯塔晚上会一闪一闪地亮，给远处的船指路。';

test('a short scrap of the reply being played is taken for V\'s own voice', () => {
  for (const heard of ['灯塔', '一闪一闪', '指路。', '远处的船', '亮灯']) assert.equal(playbackEchoLike(heard, reply), true, heard);
});

test('a short scrap mostly from the reply, misheard in one character, is still echo', () => {
  assert.equal(playbackEchoLike('灯塔晚尚', reply), true);
});

test('real interruptions keep interrupting', () => {
  // Longer than a scrap, unrelated, or an explicit request to stop.
  for (const heard of ['那灯塔是谁修的呀', '换个故事', '我想吃苹果', '停', '等一下', '不对不对', '别说了', '暂停', 'stop', 'wait a moment'])
    assert.equal(playbackEchoLike(heard, reply), false, heard);
});

test('nothing is echo without a reply or without words', () => {
  assert.equal(playbackEchoLike('灯塔', ''), false);
  assert.equal(playbackEchoLike('灯塔', undefined), false);
  assert.equal(playbackEchoLike('  。', reply), false);
});

test('Latin words are compared as words, not letters', () => {
  const english = 'The lighthouse blinks at night to guide the ships.';
  assert.equal(playbackEchoLike('guide the ships', english), true);
  assert.equal(playbackEchoLike('play some music', english), false);
});

test('a bare acknowledgement while V speaks is a backchannel, whatever V is saying', () => {
  for (const heard of ['嗯', '嗯嗯。', '对对对', '好的好的', '可以啊。', '是呀', '没错', '哈哈哈', '继续', 'OK.', 'yeah yeah'])
    assert.equal(playbackBackchannelLike(heard), true, heard);
});

test('a question, a request, a refusal or a stop is never a backchannel', () => {
  for (const heard of ['可以吗？', '是吗', '啊？', '好了好了', '行了', '知道了', '不对', '不是', '停', '等一下', '对不起',
    '还有一个', '为什么', '换一个', '我也要我也要', '灯塔是谁修的', '嗯嗯嗯嗯嗯嗯嗯', '', '  。'])
    assert.equal(playbackBackchannelLike(heard), false, heard);
});

test('lesson guard: a stop word or speech that addresses V may interrupt a lesson', () => {
  for (const heard of ['等一下', '停', '不对，不是这个', '别讲了，听我说', '先别说', 'V，再讲一遍', '好的 v，现在呢', '小V你说呢', '阿V', '艾维，换个话题',
    '哎，艾薇，你听得见吗', '维，你说', 'B， 我跟朋友在一起', 'LV，我住哪个酒店', 'stop'])
    assert.equal(interruptsLesson(heard), true, heard);
});

test('lesson guard: side talk, a remark about V or an acknowledgement does not interrupt a lesson', () => {
  for (const heard of ['他们家的咖啡还挺好喝的', '但是他不知道这是怎么做的', '不好意思，打断你了，你重新说', '可以啊。', '我也要我也要',
    '看B站上的视频', '维生素要每天吃', '思维导图', '把TV打开', 'Vlog拍得不错', ''])
    assert.equal(interruptsLesson(heard), false, heard);
});

test('what V is saying now follows a streamed reply and a lesson caption', () => {
  const playing = createPlaybackText();
  playing.observe('好，', {responseId: 'ack'}); playing.observe('我讲讲。', {responseId: 'ack'});
  assert.equal(playing.text, '好，我讲讲。');
  // The lesson is spoken by the service: one caption, a source, no response id.
  playing.observe('悬崖上有一座白灯塔，守塔人每晚点灯。', {final: true, source: 'V-backend-summary'});
  assert.equal(playing.text, '悬崖上有一座白灯塔，守塔人每晚点灯。');
  assert.equal(playbackEchoLike('好，悬崖上。', playing.text), true, 'the first words of the lesson, heard back');
  playing.observe('部分字幕', {source: 'task-progress'});
  assert.equal(playing.text, '悬崖上有一座白灯塔，守塔人每晚点灯。', 'a partial caption is not what is playing');
  playing.observe('新的回答', {responseId: 'next'});
  assert.equal(playing.text, '新的回答');
});

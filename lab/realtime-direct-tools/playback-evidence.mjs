export function actualSpeakerIdle(rows,now,speakerRms) {
  const audio=rows.filter(e=>e.type==='audio').at(-1);
  const playback=rows.filter(e=>e.type==='client.playback-stats').at(-1);
  return Boolean(audio&&playback&&playback.at>=audio.at&&now-playback.at<5000&&now-audio.at>1200&&playback.stats.queuedOutputBytes===0&&speakerRms<.001);
}

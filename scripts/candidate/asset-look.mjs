// One look by the shelf's eye (board-assets.mjs) at each picture address given, on the board's own
// model: what it names the picture, what it says is in it, and how long the look took. Run on V by
// asset-look-on-v.sh with only the text-model settings the Voice service already holds. Prints nothing secret.
import {boardCompletionFromEnv} from '../../lab/gpt-live-h5/board-director.mjs';
import {createAssetEye} from '../../lab/gpt-live-h5/board-assets.mjs';

const complete = boardCompletionFromEnv({...process.env, VOICE_BOARD: '1', VOICE_BOARD_MAX_TOKENS: '700'});
if (!complete) { console.log(JSON.stringify({error: 'no board model credential'})); process.exit(1); }
// (The model's own refusal, if any, is worth seeing once: a model that takes no pictures answers with an HTTP error.)
const refused = [];
const watched = async function* (request) { try { yield* complete(request); } catch (error) { refused.push(String(error?.message ?? error).slice(0, 300)); throw error; } };
const see = createAssetEye({complete: watched});
for (const url of process.argv.slice(2)) {
  const started = Date.now(), found = await see({url, prompt: process.env.LOOK_PROMPT ?? ''});
  console.log(JSON.stringify({url, ms: Date.now() - started, found, ...(refused.length ? {errors: refused.splice(0)} : {})}));
}

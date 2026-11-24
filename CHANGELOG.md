# Changelog





## 2026-11-25 — Live broadcast recordings upload in parts (`voice-makaron-director.20261125.1`)

- A full-flow production check found the 15-minute relay limit was not enough: Cloudflare ends a request whose origin has not answered in about 100 s (HTTP 524), so a single recording upload over the slow tunnel never finished.
- The Makaron player now uploads 512 KB parts while the show runs (Makaron dev, `x-recording-offset`, with `x-recording-final` on the part that closes the file). The Voice relay passes those two headers on, numeric only, for the recording upload.

## 2026-11-25 — The owner's entries pay for media with the owner's account (`voice-owner-media.20261125.1`)

- A call from Tianyi's own entry (`permissionProfile` `personal-tianyi`) mapped to a group whose self-registered Makaron account had 2 credits. Since 2026-11-22 the call paid for media with that group binding, while the same session's background tasks pay with the account the Gateway injects (the owner's, 34k credits). An image request on the call reported insufficient credits.
- The owner's entries now reserve with `ownerMedia`: the media runner uses the owner's account (the same store the explicit company binding reads) and never registers a group account for them. Its credit message names the owner's account.
- Other confirmed callers keep their session binding.

## 2026-11-24 — Live broadcast recordings reach the server on a slow uplink (`voice-makaron-director.20261124.5`)

- Online acceptance found the recording upload cut off: through the production tunnel it arrived at about 70 KB/s, and the Voice relay gave every Director player request 95 s. The recording upload alone now gets 15 minutes; other player requests keep 95 s.
- The Makaron player records at 0.9 Mbps video and 64 kbps audio (Makaron dev), about half the earlier size.

## 2026-11-24 — Live broadcast on the lesson board released (`voice-makaron-director.20261124.4`)

- The Candidate work below (2026-11-23 to 11-24) goes to production: the voice model opens, steers and ends a Makaron Director broadcast with `improv_live`, the show advances its own story, and the recording is archived on the board.
- It is offered only to the personal entry (`permissionProfile` `personal-tianyi`) on a service with `VOICE_IMPROV_LIVE=1`, a Director CLI path and a Director address; other callers, the App's native runtime, robots and speakers do not get the tool.
- The Director runs beside the Voice service on the same host (Makaron `services/director/start-host.mjs`), accepting only that service's Makaron key. Provider costs are that deployment's own; Makaron credits are not charged.
- The Gateway is not restarted by this release.

## 2026-11-24 — The live broadcast advances its own story (Candidate)

- Makaron Director runs a showrunner on DeepSeek flash for shows opened with `--story`: it plans a 6–10 beat arc when the show starts and releases one beat once the current direction has held on screen (8 s after the opening, 7 s after its own beat, 12 s after the caller's).
- The opening goes to the provider unchanged and the first plan runs beside connection setup, so the start is not held by planning.
- A shot the voice model wrote is sent with `--ready`: it skips Makaron's spoken-draft cleanup and its 650 ms pacing. The live player keeps one poll open, so a new direction leaves for the provider as soon as it exists. The showrunner then drops its queued beats and replans around the caller's direction.
- Each showrunner beat carries a short audience caption, shown under the picture like the host's captions.
- When the voice model gives no caption, the caller's whole request is shown under the picture with spoken fillers (「好」「然后呢」) dropped, instead of only its first phrase.

## 2026-11-24 — Live broadcast review (Candidate)

- The Director worker runs beside the Voice service, so signaling, directions and recording uploads no longer cross a long relay.
- A broadcast survives brief relay errors, retries one failed WebRTC offer, and reports why it ended (time limit, lost connection, caller).
- The model receives Makaron's own error text and the end reason, and writes a short audience caption for each shot instead of showing the Director prompt.
- The live picture and its recording use the board's work frame, REC timer, lesson-hand caption and one end control.

## 2026-11-23 — Makaron Director on the lesson board (Candidate)

The web call uses the private Makaron CLI Director session. Scene directions and requests to end the broadcast use the active session. The board shares its existing space with the live picture and keeps the call connected.
## 2026-11-24 — GPT Live 1.1 is given whole results, as Doubao is

- GPT Live 1.1 was given every tool result except a search cut at 2,400 characters: a day of six meetings showed it three, and a page or a background task's result stopped mid-way, so it said what it had and seemed cut off. Doubao is given the same results whole up to 32 KB.
- Every result now reaches GPT Live whole up to that same budget (`TOOL_RESULT_MAX_BYTES` in `search-result.mjs`, now also the bound Doubao and Grok check), and only past it is cut. Search and memory digests keep every passage as returned instead of six cut to 520 and 1,200 characters.
- Doubao and Grok receive exactly what they did.

## 2026-11-24 — iOS App calls no longer end five seconds in

- The relay's keepalive line (`{"type":"keepalive"}` every 5 s, added 11-24 for web pages behind middleboxes that drop pings) went to every client. The released iOS App reads each line of a native-runtime call as a runtime frame and fails the call on one it does not know ("当前服务的语音协议尚不支持"), so every App call ended about five seconds after connecting, whatever the model. The line now goes only to phone web pages; the App and speakers get the protocol ping alone, as before.

## 2026-11-24 — GPT Live 1.1 released; GPT Live One retired (`voice-gpt-live-11.20261124.1`)

- GPT Live 1.1 (below, from the Candidate of 2026-11-20 to 11-24) goes to production. It is offered on the phone where the service has `VOICE_ENABLE_GPT_LIVE_11=1` and a login; robot and speaker endpoints are not offered it.
- GPT Live One leaves the phone catalog (it stays available only with `VOICE_ENABLE_GPT_LIVE_ONE=1`); a page or App that still asks for it is told to choose again.
- The default model and Doubao are unchanged. The Gateway is not restarted by this release.

## 2026-11-20 — GPT Live 1.1 with this call's own tools (Candidate)

- New relay model `gpt-live-11` (`gpt-live-1.1-codex`) on the ChatGPT (Codex) login. That login is admitted over WebRTC only, so the Voice service is the media peer (`gpt-live-peer.mjs`, werift + Opus) and the phone, app and page keep the existing relay; no Gateway change or restart.
- GPT Live has no function tools: it delegates, and the application works out from the conversation what is wanted. A delegation that one of the call's own tools can answer becomes that tool call (`gpt-live-router.mjs`: one fast function-calling request that is given the last turns and whether a task is running; with no usable answer, the backend). The choice starts when the caller stops speaking and is used by the delegation that follows. Only real work reaches `delegate_to_v`.
- The ChatGPT login ignores `session.instructions` and answers as "ChatGPT" from its own prompt (measured on `gpt-live-1.1-codex` and `gpt-live-1-codex`). The instructions therefore travel as developer messages in `initial_items`, in the structure OpenAI documents for gpt-live-1.1 (Backchannel / Interruption / Delegation policy), with V's name and tone first.
- Greeting: asked for when the call is ready and again until V speaks; withdrawn when the caller speaks first. Search and memory results are given to the model as plain facts (no external-content wrappers, no links); the first version cut wrapped JSON at 1,800 characters.
- Explain mode: "讲解/解释/讲讲" becomes `explain_on_board`; the lesson script is given back with the documented read-as-written wording and the board follows the voice. A running image or video creation is followed on its own execution and only the outcome is told.
- After the first real call (2026-11-20 evening):
  - The caller's unfinished words were passed on as transcripts; the page shows every unfinished transcript as V speaking and the board draws from it, so the caller's words appeared in V's bubble and on the board. They are now passed on once, whole.
  - A script the model reads was captioned with the model's own text (other punctuation, split by interruptions), which the board did not recognise as the script: it drew a second page from the speech, without the lesson's pictures. The caption is now the script as written, as far as the voice has got (`V-backend-summary`, as with Doubao), and the board takes any part of the script being read for the same page.
  - A finished task turned into a script was handed over with "tell the user this" and paraphrased, with nothing drawn; it is now read as a script. While the script is written the model is told the result is in. Results are no longer held back while the caller speaks: the model waits for the end of the caller's turn by itself.
  - Memory records are given at the length the search returned them (they were cut to 520 characters each; Doubao received them whole), with where each comes from. Stories and requests for pictures go to the lesson tool; names are kept as spoken (a nickname transcribed as a number is not an age).
  - The page showed a lesson's pieces at once when the caption grows as the script is read (a cue not yet in the caption counted as tied to nothing): they now wait for the voice. A lesson with pictures counts as the promise of pictures kept; the unkept-promise check used to nudge the model to start a creation, and clear the phone's audio, as the script began.
  - V's character on this model is written as sunny, sweet and gentle, and the page offers the model's voices (nine; `marin` is refused on the ChatGPT login).
- After the second real call: a long result is asked about once, when all of it has arrived, and says nothing else is running; "let me think" / "I'll check" with nothing delegated is called out once; V's own goodbye without a hang-up delegated ends the call, and the caller's goodbye over it neither clears the audio nor cancels the hang-up (GPT Live 1.1 only; for the other models any speech cancels a hang-up, as released); a cough transcribed as a marker is not a turn, and a caller's turn that draws nothing leaves the script's page in place; V's character is sweeter, at a normal pace.
- "It sounds like reading": the call is created like GPT Live One's and the audio path was clean; V's answers were twenty-second finished paragraphs because the instructions (which on GPT Live One never reach the model) carried pages of style rules. The instructions now start with how to speak (a live call, one or two sentences, then listen), keep only who V is and how V thinks from the shared persona, and results are told the same way.
- Halting playback: GPT Live's voice arrives at the speed it plays, and the page started with 120 ms in hand; on a real call the queue ran dry 61 times in 167 s of speech. For this model the page starts with 320 ms and widens (to 680 ms at most) each time the queue runs dry mid-reply. The media peer counts packets it gave up on. Pace is asked for as calm and unhurried (about 5 letters a second measured, from 5-6.4).
- Lessons about something current (all models): the search made for a lesson names the year and month ("今年…" returned last season's pages), its results reach the writer as dated plain lines instead of wrapped JSON cut at 8,000 characters, and the writer is told today's date and to take the newest dated source for what is true now. GPT Live: pace back to conversational; a script is said to its end.
- GPT Live answered a lookup with far less than Doubao from the same six passages: its copy was cut at 2,400 characters (the last two results lost) and the short-turn rule stopped every answer after two items. The whole result is given and a lookup is told in full.
- A stronger model behind the voice: gpt-live-1.1's hosted delegation is refused on the ChatGPT login (HTTP 401 from the backend call). A stand-in on the same subscription (`web_answer`, a second answer from a model that reads the pages) was tried for one build and removed: short tasks here are answered by the call's own tools, without a backend model.
- GPT Live explains and tells stories itself: the lesson tool (a script by another model, read out) is no longer offered to this model unless `VOICE_GPT_LIVE_SCRIPTED_LESSONS=1`; what needs facts is looked up first, and the page draws along with the speech. An explanation begins when the question ends (a script began 7 s later).
- No fixed patterns in front of the routing model: which tool is the model's judgement (they decided 7 of 49 choices on real calls and could only be wrong by keyword). Measured on V, 24 sentences twice: `deepseek-flash` direct 48/48 right, median 652 ms; `openai/gpt-6-luna` through OpenRouter 48/48, 1,088 ms. OpenAI's Decisions API, measured with a platform key: 48/48, median 297 ms, the tool only, no arguments. It is asked beside the function-calling request (`VOICE_GPT_LIVE_DECISIONS_API_KEY`, off without it) and settles tools that take no arguments; the rest wait for the arguments as before.
- The two repairs behind the model are judged, not matched: whether V's short reply is a goodbye nobody acted on, an empty "let me think", and whether the caller's words during a hang-up are only a goodbye were word lists; they are three yes/no questions to a model now (one Decisions request with three predicates, or the routing model through a function call; nothing is repaired without either). Measured on V, 23 invented exchanges twice: Decisions 46/46, median 307 ms; `deepseek-flash` 46/46, median 844 ms. The session keeps no list of farewells: it asks the voice path (`keepsEnding`), which only GPT Live 1.1 has.
- Driven through its own page with synthetic speech as the microphone (2026-11-23), which found: audio that arrived late in a burst stayed late for the rest of the call, up to two seconds (frames of a pause are now skipped until it has caught up; speech never is); "wait, don't hang up" said over V's goodbye was never heard in time (the page is not told to hang up while the caller is audibly speaking or their words are being judged); a lookup the model promised and never delegated was only pointed out to it (it is now made for the model when the caller's words call for one); a plain goodbye the model answered without delegating took 5.7 s to end the call (now half a second after its reply). Measured against Doubao on the same page: the tools start as early, V begins to speak sooner, and the answer itself comes later (the time 5.3 s against 3.1 s, a search result 8.5-11.9 s against 4.6 s); see the Candidate note.
- A real call ended in mid-sentence when the phone's socket closed without a close frame (the page's statistics were regular up to 0.7 s before; nothing on the service's side ended it). A GPT Live 1.1 call whose relay socket is cut is now dialled again by the page itself (twice in a row at most, no ring, the audio context of the first tap kept), the service keeps for two minutes what was being said, and V says it is back and goes on from where it stopped; the dial carries what the page saw of the lost call (`call.resumed`).
- Settings: the top-right entry opens a sheet with V's voice for the selected model and iOS binding as a row; the inline voice select has left the home screen. Doubao offers six voices instead of one, each checked with a real session before being listed (an unknown speaker id is accepted upstream and then yields a silent call, so the service refuses one it does not list). Speakers, robots and the iOS App's native dial are unchanged.
- Pictures for what V explains in its own words: the board's illustrator first reads what the answer is about (a set of things one can see becomes a gallery with a photograph an item; how something works keeps diagrams and no photographs), a call without scripts may open with three or four photographs when the caller stops speaking, a page without a script holds six at most, and a thing rewritten keeps its search term. The page reports a long sentence as it is spoken (after a short first sentence nothing was asked for 12-18 s). "I'd like to see more pictures" is no longer routed to the creation tool. Replayed through the real illustrator: items with a picture 0 of 9-11 → 6, 5-7 of 16-17 → all; explanations of how something works 0 photographs before and after; scripted lesson pages unchanged.
- The login: GPT Live 1.1 can take the Gateway's own ChatGPT login, the one its GPT Live One uses, instead of a copied token file. The `v-voice-gpt-live` plugin answers `voice.product.gpt-live-auth` (admin scope) by the host's own profile call, and with `VOICE_GPT_LIVE_AUTH=gateway` the service asks for it, held in memory ten minutes at most; the agent whose login it is is named (`VOICE_GPT_LIVE_AUTH_AGENT`). Tried on the host: a token good for 215 hours that a GPT Live 1.1 call accepted. The method runs only once the Gateway has loaded the released plugin.
- The mark keeps with what V tells: the model's captions arrive in step with its voice, so a thing could only be drawn after it was said and the mark was a step behind. The page now leads: what the caller's question put up is told to V (with "say it yourself", or in passing when it is already answering) so that it names those things in that order, and an item takes the mark when V says its whole name, two characters included. On the Candidate's page, name in the caption to mark on the item: 0.6-2.3 s in seven of nine, 3.5 s and 5.3 s around a pointer on a picture (6.9 s and 7.8 s before for two-character names).
- The home page no longer says which voice is on (Settings does). GPT Live One leaves the phone catalog unless `VOICE_ENABLE_GPT_LIVE_ONE=1`; a dial for it is told to choose again and the default moves to GPT Live 1.1 where offered, else Doubao.
- The page is written in the language V is speaking: the rule was the lesson writer's only, so a page drawn from speech (everything GPT Live 1.1 explains; Doubao's answers outside a lesson) stayed in Chinese when the call moved into French. The illustrator now writes in V's language (the caller's before V speaks; what was found is no measure; a page written earlier is rewritten). On the Candidate, GPT Live 1.1 in French: 22 of 24 texts French. Doubao's lesson asked for in French was and is French; asked in French without saying so it was twice given in Chinese (its recognition of the French, not changed here).
- V's speech broke up in long answers (one to three stops each in a real call). Measured: OpenAI sends the voice a little slower than it plays (46 to 50 packets a second where 50 are due, none lost, timestamps whole), so the page's queue was eaten until it ran dry in mid-word. For GPT Live 1.1 the page's player now holds the pauses V makes anyway (after 120 ms of quiet, while less than its window is waiting, half a second at most for one pause), so the sound catches up between sentences; other voices are unchanged, and the held time is reported as `stretchedMs`. An earlier change that filled late packets with quiet by the clock put silence into words and is removed. On the Candidate's own page: one call with answers of 53 s and 47 s had no stop and never ran dry (1.9 s of pauses held in all); a second call, where an answer of 74.5 s came 4.6% slow, had two stops, both in its first 23 s, and none in the 100 s after. With a pause also putting sound by (up to 200 ms more of one pause once the window is full, until 680 ms are waiting; `bab6732`): two more calls, four answers of 45 to 64 s that each came 1.7 to 3.8 s slow, no stop and the queue never dry; 5.6 and 7.7 s of pauses held in a call, which is about the time the sound was late.. Not listened to on a phone.
- The page and the labels on its pictures follow the language V speaks. A call that came back after a French conversation had its pages written in French while V and the caller spoke Chinese, and the labels pinned on photographs were Chinese on a French page: the director went on in the language of the page that was up (French 10 times of 10 on invented turns), and the eye that labels pictures had no language rule. The board's own model now names the language from V's words, once for each reply and beside the run; the name goes to the director (rewrites such a page 9 of 10) and to the eye. A `title` operation writes a page's title again. On the Candidate's own page a page opened in French was Chinese with its title on the second run after V's first Chinese words. The relay socket sends a line of data with each ping (a second call was cut 16 s after V's last word with pings on) and the page reports `silentMs`.
- The first characters of every reply are no longer cut off: GPT Live's voice for a reply arrives before the event that announces it and was dropped until then; it is now kept from where V begins after a pause and goes out first (`media-early`). Whether to look something up is V's own call: a lookup started on the caller's words and given to the model after its reply (tried the same day) is removed, and the delegation policy looks a follow-up up again when the results do not cover the detail asked, and looks up the caller's own or recent matters when unsure. It gives V no words to say: a stricter wording with a sample opener ("我对一下记录") had V open most follow-ups with it and say where its facts came from, and was replaced the same day. On the Candidate (synthetic speech, the same four calls) follow-ups looked up went from 5 of 10 to 9 of 10, first questions from 4 of 5 to 5 of 5, and replies naming the checking or the records stayed where they were before (5 of 21 against 5 of 20; 19 of 47 on the stricter wording). A delegation on this login carries the caller's own words, so the model decides whether and the routing model which tool; the sentence is kept in the call's private record. A call that comes back gives the new call the lost call's last results and its routing model the lost call's last words. On the Candidate the follow-up asked on a call that came back was answered in line with the search made before the cut.
- The relay socket is pinged every five seconds: a call was cut after the service had sent nothing down for 20 s of quiet (no close frame at either end; the page reported it with its next dial). The line V says when a call comes back is in the caller's language.
- Standby (`wake_policy`, `idle_timeout_s`, the lower standby rate) is a public-API WebRTC feature: a call created with either field on the ChatGPT login never starts (no media, sideband 404), so it is not used here. Idle calls are already ended by the 120 s silence hang-up.
- Off unless `VOICE_ENABLE_GPT_LIVE_11=1` and `VOICE_GPT_LIVE_AUTH_FILE` are set. The service reads the access token from that private file and never refreshes it. Robot and speaker endpoints are not offered this model.
- Released 2026-11-24 (above). Measurements and what is not verified: `docs/candidates/gpt-live-11-20261120.md`.

## 2026-11-22 — 语音创作使用当前飞书会话的 Makaron 账号

- 已核验的群聊和私聊使用各自绑定的账号生成图片和视频。首次使用时先注册并确认绑定，图片保存与视频查询沿用原提交账号。
- 积分不足时，V 在通话中说明回原群或私聊认领和充值，到账后由用户明确继续。

## 2026-11-22 — A video does not cut an iPhone call; a call connected again keeps its board

- A page's sound takes the phone's audio from the call: production 11/22 00:33:52 the microphone stopped after a video was played with sound; after #251, which started the viewer's video with sound inside the tap, 01:46:42 and 01:48:15 the call was cut and connected again. In the App, nothing on the page is heard during a call: every media element is muted, its own controls included. The App plays a video's sound instead (build 50, `capabilities.film`: `FilmSound.swift`, the `film` bridge command, `ios/H5/film-sound.mjs`), through the call's own engine beside V's voice, following the silent picture: it starts, stops, jumps and goes round with it, and is put back within 0.12 s. A silent video may start by itself (`mediaTypesRequiringUserActionForPlayback = .audio`), so a made video moves and is heard once as on the web page; the viewer has its own controls. In the simulator's log the web view's GPU process activates a `MediaPlayback` audio session for a video with sound, and none through the whole of the new flow. An older App shows a play mark and plays it silent.
- A call whose connection is lost (not hung up) goes on as another session with its board and its shelf (two minutes; a hang-up lets them go). What it was making is finished, not cancelled, goes up where the call is now, and V there says so.
- The page gave up on the shelf for the whole call after two refusals in a gap; it now goes on asking, and takes another session's shelf whole (ids and stamps may coincide).
- A picture the caller points at ("那个烤鸡的图片") must be what the command works from; a promise to make something that started nothing is caught in more words, and with Doubao (which takes no typed turn) the caller is told the truth; "给我看一下现场的图片" draws nothing.

## 2026-11-22 — A video shows in the iOS App; one close button over the viewer

- The iOS App's web view lets nothing play before a tap (`mediaTypesRequiringUserActionForPlayback = .all`: a silent video too). A made video's frame waited for the video's first frame before it showed or could be tapped, and the first frame waited for a tap: it stayed on "马上就动" (production 11/22 00:44, the first video of a call; a later one showed because the caller had tapped the page). A video that is refused now shows the picture it was made from with a play mark, can be tapped, and is started inside the tap; the viewer starts its video as it comes up. The video starts silent and takes its sound once it is moving, where the page may start sound by itself (not in the App, whose call audio is its own).
- The App lays its settings button over the top right corner of the page, above the viewer's close button: both showed, and a tap there opened the settings. The viewer tells the App it is open the way a document being read does, and the App takes its button away.

## 2026-11-22 — V is not cut off by its own voice on a loud phone speaker; an uplink stall no longer ends the call

- Echo: on iOS speakerphone at high volume in a quiet room (11/21), a little of V's playback got past the phone's echo canceller. The reply had been generated 1–2 s earlier (it arrives about six times faster than it plays), so the duplex model took 2–4 recognised characters of what V was saying for a new utterance, answered it, and its answer replaced and cleared the reply still playing (five of the call's cuts). The iOS audio path is unchanged since build 32 and V's playback is the canceller's reference; this is residual echo, not a missing reference. Now, on the phone, while the client still reports V's reply playing, a final utterance of at most four characters (or words), most of which are in that reply, is V's own voice: the reply goes on, the client's local hold is released (`input.speech.ignored`), the model's answer to it is never played or captioned, and the words are kept in the call log as `playbackEcho`. Explicit requests to stop (停, 等一下, 不对, …) always interrupt. Replayed over a month of phone calls: 9 of 510 caller turns would have been treated as echo, all short scraps 2–5 s into a reply. `VOICE_PLAYBACK_ECHO_GUARD=0` turns it off.
- Board lessons: on a native duplex call the lesson (speech the service speaks for us) was cancelled at the first sound the model heard, so a loud speaker's echo stopped lessons after 8 s and 11 s of 40 s and 30 s (11/21). It is now cancelled only when the utterance is recognised and is not V's own voice; the lesson's caption is what the echo guard compares with. The model itself still holds a lesson while it thinks someone is talking, so echo that reaches it at a lesson's start can still delay it: only less echo from the phone fixes that.
- iOS App on a stalled uplink: the App ended the call once 96 KB (two seconds) of microphone audio waited to be sent; the web page sheds new frames instead and ends the call only after 30 s without draining. On 11/21 the App's connection (through the phone's proxy) stopped answering pings for up to 21 s and the App hung up (`audio.upload-overflow`, `call.failed`), while capture and the main thread were on time (frames every 23 ms, at most 36 ms late). The App now follows the web page's rule, and takes the numbers from the call's native runtime policy (`upload`, from `lab/gpt-live-h5/upload-backpressure.mjs`, shared with the web page), so they can be changed on the service for every client. Older Apps ignore the field. Takes effect with the next App build.
- Uplink stalls: the gaps (`input-paused`, up to 14 s) were the phone's connection stalling on the route to V, not pictures, the page or the service (24 s of CPU in two hours; the phone's own 1.3 s capture and 2 s send limits never tripped, and the audio arrived afterwards in one burst). After a 13 s stall the burst passed the 10 s input limit and the call closed as provider-error; the input is now kept to its newest 4 s and older audio is dropped. While a burst is still being fed the input is no longer paused and resumed four times a second, which cut an utterance into pieces that were never answered. New `input-burst` (how long the uplink was silent, how much audio then arrived within a second, how much was dropped) tells a network stall from a phone that stopped sending.

## 2026-11-21 — What V makes goes up on the board; one rule for what V does itself; places ringed on photographs

- Both are on wherever the call board is on (`VOICE_BOARD_ASSETS=0` / `VOICE_BOARD_CANVAS=0` turn one off): no change to production's private configuration.
- The shelf of made things: a picture or video V makes in a call is on the board from the moment it is asked for (a sketch, then the picture, then the video in the picture's own frame); the voice model is told what is on the caller's screen and names things by id or by name; found photographs can be the reference of what is made (lent under private half-hour addresses, small ones enlarged); several references; one viewer for found and made pictures, with save; V says a thing is ready the moment it is on the screen.
- A video's script is rewritten by a director's pass on the board's model, shown the reference pictures (`VOICE_MEDIA_SCRIPT`): shots that add up, an ending the caller named, one take for a quiet picture; 32 cases run by rule and filmed.
- V's own image is a standing picture of the shelf (`--image v`): V's canonical avatar.
- One rule for what the voice model does itself and what goes to the backend, in place of a rule per kind of task: is everything at hand, can it be done in one go, does it touch only this call (`VOICE_HANDOFF_RULE`). Backed by code in four places: a request that names something not at hand is not drawn from words (`material-check.mjs`), a reference that is not on the screen, a lookup refused for lack of access, and a video over fifteen seconds all point to the backend. 62 routing cases on the real voice model with stand-in tools: 104/124 before, 125/130 after (`docs/research/voice-routing/handbook.md`).
- The canvas (from `claude/board-canvas-live`): what can be seen goes up as a large photograph and the places V talks about are ringed on it as V reaches them.
- Nothing is drawn for a request that only asks for pictures to be found; found photographs of the same name go by their row.

## 2026-11-21 — No more blank call page from a gallery

- A gallery measured its names' height from the page as drawn and set its rows from it: a narrow picture's name went to two lines with smaller pictures and back to one with larger ones, every render, until React stopped ("Maximum update depth exceeded") and the whole call page went blank (production 11/21 15:28, after #242 made pictures arrive together; Tianyi had seen it before). The names' height now only grows for one set of pictures, and a gallery takes at most a few size changes a frame.
- The board is guarded: a piece that fails to draw takes only itself away (then the page, then the board), and is tried again on the next change; the call page, conversation and controls stay (#243).

## 2026-11-21 — Pictures of a page arrive sooner and in order

- The image search (free plan: one request a second, 2000 a month) is queued by arrival: the next request waits for the answer to the one before; a single refusal no longer doubles the gap for a minute, and the refused search takes the next turn so pictures come in the order V speaks of them.
- A small picture (the search's own thumbnail) is taken over a large original that arrived a moment before it (1-2.5 MB originals took seconds more to reach a phone); each file has 3.5 s before the next results are tried.
- Candidate probe, six searches of one page: last picture 16.6 s → 7.7 s, files 15-170 KB (#242).

## 2026-11-21 — The call record keeps why a call ended

- The call record (transcript log) kept only the call's identity on call.closed and dropped provider-status stages it did not know: the reason added in #239 and the voice service's own "upstream-closed" never reached production records. They are now kept: `why` (one of the service's own words) and up to six short fields of what the service said (#240).

## 2026-11-21 — A call records why it ended; picture search tries past dead links

- call.closed records which way the call ended (client-closed:<code>, provider-upstream-closed, provider-error, host-ending, …); a SeeDuplex session.closed we did not ask for is reported as call.provider-status "upstream-closed" with what the service said. (Call 9caf5e1b ended 0.14 s after the caller's turn with no record of why.)
- When the three best image-search results cannot be fetched (a site that refuses other sites), the next ones are tried, up to nine (轰鸣月, 波荡水) (#239).

## 2026-11-21 — Picture searches the image search answered are no longer thrown away

- Results qualify on their own score (their place in the list only orders them); words the search asks for (海报, 同人, mega) are not held against a title; guide, data and download pages are; a Chinese title must name the thing (half its characters: 超夢 for 超梦), and an English title sharing no word with a several-word search for a Chinese name does not count for it.
- A search that finds nothing worth fetching is tried without its kind-of-picture words (截图, 官方宣传图, fan art…), then without its last word (GTA6 searches like "GTA6 预告片 露西娅 杰森 同框 截图" found nothing at all).
- An encyclopedia redirect to an article about something else is not the thing's picture (凯路迪欧 → 第五世代寶可夢列表 gave the Pokemon logo).
- Rerun of the 77 searches made in production on 11/20: 77 found (was 65), none of the 65 lost (#237).

## 2026-11-20 — A gallery drawn again keeps the pictures that were found

- Asked for "more pictures", the director redraws the gallery under the same item ids; the gallery remembered failed pictures by id and hid new pictures that had been found (production call dfbb0ead: V described six, the page showed two). Failed pictures are now remembered by search, and tried again when the gallery is drawn with other searches.
- The service answers 503 for a picture it could not look for just now (the image search refused or timed out) and 404 for one there is none of; the page tries a 503 once more after 2.5 s and does not keep it.
- A request the image search refused (429) is asked again through the one-a-second queue, twice at most, with twice the gap for a minute: the retry used to go out beside the next queued request and be refused again (#234).

## 2026-11-20 — Gallery pictures whole and large; pages drawn smaller fit; pictures open large

- Gallery pages (`look: "gallery"`) show each picture whole, at its own shape, in rows of one height that fill the page's width (`galleryLayout`: the breaks that make the pictures largest within the height the page has, none made tiny for another). On a wide page the gallery takes the whole width and the notes go under it side by side; once a picture shows, the page's lead print steps aside. Wide page, 4 pictures: ~245 px tall, whole (were ~160 px, cropped to 4:3, in the left half).
- A page drawn smaller to fit (`useFit`) no longer grows taller than the panel: its min-height was `100% / zoom`, which in Chromium and WebKit made a page at 0.62 1.6 panels tall, its content low and its bottom cut off. A long page on a wide panel now fits at ~0.83.
- Every picture on the page opens over the whole window when tapped or clicked, with its name under it; a tap, the close button or Escape puts it back (#232).

## 2026-11-18 — "Show me some pictures" is a gallery of real photos

- Picture requests go to the lesson tool (real photos), not to the backend (which generated one in call 7f8f18da); V does not say it is finding something without calling a tool. The lesson writer shows the pictures instead of explaining where to find them and, since it cannot see them, says only what each is of. The illustrator draws a list with `look: "gallery"`: 4-6 pictures, each its own specific search, large, two to a row, appearing as the voice reaches them; a picture not found is removed with its name (#229).
- `scripts/candidate/photo-compare.mjs` compares the board's picture sources on the same queries (Brave image search vs Wikipedia plus web_search share pictures).

## 2026-11-15 — Lessons start sooner; the phone's line shows nothing ahead of the voice

- The lesson's holding line is "好，我讲讲。": the script waits for it to be said, and Doubao's longer lines took 2-3 s. A lesson starting no longer cancels the title and print being drawn for the question. The cue writer writes a line at a time ({say, show}) and its first two lines start the page while the rest is written (`VOICE_BOARD_EARLY=0` turns it off). Candidate: V starts 4.3-5.1 s after the question (was 5.1-6.7 s), the page is ready before V speaks in 4 of 5 lessons. Timing per lesson: `scripts/candidate/first-content.py` (#225).
- The line under a phone's cue page shows the caller's question until V's voice reaches the reply, stays on the last sentence heard when the voice stops, and shows a long sentence in pieces cut at semicolons and commas (#226).

## 2026-11-15 — The board follows cues the illustrator writes

- V's words reach the streaming illustrator cut into numbered clauses at punctuation, and every piece, arrow and pen mark it draws says which clause it hangs on (`cue`; -1: shown at once, while V is still saying it will explain). The service turns a cue into that clause's own words, so the page shows each piece when the voice gets there; nothing is moved by name matching any more (`board-cue.mjs`). `VOICE_BOARD_FOLLOW=word` keeps the old way. Offline comparison and call measurements: `docs/research/board-follow-by-model/`.
- On a cue page what V has not reached is hidden rather than drawn pale, and V's text is not put on an empty page.
- The lesson writer tells every listed thing as fully as the others, and things that can be seen get their own pictures (a list with images) rather than drawings.
- Phone: under a cue page one line of what V is saying at this moment (from the voice cursor; the caller's question until V answers); a tap opens the whole conversation, and the board's report button opens it there.

## 2026-11-14 — iPhone: the board follows the voice as on the web

- The iOS App reports how far its own audio has got (`audioProgress`: received and still-queued PCM bytes, build 46, `capabilities.audioProgress`), and the page follows the voice with the web page's cursor. An App without it (build 45) follows the voice by time from when V began the reply, instead of showing every piece at once.

## 2026-11-13 — The call board: V draws as it explains

- With `VOICE_BOARD=1` a call has a board beside the conversation: a canvas of pages drawn by one streaming illustrator (DeepSeek, `DEEPSEEK_API_KEY` directly or through OpenRouter), each piece shown when V's voice reaches it. Blocks: photo, list, steps, compare, stats, bars, table, flow, tiles, formula, timeline, versus, overlap, stack, scale and `draw` (a sketch of plain shapes). Pages stay for the whole call; a follow-up opens a page from the one it came from, or returns to it.
- With `VOICE_BOARD_LESSON=1` the voice model has `explain_on_board`: a script is written for the request (after a search or memory lookup when the request needs one), V says it once, and the page is drawn from it. V finishes the line it is on before the lesson starts.
- A finished background task is told the same way: one script written from its result, drawn as it is said, with the full report one tap away on the board. `VOICE_BOARD_RESULT_LESSON=0` keeps the old read-out.
- `VOICE_BOARD_AUDIENCE=all` opens the board to Feishu, public and guest callers (default: the owner's entry). A lesson looks things up only with a tool that caller was given, and calls that are not the owner's keep no words or pictures in the board record.
- Photographs: `VOICE_BOARD_BRAVE_KEY` for image search, a disk library under `VOICE_BOARD_PHOTO_DIR`.
- Old functions are unchanged with the board off, and with it on the model's own choice of tool stands (`VOICE_BOARD_REROUTE=1` restores rerouting other tools into a lesson). `scripts/candidate/board-bench/` measures reply, picture and lesson times, the kinds of picture drawn, and whether the old functions still go where they went.
- iOS: the App relays page features through one bridge command, `service` → `/api/page/<name>` (build 45, `capabilities.pageRequests`). The board is the first; later page features ship with the service and the page, without an App update. Older Apps keep working without the board.
- Seeduplex input pacing: a frame whose timer fired late used to move the schedule back for good; on a busy process the model heard the caller up to ten seconds late and the call ended with "pending input audio overflow". Lateness is now made up, and a backlog is worked off faster.

## 2026-11-13 — 中号小组件显示套餐已用进度

- iPhone build 44 的 4×2 左侧显示最低剩余额度，右侧用和 2×2 相同的已用数字和进度条显示其他套餐，每项下方保留重置时间。

## 2026-11-12 — iPhone 主屏订阅用量

- V Voice 1.0.0 build 43 可在主屏查看个人套餐用量和重置时间。中号突出余量最低的套餐，大号显示各套餐的有效窗口，中号和大号也显示 DeepSeek 余额。

## 2026-11-12 — Call images use Nano Banana 2.1; no empty minutes card

- Images made in the call now use Makaron `gemini-2.1` (Nano Banana 2.1) instead of `gpt-image-2.6-flare`. The voice instructions name the new model and the executor guard only accepts it.
- A call that ends with no saved turns and no pending tasks no longer sends a Feishu minutes card. The status card is still edited to ended; the report is saved with `summaryState: 'empty'` and audit `call.summary-skipped`.

## 2026-11-12 — Dial overlaps admission, reads and the Doubao connect

- A dial starts the tool catalog read, the history read and the Doubao socket while Gateway admission is still in flight, using the conversation this identity was last admitted to as a non-authorizing hint. The reads are adopted only if admission returns the same session and agent; otherwise they are discarded. Admission, per-request membership checks and the one-second handoff window are unchanged.
- The greeting is requested when the page owns the dial connection and spoken at ready. With microphone permission already granted, capture starts alongside the dial; GPT Live session creation gets the same overlap.
- Stage audit adds `admitted` and `prefetch-failed`. With overlap, `elapsedMs` counts from the dial, so it includes admission.
- Measured on V below the HTTP entry, 6 alternating real Doubao dials per tree against `9eb75eb`: ready median 2.36 s → 1.06 s, first greeting audio 2.84 s → 1.49 s. Not measured: real phones, the web page, GPT Live, speakers. The remaining floor and the tail are one platform membership check. See `docs/experiments/dial-overlap-20261112.md`.

## 2026-11-12 — Call images use GPT Image 2.6

- Images made in the call now use Makaron `gpt-image-2.6-flare` instead of `wan2.7-image`. The voice instructions name the new model, and the executor's model guard only accepts it, so Wan 2.7 requests are refused.
- Video (fal-h3-max), the exec/process flow, timeouts and presentation are unchanged.

## 2026-11-05 — StackChan back on the Shanghai node; natural reactions

- StackChan moves from the private V candidate (trycloudflare, Singapore) back to the Shanghai devices node. Over the international tunnel the xiaozhi handshake took about 9.6 s against the firmware's 10 s server-hello timeout, and some wakes dropped about 1 s after `ready`.
- Merges vegekyd-sys/v-voice#135: the camera stays a foreground `look` tool, and photos must match the current call and capture. Nod and shake come from the shared reaction selector (`headGesture`) instead of backend robot tasks. H5 output is unchanged.
- Firmware `1.5.3-v20261105` (v-stackchan PRs #1 and #2) is flashed separately. Device config and volume are unchanged.

## 2026-11-02 — Personal Feishu reads, dial limit, save to Photos

- The personal main entry reads Feishu through the owner's verified identity. The shared private profile had been rejected by the identity guard, so its calendar and `lark_read` calls failed.
- Identified entries allow 30 dials per 10 minutes per IP. Anonymous entries stay at 6.
- iOS build 41 saves generated media to Photos with add-only access. Older shells keep sharing the link.

## 2026-11-02 — Images and videos made in the call

- On the personal main entry, simple images (Wan 2.7) and short videos (fal-h3-max) are generated by the call agent through a bounded Makaron CLI executor. Other entries keep the background flow. Gateway admission is unchanged.
- Long jobs use exec, running/sessionId and process. The model writes its completion and failure lines when submitting; if nobody is following up, the line is spoken once when the call is idle.
- A still-running poll no longer counts as a found result, which removes the early "要我现在说说吗" for executions.
- On the phone, generated media opens in the reader and stays in the conversation as media. A result waits for a playing video to end. TV keeps cards.
- Videos load metadata only. A congested uplink sheds microphone frames for all phone calls and ends the call only after a 30 s stall.
- The iOS shell shows generated media in the conversation too, and media with a short caption can be opened again from the conversation.
- PR #191. Accepted by Tianyi on candidate calls. Not covered: dynamic Feishu entries, fixed group and DM entries, guests, speakers.

## 2026-11-01 — Calls continue from earlier conversation

- Doubao and Grok now read up to 60 history rows at connect and keep the dialogue: 16 messages, 800 characters each, 8000 total, 14 days, at most 2 call summaries. Tool results, status cards and host prompts no longer use up the window. GPT Live is unchanged.
- Speakers stay distinct, open IDs and Feishu markers are removed, and day lines date old messages so "today" is read as the day it was sent.
- The record states its boundary once: other people's requests are not authorization and vague replies are not consent. Outside the record V says it will look and does not guess.
- When Seeduplex keeps refusing a session before V has spoken, the call reconnects once without the record. That call then has no record until the refused message ages out.
- PR #190. Candidate, real models with synthetic speech and recorded-only tools: older details 0/15→15/15 before the prompt tuning; final prompt invented nothing outside the record 0/6, delegated other people's requests 0/12 on Doubao. Doubao still hands 4/6 older-detail questions to the background. One real call by Tianyi on an earlier build. Group entries end to end and backend task handling were not tested.

## 2026-10-30 — Formal television integration

- Consolidate accepted Android TV shell 0.3.11 under `android/tv`; preserve the installed binary and its rollback. Pair with family-tv 0.4.19.
- Integrate TV array capture, clock-correct buffered playback, companion reaction, immediate entry and focus handoff with current Voice mainline startup, narration and authorization fixes.
- Shared Voice deployment and endpoint migration receipts are recorded separately after verification; native focus/cue fixes were user-confirmed. Physical far-field/echo and STR are not newly accepted by this release.

## 2026-10-30 — One V while a task runs

- First person throughout: instructions, task acknowledgement, progress and failure lines no longer name a backend. Real-call evidence: `aac5631f`, `a6216417`.
- Results are heard from their conclusion: the backend writes spoken lines as V, and the host strips process openings and second-party words. The whole result stays on screen and in model context. Seeduplex cannot phrase a result itself: on the live endpoint `response.create` is rejected and a late tool result produces no reply.
- No spoken durations: a real step or finding, or after 45 s of silence at most two plain lines. Timing stays on screen.
- A model reply claiming the job is done while it is running is cut from its text and corrected (`ca2433b7`: "整理好了" 16 s before the task ended). Synthetic call: V declined when pushed; the cut itself has not fired in a real call and is covered by unit tests only.
- PR #186, deployed to both Voice nodes as `899ed2f`; Gateway unchanged. Production synthetic regression: a 39 s real task with no second-party words or durations and its result spoken; 3/3 native lookups answered. Tianyi approved after a real Candidate call. Devices checked by version only; see `docs/releases/one-voice-20261030/release.json`.

## 2026-10-28 — Retired-call cleanup acknowledgement released

- Acknowledge a recently completed call only within its original authenticated visitor context. Existing iOS binaries can clear the pending call after relay-first shutdown, avoiding another HTTP cleanup request before redial; failed cleanup and unrelated IDs remain protected.
- Physical Candidate ABBA: six warm redials per side, cleanup median 271.5→0ms and native transport connected median 1807.5→1485ms; restored Release40. Public transport short test, not Action Button/lock-screen or long-interruption reacceptance. Merged #180 and deployed 4f06888 to both nodes. Production probe removes all three redundant cleanup requests, but total connected median is 1264→1629ms; no end-to-end speed claim. One transient disconnect followed by two successful calls is retained in the release record.
- Same compiled iOS test product, fixed 500ms close delay: three warm-redial samples change from 765/675/672ms to 231/226/200ms, with one redundant request becoming zero. Local protocol evidence only; [acceptance and limits](docs/acceptance/redial-cleanup-20261028.md).

## 2026-10-28 — iOS post-call model catalog released

- Refresh the service catalog through the existing H5 bridge after a cold fast-dial call ends and its page is visible. This replaces the stale native fallback label and options without adding a status request before dialing.
- PR #178 merged and `0d97329` deployed to both Voice nodes; Gateway unchanged. Production HTTPS resources match the artifact and the homepage changelog is verified.
- Eighteen simulator H5/delivery tests pass, including foreground/background hangup, same-binary updates, rollback and redial waiting for cleanup. Corrected an outdated legacy-hangup test, also failing with pre-fix resources, to the already-shipped build40 behavior. Physical iPhone is disconnected, so installed-page receipt remains pending; no native binary update. [Release registration](docs/releases/ios-post-call-catalog-20261028/release.json).

## 2026-10-28 — Call response release / iOS 1.0.0 (40)

- Deployed `a1146b3` to both Voice nodes without restarting Gateway. USB-installed build 40 and internal TestFlight are available. Three physical audio regressions passed; Tianyi confirmed hangup and 20-second insertion normal. Same-session speed comparison did not establish stable end-to-end improvement.
- Release the merged #174 browser one-connection dial and #170/#161/#173 native initial feedback, immediate local hangup, and persistent interruption suppression through integration PR #175.
- Update the visible homepage notes and generated H5 resources. Native changes require build 40; server deployment alone does not deliver them.
- Release validation and physical speed comparison are tracked in `docs/releases/voice-functional-20261028/release.json`. Keep build 32 as the accepted interruption baseline and build 39 as the current before/after phone comparison; no unmeasured speed claim.

## 2026-10-28 — Browser one-connection dialing (candidate, unreleased)

- Use an explicitly advertised web v2 dial socket for SeedDuplex/Grok, keeping live admission, cookie/origin checks and the original input policy. Preserve native v1 and GPT WebRTC behavior. Cancellation closes the allocation; failures never trigger an ambiguous automatic second dial.
- Retain ready/audio frames across reservation handoff. Record bounded timing for upstream ready, first relay PCM and the first nonzero audio-thread render observation; pickup cues do not count.
- Original production baselines and comparison conditions: [experiment record](docs/experiments/entry-latency-20261028.md). No platform dependency, Gateway restart or native binary change. Real end-to-end benefit is pending validation.

## 2026-10-27 — iOS GPT Live One transport contract (candidate, unreleased)

- Preserve the validated `webrtc` transport in the shared GPT session response so the native call owner can select its existing WebRTC backend. Provider secrets and SDP endpoint credentials remain server-side.
- Add a native integration regression through the actual shared HTTP service and two local WebRTC peers, with synthetic PCM, mute/unmute, captions and owner cleanup. Retain the existing native playback and interruption implementations.
- Validation, compatibility and proposed rollout: [candidate acceptance](docs/acceptance/ios-gpt-transport-20261027.md). No merge, deployment, TestFlight upload or paid model call performed.

## 2026-10-27 — Platform-free connection preparation overlap (candidate, unreleased)

- Keep Gateway and platform modules unchanged. Coalesce only outstanding same-subject/conversation admission reads in Voice, with a bounded join window and immediate deletion on success/failure; each request receives its own binding.
- An admitted actor-scoped call starts read-only environment preparation during reservation, overlapping relay handoff. Only that call may consume the one-use snapshot within one second; delayed/failed handoffs read again. Live socket ownership/membership and actual tool authorization still use the existing Gateway checks.
- No provider connection or microphone starts during this preparation. Closing before attachment cannot open a provider later. Voice 1017, speaker 95 and fleet 11 regressions pass; real phone/provider acceptance remains separate.
- See [platform-free acceptance](docs/acceptance/no-platform-latency-20261027/acceptance.md). Platform #499 remains a deferred alternative, not a dependency or a required release.

## 2026-10-27 — Call connection preparation reduction (candidate, unreleased)

- Benchmark against production `b4ed555`: current-release passive connection timings and three live read-only admission/environment probes. These exclude client startup and do not establish end-to-end phone latency.
- Prepare the actor's local read accessor without running CLI identity probes before connection. Validate the installed guard, app and user before every actual read, alongside the existing live Gateway tool-policy check; never use the service owner's account as fallback.
- Connect the speech model and auxiliary interruption lane concurrently, retaining the requirement that both succeed before ready and closing both on failure. Controlled replay with fixed 650/800/600/200ms dependencies: 1605→1405ms median. No claim of physical audio acceptance.
- Add monotonic connection-stage diagnostics. Platform chat/member read parallelism has separate owning-repository changes and live read-only API A/B evidence. See [connection acceptance](docs/acceptance/connect-latency-20261027/acceptance.md).

## 2026-10-27 — Further startup latency reduction (candidate, unreleased)

- Deliver the independent identity bootstrap in the HTML, avoiding a network module round trip before Feishu SDK initialization. The call bundle shares the same startup promise and cannot exchange identity twice.
- Web and native one-connection dialing consume their own just-resolved Feishu admission once; the next request still re-admits, and a request delayed after resolution rechecks before reservation. No cross-request identity cache or actor policy change.
- Controlled 500ms-request browser comparison: 3347→2826ms to dial-ready. Native device-grant protocol fixture: two membership RPCs become one, 1104→553ms to reservation with a 550ms simulated Gateway. These are not physical-phone or provider/audio results. See [candidate acceptance](docs/acceptance/startup-latency-20261027/acceptance.md).

## 2026-10-27 — iOS initial call feedback (candidate, unreleased)

- Create new call feedback without waiting for retired Live Activities; wait and retry only for ActivityKit activity-limit errors. Move shortcut metadata refresh to the rendered, idle foreground scene and move bounded lifecycle JSON I/O off the main actor.
- Add monotonic stages for App/Coordinator initialization, Intent entry, activity request and shortcut refresh. Account binding, Gateway authorization and audio executors retain their existing behavior.
- Native candidate requires a new App binary. Simulator/fixture results and physical-device limitations: [acceptance](docs/acceptance/ios-intent-feedback-20261027/acceptance.md). No device installation, TestFlight or production deployment.

## 2026-10-27 — Voice entry and CLI deployed

- PRs #158, #160, #163, #164 and #165 merged through #167 and deployed at `b4ed555` to both Voice nodes. Main CI passed; matching artifacts, readiness, admission release and unchanged Gateway identity verified.
- V CLI 0.1.0 and the model-visible voice-cli skill installed. Production HTTPS guest authorization/revocation and access boundaries passed; test grant revoked and entry disabled.
- Production logged-in homepage, two-model menu, App binding sheet, visible changelog and immutable code/no-store identity caching verified. No real voice calls, native binary/firmware update or physical App installation acceptance.
- [Production receipt](docs/releases/voice-release-20261027/release.md).


## 2026-10-27 — Voice entry and CLI release preparation

- Integrate approved PRs #158, #160, #163, #164 and #165. Production phone catalog hides Grok, entry bootstrap and code caching improve repeat loading, hangup restores local UI immediately, and the App handoff includes TestFlight fallback.
- Install the private Voice CLI and skill for V. Only the web node enables the managed registry/socket; guest grants and Feishu invitations retain existing authorization boundaries.
- Resolve shared server parameters and regenerate combined browser/iOS resources. No Gateway restart, native binary or firmware update. Candidate measurements are not production performance guarantees.
- Release and post-deployment evidence: [voice-release-20261027](docs/releases/voice-release-20261027/release.md).

## 2026-10-27 — Phone entry latency (candidate, unreleased)

- Prebuild the browser call engine and prioritize its independent Feishu identity bootstrap. Cache only content-versioned application code; HTML, identity exchanges, API status and membership checks retain their existing authorization and no-store behavior.
- Controlled browser comparison: Feishu first/return paths improve by about 25–27%, and an authenticated external-browser revisit by about 42%. These are local simulated-service measurements, not production phone acceptance.
- Candidate homepage notes and validation: [entry latency](docs/acceptance/entry-latency-20261027/acceptance.md). No production, Gateway, native App, firmware or model-list change.

## 2026-10-27 — V Voice CLI candidate (not deployed)

- Add a zero-dependency, discoverable JSON CLI and private Unix control service for managed guest conversations and Feishu login invitations. Support exact binding metadata, bounded expiry, revocation, readback, idempotent retries and private link files.
- Reuse existing Voice access cookies, Public tools and Feishu actor admission. Temporary guest capabilities cannot become independent long-lived device grants; no personal identity is delegated by an invitation.
- Candidate validation and production integration requirements are tracked in [CLI guide](docs/voice-cli.md). No main merge, production activation, real calls or external delivery is implied.

## Candidate — voice-grok-visibility.20261027.1

- Web/H5 与 iOS 服务端模型目录默认隐藏 Grok，测试服务通过 `VOICE_ENABLE_GROK=1` 明确启用。
- 网页采用服务端目录；旧 Grok 偏好在空闲刷新时回退，旧缓存拨号得到重新选择提示，保留当前通话。
- 保留 Grok provider、机器人/音响已有私有白名单和测试能力；无原生 App/固件升级。未合入、未部署。


## 2026-10-27 — Calendar consent policy deployed to Voice services

- PR #155 deployed at `7ce20a2` to both Voice nodes; both ready with identical artifact hashes and admission released. Gateway and private configuration retained.
- SeedDuplex/Grok use the new explicit-request consent and Feishu calendar service rules. GPT Live source is merged, but its Gateway-loaded plugin remains on the previous artifact; not counted as activated.
- Main CI, runtime policy checks, public readiness, browser dial-ready state and visible homepage update passed. Real voice/model/calendar-write acceptance remains untested. See [production receipt](docs/releases/calendar-consent-20261027/release.md).

## 2026-10-27 — Calendar consent and service selection release preparation

- User approved PR #155 for merge and production deployment. Explicit action requests reuse existing consent across backend delegation; retain exact service and request constraints.
- Publish the matching homepage update. Bound Feishu personal calendar tasks retain Feishu service and existing account/tool authorization boundaries.
- Local checks: 968 Voice tests, 95 speaker tests, 11 release tests; no actual calendar write or paid voice call. Production cutover and browser verification are recorded separately after deployment.

## 2026-10-26 — External Feishu login persistence deployed

- Published PR #152 at `0aae20e` to both Voice nodes with matching artifact hashes; both ready and admission released. Gateway and private configuration retained.
- Production account-switch UI and homepage update notes verified. Old unmarked grants need one confirmation; Tianyi confirmed the reported external-login bug fixed on 2026-10-26; individual steps and other terminal/audio acceptance were not enumerated.
- Main CI, 963 Voice tests, 95 speaker tests, 11 release tests and isolated read-only real Gateway admission passed. See [release receipt](docs/releases/login-persistence-20261026/release.md).

## 2026-10-26 — External Feishu login persistence release preparation

- User approved PR #152 for production acceptance. Publish homepage notes for persistent external login, visible account switching and explicit return from Public.
- Deploy the same verified artifact to both Voice nodes under idle/drain protection. No Gateway, native App or firmware update.
- Shared VLab is occupied by an unrelated platform candidate. This Voice-only change keeps the existing authorization protocol; isolated candidate verification against the production Gateway is read-only, with provider/card operations simulated and no calls or messages.
- Production cutover and exact artifact receipts are recorded separately after verification.

## 2026-10-26 — External Feishu login persistence (candidate, unreleased)

- Preserve explicit card-confirmed browser identity across Feishu SDK refusal and page reopening; recheck Gateway admission without extending the existing 30-day expiry.
- Show account settings and identity connection on the dial-ready page. Public remains isolated and offers an explicit route back to the remembered conversation.
- Retain ordinary OAuth rejection, account switching, expiry and membership-revocation boundaries. Old unmarked grants need one new confirmation because their issuer cannot be distinguished safely.
- All 963 tests and local browser login/reopen/Public/switching paths passed with simulated identities. Shared Gateway verification is pending: its integration lease was occupied. No production or TestFlight deployment. See [candidate acceptance](docs/releases/login-persistence-candidate-20261026/acceptance.md).
## 2026-10-29 — TV startup and PCM output clock (isolated candidate)

## 2026-10-30 — TV portrait expands at click (isolated candidate)

- Launcher 0.4.17 immediately animates the existing local portrait to the shared overlay's large bounds while the page prepares. First committed shared frame keeps those bounds, without repeating the small-to-large animation.
- Shared compact entry expands before requesting the call. The large portrait omits status/help text and retains the two connected-call controls; failed calls retain the retry button and accessible action labels.
- Existing audio, call owner, Home and hangup behavior remain; native voice shell stays 0.3.7. Local slow-page fixture verifies expansion before the page and model are ready.

- Bundle the TV entry modules and preload/cache versioned AEC assets. Personalized HTML and dynamic code keep their existing cache policy; the startup owner and entry identity remain singular.
- TV native-array calls render PCM with short-horizon AudioBufferSource scheduling. Twelve real-TV cold-context probes stayed at 0.961–1.009 audio/wall ratio; the previous AudioWorklet path intermittently fell to 0.60–0.63. Pause reclaims unplayed samples; clear invalidates the epoch. Other terminal output paths remain on their existing renderer.
- Track audio/wall clock ratio and missed scheduling deadlines, including when complete PCM remains queued. Earlier no-underflow silence tests did not prove continuous reply quality.
- Native shell and launcher require no binary update. Real model speech and startup measurements are recorded in the installation receipt separately from human acoustic acceptance.

## 2026-10-29 — TV persistent companion (isolated candidate)

- TV overlay mode keeps one fixed companion canvas and scales the existing avatar with a compositor transform through connect, fold and hangup. Native first paint waits for the shared host instead of briefly displaying a full-page fallback.
- Shared owner/generation and call state remain intact while native foreground service hosts the WebView across Home and other applications. Boundary navigation releases focus; Home entry reopens the existing call. A compact persistent reaction provides visible call presence.
- The Android shell owns overlay permission, microphone foreground service and screen-off cleanup. Conversation, audio DSP, avatar reactions and controls remain in shared H5. Compact mode omits waveform subscriptions and native diagnostics are throttled.
- Installed TV candidate uses shell 0.3.7 and launcher 0.4.16. The shell keeps a software-rendered WebView for this TV graphics compatibility; shared waveform paint uses integer pixels. Final six-minute microphone/app-switching and visible-return checks passed; human speech, echo, physical remote and STR acceptance remain separate.

## 2026-10-29 — TV worker audio transport (isolated candidate)

- TV shell 0.2.10 transfers a per-capture message port directly to the shared audio Worker. Native array frames no longer depend on synchronous JavaScript-interface polling or main-thread base64 decoding.
- Keep the existing 25-frame native queue and eight-frame processing/output window. Acknowledgements follow PCM consumption; stale owners and unordered acknowledgements cannot grant credit. Every frame retains its sequence and the existing AEC/gain processing.
- Android instrumented tests exercise the real native message channel, shared Worker and capture controller with synthetic input and repeated main-thread stalls. Hardware installation and sustained-call evidence are recorded separately.

## 2026-10-28 — TV portrait readiness (isolated candidate)

- TV shell 0.2.9 independently acknowledges shared-page presentation after legacy fallback; late initialization can no longer leave the enlarged portrait and controls paused at their first animation frame.
- The local fixture delays host readiness to reproduce the failure; delayed initialization, full/medium/compact navigation and Home cleanup are verified on the named emulator.
- Audio behavior remains at 85d51d1. Tianyi reports live human speech recognition works well; computer-speaker results must not be treated as human-speech acceptance or failure.

## 2026-10-28 — TV call recovery (local candidate)

- Prewarm array AEC before capture; use a versioned prepare/begin/pull hardware bridge with bounded batches and visible failure codes. No PCM is saved.
- Preserve errors before asynchronous teardown, allow immediate retry, and release idle directional/Back navigation to Home. Replace the dialing handset with a cancel label; center connected controls across the portrait base.
- Local simulator and synthetic input only; device installation and acoustic acceptance remain pending.

## 2026-10-27 — TV idle portrait cleanup

- Remove the call-settings shortcut below the idle Reaction portrait and omit its empty glass action group. Active speaker/hangup controls and existing document access remain available.
- Shared H5 update for the authorized installed TV candidate; native APKs unchanged.

## 2026-10-27 — TV first-paint correction (local candidate)

- Render TV layout and transparency in initial HTML before module loading. Hold the native WebView until its committed visual frame and pause entrance motion until presentation is ready.
- Preserve legacy shell/full-page behavior; presentation requires the current owner/generation and never starts a call.
- Local simulator only; no physical TV or online service update.

## 2026-10-27 — TV portrait refinement (local candidate)

- Center the existing Reaction portrait, preserve headroom, remove connector/badge clutter and use the same natural crop in native Home and shared H5.
- Add focus lift/breathing with lifecycle and reduced-motion handling; grow from the Home position on dial and place controls in a separate glass group.
- Provide a true speaker-output toggle in the TV dock. Muted output is consumed without backlog; rendered AEC reference and audible meters reflect silence while microphone upload stays active.
- Local-only verification; physical-TV installation and acoustic acceptance remain pending.

## 2026-10-26 — TV Reaction dock and array capture (local candidate)

- Select Doubao for TV entries; native home actions wait for readiness and dial once without a second confirmation panel.
- Attach the existing Reaction portrait below Settings, enlarge it 3x in a call, show measured orbital audio and keep the same owner through compact/full modes.
- Add an explicit, foreground-only built-in array capability and local WebRTC AEC3 render-reference processing; unsupported array input fails closed. Keep conversation/models/tools in shared H5/Voice.
- Local emulator and synthetic audio validation only. Real TV acoustic acceptance, installation and service rollout remain pending; no Gateway or formal production change.

## 2026-10-26 — Legacy Feishu entry release preparation

- Prepare the authorized release of historical group/DM bookmark redirects and the matching platform menu/tab repair.
- Publish user-visible homepage notes; preserve current-account admission, fixed custom entries, device grants and existing report access.
- Production cutover and runtime receipts remain pending until the shared platform gate and both Voice nodes verify the merged artifact.

## 2026-10-25 — Legacy Feishu browser entries (candidate, unreleased)

- Redirect registered historical group and DM bookmarks to the same canonical conversation before rendering; subsequent browser API requests use that address.
- Authenticate the current visitor; retain fixed custom entries, device grants, callback state and protected API access.
- Validate aliases, unknown/foreign mappings, card admission and browser entry behavior with 36 focused tests. Platform menus/tabs are maintained in a separate PR.

## 2026-10-25 — Feishu confirmation deployed

- Deployed main `ccebd660` to both Voice nodes with matching file hashes; the production page confirms identity in the original Feishu conversation and stays on the same page.
- Real production card confirmation, expired retry, iOS Simulator binding and homepage release notes verified. Shared VLab internal/external accounts in one group and both iOS bindings passed.
- Separate platform PR #473 activated through `v-self-restart`; streams/workers healthy, VLab/V ALIGNED. No new native binary, firmware or paid voice call. See [production receipt](docs/releases/feishu-confirm-20261025/release.md).

## 2026-10-25 — Feishu identity confirmation release preparation

- Place the short confirmation instruction directly below V and above the retained phone button, as V saying “回飞书确认一下，我等你”. Keep the comparison marker visible and the guest action secondary.
- Release the verified card-to-browser identity flow with platform PR #473; internal and external group members retain their own identity and conversation when binding iOS. Server/Web H5 delivery is separate from native Settings styling in a future App build.
- Production authorization received. Use the shared VLab gate, the same platform bytes, `v-self-restart` with busy-abort protection and final alignment; publish the merged Voice artifact to both service nodes. Runtime acceptance is recorded after cutover.

## 2026-10-25 — Feishu card identity confirmation (Candidate)

- Keep the original phone button on arrival. For unresolved identity, clicking it sends the confirmation card, shows an existing V guidance Reaction and a compact return-to-Feishu prompt while retaining the phone button. Apply the verified entry without navigation and invalidate cancelled requests.
- Reduce confirmation to one guidance sentence, a visible comparison marker and a secondary guest action.
- Refine account/conversation hierarchy across Web and iOS; Web top-right opens iOS binding directly, with compact in-page account settings.
- Add opt-in signed Feishu card confirmation for internal and external members using the same conversation URL; retain organization OAuth as an alternative.
- Bind the callback actor to the initiating browser with a short-lived, single-use proof; recheck native Gateway admission and chat membership before accepting identity.
- Reuse existing iOS principal grants so account name, actor identity and group context persist independently per binding.
- Validated with two actual Feishu identities and the installed iOS Simulator app; no real audio acceptance or production release is claimed. Platform callback receiver is a separate dependent PR.

## 2026-10-25 — Unified access modes (candidate, unreleased)

- Group entry presentation into Public, connected accounts/conversations and device permissions. Preserve server-configured fixed caller/account/session mappings and old native grants; devices may reference the same fixed entry.
- Enable the existing Public tool contract for authenticated browser guests, without adding a memory store. Offer explicit Public recovery when private admission fails; never replace a missing/revoked native grant with a browser cookie or replay a private operation.
- Show the selected entry in the actual iOS H5 home and native settings, keeping local removal separate from server revocation. Add HTTP/WebSocket, native and real read-only VLab verification; no production or TestFlight release.

## 2026-10-25 — TestFlight 39: Public and unified saved entries

- Release approved PR #136 after bound-session, native call and switching regression. Preserve existing selected bindings; Public stays first in the common settings list. First-use system preparation can foreground the app; prepared calls retain the Action Button path.
- Public reuses the existing Voice search, memory and task integration. Enable the iOS Public entry on the web/iOS service only; no OpenClaw, Gateway or firmware update.
- Native regression covers local simulator audio/transport and binding state. Physical Action Button, lock-screen, audio and Public acceptance remain pending Tianyi's TestFlight test. Build32 remains the accepted audio baseline; build38 remains available for rollback.
- Stabilize the caption regression by waiting for its actual target caption and explicitly exercising the intent call path for capture, mute, repeated trigger, hangup and redial.

## 2026-10-25 · iOS Public Candidate（未发布）

- Public 复用 V 原有 web_search、memory_search 和后台任务；前后台共用个人内容红线，不创建访客记忆或新任务系统，不更新 OpenClaw。
- Public 后台短结果也沿用原有报告卡片，语音与原生屏幕都可收到正文。搜索、记忆、挂断续跑和取消已通过模拟器实测；子任务等待在原任务内沿用已有工具，通过 Voice 提示词兼容当前 SDK；子任务结果回传和再次挂断续跑均通过，未宣称真机或发布验收。

- 设置页统一通话入口列表，Public 固定第一；保留其他入口的相对顺序与当前选择，整理选中态、账号标签、添加/移除与下方通话设置。
- 新安装使用设备独立的 Public guest 会话；凭证先写钥匙串再请求，超时重试复用同一访客。
- 保留旧入口/当前选择，显示可信账号标签；显式移除本机额外入口，当前入口移除后回 Public。
- 通话期间保留 owner；首次系统权限可转前台，已授权操作按钮仍支持后台。
- 服务端默认关闭 `VOICE_IOS_PUBLIC_ENTRY`；Candidate 与正式部署/真机验收分开登记。

## 2026-10-25 — TestFlight 38: on-demand location and quiet icon startup

- Integrate approved PR #88 and #134. Remove automatic icon mutation; add current-call, one-shot location for authenticated SeedDuplex calls on Web and native iOS.
- Preserve build32 as the accepted audio baseline. Version 1.0.0 (38) is a TestFlight acceptance build; no new physical-device acceptance is claimed. Existing bindings remain compatible.
- Ship the matching Voice service through the dual-node release flow. Leave backend-device bundle configuration unset; do not merge platform #470 or update/restart Gateway. GPT location, background/lock-screen behavior, Feishu WebView and the full DiDi quote flow remain pending.
- User authorized merging and TestFlight delivery while away from the phone. Release and Apple-side processing/group availability are recorded separately in docs/releases/ios-testflight38-20261025/release.json.

## 2026-10-23 — Stop automatic iOS icon changes (candidate)

- Remove the icon-selection call from launch and foreground activation. The previous cache-refresh workaround could show the system's icon-change alert when opening the app.
- Keep both portrait icon sets and shortcut metadata refresh, preserving existing alternate-icon selections and notification/Spotlight/home-screen assets.
- Simulator build, four cold launches and foreground return passed without the alert. Candidate only; no phone installation, server release or new voice acceptance. See `docs/ios/icon-startup-prompt-candidate.json`. Add the user-visible homepage note when packaging the approved native release.
## Unreleased — iOS on-demand location candidate

- Add call-scoped, one-shot Core Location over the authenticated native relay. Attach fresh WGS84 / accuracy / timestamp metadata to the existing V task start or steer/followup context only when requested. Preserve native audio, Intents, H5 delivery and existing tool identity.
- Candidate only; no production/Gateway change, phone install or ride order. Physical background/lock-screen acceptance remains pending. See `docs/ios/LOCATION-PROTOTYPE.md`.

## 2026-10-24 — iOS caller identity, direct calendar and stale content notice

- Persist verified Feishu profile fields into matching, active device grants when the browser prepares a binding. Existing device credentials, expiry and actor permissions remain unchanged.
- Scope new native destinations by conversation and verified account, preventing the installed App from reusing a guest or different account's saved credential during rebind. Preserve old URLs and cookies.
- Show the verified account name in the web binding panel. Version `voice-ios-bound-identity.20261024.2`; approved for production release; no Gateway or native binary change.

- Restore local calendar and allowlisted Feishu reads for verified conversation callers through the installed per-user credential router, with signed Gateway capability revalidation for every query and no personal-account fallback.
- Clear old H5 notices on call ownership changes and ignore late document failures from prior calls. Update the downloadable iOS shell; no native App release required.

## 2026-10-24 — Unified phone entry and App binding

- Render the phone UI at the registered Feishu callback URL and resolve client identity in place. Remove the standalone recognition screen and avoid navigating to a second guest login page.
- Normalize configured App-ID/account-key aliases for both group and verified DM entries. Revalidate existing device grants against unchanged private legacy records, retain their cookie compatibility, and expose one management list under canonical identity.
- Keep the iOS entry available for guests; device grants retain only the isolated guest conversation, with no Feishu identity, group history or account tools.
- Preserve historical report access only for the configured legacy actor. Version `voice-unified-entry.20261024.1`; Human Candidate acceptance passed; approved for unified Voice release. No Gateway or native App change.

## 2026-10-24 — Faster Feishu entry and restored iOS/status paths

- Serve the client handshake in the entry response, inline its bootstrap, reuse expiring app tokens and provider-returned basic identity, and consume the verified one-use admission without repeating Gateway resolution. Publish numeric entry-stage timings without codes or identity fields.
- Restore iOS binding for verified dynamic conversations. Short server aliases remain compatible with installed native clients; one-use/device grants retain the original actor and conversation and recheck Gateway admission.
- Update only server-owned status/minutes receipts through the existing host message contract. Caller sends and tools stay actor scoped. Persist final status delivery state.
- Version: `voice-entry-speed-status.20261024.1`. No Gateway or native App code changes.

## 2026-10-24 — Verified group caller identity within Voice

- Unify old group aliases with dynamic group entries; use the current Feishu client identity or verified browser OAuth. Failed identity falls back to isolated temporary voice without retaining a previous account.
- Supply verified display context to all three models. GPT uses its existing WebRTC developer context channel and waits for acknowledgement before greeting/input; Gateway code and authorization remain unchanged.
- Remove the top-right account name/switch link, preserve the iOS App entry and move optional account connection below the dial area.
- Version: `voice-caller-identity.20261024.1`. Three-model synthetic-speech Candidate acceptance passed; no native App/firmware release or physical-client acceptance is claimed.

## 2026-10-24 — Conversation phone entries without chat-code login

- Remove private-chat verification pages, issuance/status APIs and Gateway challenge handling. Rotate the untagged browser identity format so removed-flow cookies cannot retain account access; fresh OAuth and legacy personal/device bindings remain supported.
- Keep direct temporary voice for unidentified callers, with an optional Feishu account connection. Enforce isolated temporary context and no account tools in the service; naming the caller does not grant identity.
- Use bottom chat menus for new groups and top tabs for DMs. Preserve authenticated native conversation capabilities, signed actor checks and current main's call minutes and shared terminal behavior.
- Version: `voice-feishu-conversations.20261024.1`. Deployment evidence is recorded separately after shared platform integration and the unified fleet release.

## 2026-10-24 — Feishu phone/text capability parity (independent Candidate)

- Use the authenticated caller's effective Gateway tool catalog for phone shortcuts. Keep original Agent skills and CLI access through native tools or backend delegation; no telephone-specific reduced capability profile.
- Verify native tool parity separately in the platform Candidate. New-group and first-ever DM entry acceptance is pending; shared VLab and production are unchanged.

## 2026-10-24 — Durable private-call card targets

- Bind native DM chat IDs in private phone entries and Gateway-authorized OAuth admissions, so status/minutes edits survive mutable session-origin metadata being replaced during real calls. Conflicting receipt chat IDs fail closed; provider message ownership checks remain in place.
- Persist summary delivery state and retain safe post-call styling diagnostics. Cover the real iOS binding/dial/close paths with missing receipt and session chat IDs.
- Operators must verify each legacy DM nativeChatId against an owned message and the exact bot/user before adding it to private configuration. No private IDs or credentials are shipped in source.

## 2026-10-24 — Concise call minutes

- Use the accepted pale-purple 电话纪要 card with topic sections and a lightweight transcript link.
- Generate validated structured summaries without a fixed opening; keep brief checks short, distinguish suggestions from decisions, and preserve disputed facts as unverified.
- Preserve readable report text, historical cards, pending-task notices, failure fallback and quiet iPhone call starts. Recover minutes text from cards for subsequent conversation context.

## 2026-10-24 — Stable build 32 and TestFlight packaging

- Pin the accepted continuous-playback/interruption baseline and retain verified rollback artifacts with explicit regression requirements.
- Include an accurate camera-purpose declaration required by the bundled WebRTC SDK; this audio-only app does not request camera access.
- Prepare build 33 with unchanged native behavior and required-reason privacy metadata for local preferences and elapsed-time measurement. TestFlight availability is tracked separately from packaging. The existing homepage release note still describes the delivered build 32 behavior; distribution preparation adds no user-facing capability.

## 2026-10-24 — Responsive confirmed interruption · iOS build 32

- Separate confirmed-speech corroboration from the old loudness/onset gate. Quiet syllables can acquire a reversible hold after local acoustic or provider confirmation; energy alone still cannot pause playback.
- Add bounded service policy for corroboration RMS and duration, with backward-compatible defaults, and numeric speech-classifier diagnostics. Retain ignored-turn resume, old-tail replacement and stale-result protection.
- Supersedes build 31 after user feedback that interruption was difficult. Physical short/quiet speech and echo validation is recorded in `docs/ios/responsive-interruption-build32.md`; Tianyi accepted build 32 and authorized production release.

## 2026-10-24 — Confirmed assisted interruption · iOS build 31 candidate

- Require local speech evidence plus on-device acoustic confirmation or a service onset before pausing assisted playback. Unconfirmed room sound no longer causes repeated 1.8–2.6 second pauses. Preserve recognized interruption, ignored-turn resume and old-tail replacement; handle either signal ordering with a bounded confirmation window.
- Guard duplicate WebSocket ping callbacks during teardown. Keep build 30 rollback material and record physical-device validation separately in `docs/ios/confirmed-interruption-build31.md`.
- Candidate only; server deployment and user acceptance remain separate.
## 2026-10-24 — Shared terminal behavior

- Share natural search acknowledgments, native dialogue policy, background progress and result recovery across Web, iOS, StackChan and speakers. Keep microphone routing, playback, display and physical-device capabilities in adapters.
- Add receiver-matrix regression coverage and include shared lookup recovery in the fleet artifact. Candidate regression verified; physical-device audio acceptance is separate.

## 2026-10-24 — Quiet iPhone call start

- Recognize verified iOS device grants on HTTP and fast-socket dialing. Skip the live Feishu status card for App calls, including Action Button, while preserving transcript storage and the hangup summary.
- Browser calls retain the live timer. No native App install, Gateway change, or chat notification setting change is required.

## 2026-10-24 — iPhone handoff dialog production release

- Ship PR #105 on the existing production baseline: a compact phone illustration, explicit destination conversation, and one primary “在 iPhone 上继续” action.
- Fold installation, manual link copy/regeneration and bound-device management into secondary disclosures. Keep explicit App verification and existing bindings unchanged.
- Native audio candidate PR #106 and the separate multiuser candidate are outside this server release.

## 2026-10-23 — Private-call status card repair

- Use the native Feishu chat ID for timer and hangup edits: take it from the exact send receipt, or resolve the canonical session and verify its agent, bot and direct-user identity when older adapters omit it. DM delivery still uses its original user ID, bot and canonical session. Missing or mismatched receipt targets fail closed; the transcript and summary remain available.
- Verify the actual DM send/edit contract, elapsed updates and final duration, and retain group behavior. This hotfix is based on production `594e3c5`; unrelated multiuser candidates and native audio changes are separate releases.

## 2026-10-23 — Feishu multiuser phone, shared VLab validation

## Candidate — 2026-10-23 · iPhone handoff polish

- Redesign the web iOS App dialog to match the native binding journey: a compact phone illustration, explicit destination conversation, and one primary “在 iPhone 上继续” action.
- Collapse installation, manual link copy/regeneration, and bound-device management into secondary disclosures. Keep explicit App verification, existing-session retention, and all binding authorization unchanged.
- Candidate only (`voice-ios-handoff.20261023.1`); no production deployment or native installation in this change.


- Add OAuth-authenticated dynamic conversation entries and signed actor-scoped Gateway requests, preserving current Feishu text routing and tool policies. Disable personal host shortcuts for these callers.
- Apply the same server-owned identity checks to HTTP and one-connection native dialing. Preserve PR97/98/101 startup improvements.
- This version is authorized for shared VLab validation only. Production and real multiuser audio acceptance remain unchanged/pending.

## 2026-10-23 — iOS guided binding and saved conversations · 2026-10-23

- Replace the binding form with a three-step native journey: connect a conversation, configure the Action button, then “替代 Siri 的第一步：enjoy”. Show the journey on first launch without a binding; existing users enter the phone directly. Prefilled handoffs use a focused confirmation state and fixed primary actions.
- Save multiple verified destinations in the device-only Keychain. Validate before switching, reuse saved grants without replaying a handoff, preserve other destinations on refresh/removal, and block changes during a live call. Existing single records import automatically; the selected record remains readable by build 25 for rollback.
- Keep conversation management in the top-right settings. The existing “和 V 通话” intent follows the selected conversation; Action button assignment remains the user's system setting. No automatic dialing during onboarding.
- Native build 29 combines this setup with build 28 fast dialing. Simulator validation, installation and physical acceptance are recorded separately.

## 2026-10-23 — One-connection native phone dial

- Add an authenticated, versioned WebSocket dial path that shares the existing exact-session check, admission lock, rate limits and per-conversation ownership with HTTP dialing. Reserve and attach on the same connection; cancellation releases only its own reservation.
- iOS build 28 remembers the advertised capability per binding, accepts the owned reservation before provider events, and waits for real provider readiness. Definite pre-reservation authorization/unsupported-endpoint failures can use the legacy refresh path; ambiguous failures do not automatically double-dial. GPT and older clients remain on their existing transport.
- Load the tool catalog and current conversation context concurrently. No idle provider prewarming, microphone recording or VPN changes.

## 2026-10-23 — Remove full-store reads from phone dialing

- Verify each configured conversation with the existing exact `sessions.describe` read, replacing `sessions.resolve` which reads the entire agent store. Live read-only comparison: resolve 5134 ms; describe 178 ms, then 8 ms with derived titles/last message disabled.
- Keep verification uncached and reject missing sessions, canonical-key mismatches and wrong/missing agent identity before creating media.

## 2026-10-23 — Background dial startup and Feishu entry latency

- iOS build 26 prepares SeedDuplex/Grok capture while the user-triggered recording intent is fresh, before waiting on network setup; pre-connect PCM is discarded and setup failure releases capture.
- Authenticated explicit Feishu phone links render the phone page and its initial status directly, preserving identity checks while removing one redirect.
- Persist bounded audio startup failure stage/error codes for device diagnosis.

## 2026-10-23 — Production binding and all-group rollout verified

- Release PR #95 to both Voice nodes at `8e8dc76`; verify writable private state in each running service namespace and preserve the prior call report. The same App now binds the designated production group successfully and retains it after relaunch. Physical-phone retry remains separate.
- Install and read back all 417 current group menus with unique URLs and exact canonical sessions; install the current-user DM tab and verify native Feishu UI. Future first-entry auto-tab handler activation still awaits an idle Gateway restart.

## 2026-10-23 — Repair production App binding persistence

- Return a storage-unavailable error when the device grant cannot be saved, instead of reporting an expired handoff. Failed persistence leaves the previous App session unchanged; retry after storage recovery is covered by the HTTP regression test.
- Store production App bindings and call reports in the service's private writable StateDirectory, preserving the read-only application and OpenClaw directories.

## 2026-10-23 — Make App session switching explicit

- Name the target conversation and the exact native “验证并绑定” action in the browser handoff. Opening the App alone keeps its previous binding; the page now makes that state visible before the user dials.
- Prepare per-group production entry expansion without changing native credentials, session authorization or existing bindings. Group installation and actual device acceptance are tracked separately from this UI change.

## 2026-10-23 — Session phone production release

- Publish the accepted PR #2 session phone path and PR #90 DM/status/summary fixes together. Each registered group has its own server-owned session and public login URL; V Backup is the acceptance group, never a shared fallback for other groups.
- Update the actual homepage release notes for session context, one live status card, first-person call summaries, durable Feishu login and build 25 binding. Existing native build 25 needs no reinstall; a candidate-bound device must bind the production entry separately.
- Roll out one verified artifact through the dual-node Voice release controller. The separate platform phone-tab event handler requires its own Gateway integration/restart; the Voice service switch itself does not.

## Candidate history — DM call lifecycle and summary reliability · 2026-10-23

- Apply the existing compact status/summary flow to explicit DM phone entries. Keep same-message elapsed/ended updates and suppress per-turn Q&A cards during calls.
- Use “V正在电话通话” and “V电话通话已结束” consistently.
- Set Grok 4.7 short-summary reasoning to low, retry transient/truncated responses once, and preserve safe failure diagnostics after the call ends. No native iOS change.

## Unreleased — Refined call status and summaries · 2026-10-23

## Unreleased — Session phone access and iOS handoff · 2026-10-23

- Keep Feishu browser identity in an authenticated encrypted 30-day cookie across service restarts; revalidate current allowed actors and entries on each request. Provider tokens remain transient.
- Align the iOS App link with the changelog; open native Settings with a validated Deep Link and prefilled handoff. Verify and reuse an existing same-session grant instead of replaying a consumed link.
- Configure real TestFlight/App Store download destinations when available; TestFlight distribution remains pending user acceptance.


- Update one compact Feishu status card in place from 正在通话 to 通话已结束, using small grey annotation text and the original message receipt. Show an elapsed clock while connected and retain the final duration after hangup; serialize updates and stop the timer before closing. Use the existing authenticated Gateway operator edit contract; no platform runtime or permission changes.
- Remove summary-card call statistics. Have V introduce and synthesize the conversation as a first-person assistant recap, preserving the distinction between suggestions, agreed decisions and completed work. Keep the full transcript link. Candidate only.

## Unreleased — Voice Q&A cards · 2026-10-23

- Present paired Voice questions and answers as native Feishu cards with a soft purple header, literal question, divider and rich answer. Preserve the existing delivery queue, session routing and duplicate protection. Oversized answers use the existing text delivery path without truncation.
- Decode mirrored cards into dialogue for subsequent Voice context. Candidate only.

## Unreleased — Paired voice questions and answers · 2026-10-23

- Combine the admitted final user question and completed substantive answer in one Feishu message across session and personal entries. Bind responses and background results to the originating question, suppress duplicate completions and retain detached task pairing after hangup. Candidate only.

## Unreleased — Unified personal/session replies · 2026-10-22

- Route the legacy personal entry through the same server-owned reply target and delivery queue as session phones, with an explicit bot-account opt-in. Preserve its fixed session, personal tools, authentication and default disabled setting.
- Remove the visible conversation/reply-sync banner. Candidate playback uses the release's assisted pause setting; the observed call had 23 pauses and zero recorded buffer underflows, so device listening acceptance is still required.

## Unreleased — Session replies in Feishu candidate · 2026-10-22

- Opt-in private conversation entries mirror completed substantive Voice replies and full backend results into their bound Feishu session through the existing Gateway send API. Resolve the configured bot account explicitly and retain the original session key for transcript mirroring.
- Keep audio independent of sends; deduplicate response segments and ambiguous retry keys, omit greetings/progress/interrupted text, and surface delivery failures. Only VLab pilot entries are enabled; production and arbitrary-caller permissions are unchanged.

## 2026-10-23 — Service-only query status update for installed build 24

- Use the shared Web task label 查询网页, so the call status reads 查询网页中. The runtime projects that service-owned label to installed build 24; existing native source and signing inputs remain unchanged. PR #83 / main c009c5b passed CI and was deployed to both nodes with public resource hashes verified. No second native install. Tianyi accepted the query test; phone readback confirms changed policy fingerprint, unchanged installed bundle identity, and the exact published 114-file Web archive confirmed good after an idle app relaunch.

## 2026-10-23 — iOS build 24 native capability bridge

- Delivery: PR #82 / main `b8b71ac` passed CI; both Voice nodes run the same verified 208-file artifact. Signed build 24 was cover-installed and read back, preserving signing/Keychain identity and original build 22/23 rollback packages. Tianyi accepted voice, interruption, Action Button, locked-screen voice and Island controls; phone readback confirms policy cb418111e71a187b and valid microphone input. Follow-up service-only phone proof also passed on the same installed bundle; see the release record for idle update timing.

- Move relay caption/speaker interpretation, notices, task/report presentation and bounded playback policy into the shared Voice service. Negotiate a versioned data-only runtime; native executes existing media and system primitives even without a WK page.
- Discover relay models by declared transport instead of adding a Swift enum case for each service model. Preserve old clients and the separate GPT WebRTC transport.
- Prepare build 24 for the authorized merge, dual-node release and private-device installation. Preserve signed build 22/23 rollback packages and Keychain identity. Bounded local diagnostics record only runtime policy fingerprints and numeric parameters so a later service-only update can be verified without reinstalling.
- Synthetic same-binary acceptance changes service policy between calls; physical installation/background/Action Button/Island acceptance is recorded separately. See `docs/ios/NATIVE-CAPABILITY-BRIDGE.md`.

## 2026-10-23 — Native search acknowledgment shared by web and iOS

- Enable contextual SeedDuplex acknowledgment for phone web_search and memory_search, followed by tool execution in the same turn. No cached start audio, injected TTS or additional model. Explicit VOICE_SEARCH_ACK=off retains the silent lookup rollback.
- Clarify that factual answers require records while a short acknowledgment can precede them. Keep native duplex/multi-person instructions, response ownership, native iOS audio and build 23 island changes.
- Remove strictly duplicate text/details search wrappers without dropping citations or other content; persist bounded numeric timing diagnostics only. Include the new module in release artifacts.
- Candidate evidence, failed iterations and timing limits: docs/acceptance/search-natural-ack-20261023/README.md. Production deployment is recorded separately in docs/releases.

- Delivery: PR #80 merged; main CI passed. Both server nodes run 08eaecf with matching artifacts, public assets and iOS UI distribution verified. Existing native build 23 retained; no reinstallation or post-release physical call. Release approved after the documented identity/TV limitations were disclosed. See docs/releases/voice-search-natural-ack-20261023/release.json.

## 2026-10-23 — iOS build 23 natural speech waveform

- Integrate the user-accepted build 22 baseline with waveform-only medium and large island cards. Keep the native interruption wait fix, Reaction, report entry, mute/end and background Action Button behavior.
- Display 24 measured speech-energy windows with fixed loudness mapping, fast attack and short release; silence settles to a quiet line. No decorative waveform loop or conversation text in either card.
- Tianyi confirmed build 22 acceptance. The missing initial medium card was traced by the user to Sleep Focus; the proposed connection timing change was withdrawn.
- Native private-device release; server deployment and new physical waveform acceptance are recorded separately in docs/ios/versions.json.

## 2026-10-23 — Keep interrupted playback paused while awaiting a reply

- Web and iOS build 22 keep a recognized utterance paused until native disposition or response replacement. The 1.8-second courtesy timer can no longer resume the old answer while a new one is pending.
- Distinguish nonempty completed recognition from empty/failed recognition without sending transcript content in control events. Acoustic-only probes remain bounded; explicit ignored speech resumes retained samples. A later failed probe cannot release an earlier pending recognized utterance.
- Preserve native identity/name context, response ownership, microphone capture, captions, island and farewell drain. No extra model, speaker chain or Gateway changes.
- Validation and release state are recorded in `docs/acceptance/duplex-wait-20261023/README.md`; synthetic fixtures do not establish physical speaker attribution or human listening acceptance.

- Delivery: PR #75 merged and main CI passed. Both Voice nodes run 8136b20 with matching artifact hashes; signed iOS build 22 installed, read back and normally launched on the requested iPhone. Public assets and homepage verified; physical listening remains pending.

## 2026-10-22 — Shared native duplex repair and iOS build 21

- Retire the previous native response when accepted replacement text or TTS starts; send a scoped playback clear before replacement PCM. Preserve listening-aside decisions, ongoing microphone capture, names and background tasks.
- Honor each PCM packet’s own response ID. Reject old/anonymous retired tails and late terminal events instead of relabeling them as the new response. Scope completion and clear events in both web and native playback.
- Remove fixed lookup-start and waiting speech from phone calls, including legacy notice configurations. Existing task UI, real backend progress/results/errors and household-device notices remain.
- Preserve build 20 ownership repair, build 19 captions and accepted island/Reaction behavior. An accepted farewell remains eligible to drain and hang up after response replacement.
- Local simulated-upstream acceptance reproduces failure on the pre-fix shared pipeline in both Chromium and native iOS. The repaired browser becomes silent 37 ms after replacement confirmation, rejects the delayed five-second old tone and hangs up; native shared pipeline passes with capture continuing. No real provider request or recording. Full native 67, core 29, Node 727, Speaker 95 and fleet 10 pass; physical speech-onset sensitivity and model judgment remain separate acceptance.

- Delivery: PR #72/#73 merged; main CI passed; both Voice nodes run 56cfc608 from one hash-verified artifact. Signed iOS build 21 installed and read back on the requested iPhone. Normal launch was blocked by the physical lock screen; human real-call acceptance remains pending. Gateway and original private settings unchanged. See `docs/releases/voice-duplex-shared-20261022/release.json`.

## 2026-10-22 — iOS build 20 playback ownership repair

- Keep native response ownership across host tool notices without a provider response ID, so a new reply replaces the old queued tail.
- Honor confirmed retiredResponseId on audio.clear so late frames cannot restart cancelled speech.
- Both cases fail against build 19 source and pass with the fix; 10 native playback/H5 regressions and 29 core checks pass. Real microphone interruption timing remains a physical acceptance boundary.
- Follow-up delivery to the authorized caption repair; preserve the signed build 19 rollback. See `docs/ios/INTERRUPTION-OWNERSHIP.md` for evidence and limits.

## 2026-10-22 — Caption continuity and iOS build 19

- Keep GPT captions in one stable message when fragments arrive before their native turn identity; attach late fragment finals to their original turn.
- Accumulate Xiaohe/Grok relay text deltas in iOS instead of replacing preceding words, then reconcile the full final caption.
- Preserve original message order across completion in the shared web/iOS UI, Reaction context and display receipts.
- Verified with synthetic native WebRTC, WKWebView and core/web regressions. Merged through PR #68, deployed to the production web entry with asset hashes verified, and installed as signed build 19 on the requested iPhone. Physical real-call caption acceptance remains pending. See `docs/ios/CAPTION-CONTINUITY.md`.

## 2026-10-22 — Accepted iOS build 18 integration

- Integrate the installed and human-accepted joint iPhone build: native background Action Button calls, medium/expanded measured waveform, report links, purple system portrait icons and default/live locked-screen Reaction, alongside native SeedDuplex duplex and GPT Live One WebRTC.
- Tianyi confirmed the three physical island/icon/Reaction checks, then explicitly accepted the version and authorized main integration. Keep the tested/signature-verified build18 artifact and rollback baseline; this merge does not replace the installed binary or deploy the web service.
- Update the owning homepage changelog and generated H5 history. GPT Live incremental-text presentation remains under diagnosis in the separate GPT session, with no fix commit included or claimed here.
- Validation: Core25, native/H5/island62 and service91 passed for the installed code; integration checks and merge identities are recorded separately.

## Unreleased — iOS build 18 joint candidate

- Integrate native SeedDuplex reversible pause/response replacement from main, GPT Live One native WebRTC, and the latest waveform/report island without replacing existing call ownership.
- Supply the exact purple portrait for all system icon roles and register it with the public alternate-icon API only while idle in foreground; refresh App Shortcuts after registration. No uninstall or binding reset.
- Show a default Reaction while connecting, including the shared lock-screen component. Continue semantic Reaction decisions in background using the existing H5 endpoint/catalog, carry forward actual foreground frames and approved continuations, and return control to H5 on foreground entry.
- Keep server Reaction revisions monotonic across H5 reloads while preserving each renderer's requested revision. Foreground and background loops do not run together; stale call/user responses remain rejected.
- Joint simulation and physical delivery are recorded separately in `docs/ios/joint-build18.json`. Physical cache/lock-screen/acoustic acceptance is pending; no automatic real model calls or online release.

## 2026-10-22 — iOS build 17 waveform candidate

- Reuse the medium card's measured waveform in expanded and lock-screen call controls; remove scrolling conversation captions, while unread reports retain the existing title and open-full-report affordance during speech.
- Publish bounded audio snapshots for both card layouts, preserving native capture, playback, Action Button ownership and background report attention.
- Move App Shortcuts icon colors into the documented primary-icon metadata for both iPhone and iPad; request registration again on idle foreground entry. Physical launch-icon cache refresh remains pending, with no uninstall or binding reset.
- Local candidate only; no automatic real calls, main integration or server deployment.

## Unreleased — iOS build 17 GPT Live One candidate

- Add GPT Live One to native/H5 model selection, using the existing authenticated GPT Live SDP and native input policy. One CallCoordinator owns the call; VoiceAudio selects mutually exclusive WebRTC or PCM audio engines. Action Button remembers the selected model.
- Bring GPT caption fragments, native turn ownership, semantic Reaction, backend tasks/results and background report attention into the existing island/H5 presentation. Preserve mute, manual hangup, owned cleanup/reconnect and bounded host-authorized end guards.
- Pin native WebRTC 154.0.0, retain its license/privacy manifest, and preserve the signed build 16 rollback. Local synthetic peer-to-peer audio, system audio backend switching and regression checks pass. Physical GPT/provider audio acceptance remains pending; no paid call, main merge, Gateway change or online web release.
- Public homepage changelog remains at the accepted shipped baseline. The candidate is not advertised as a shipped or human-accepted capability; the prepared release note is in `docs/ios/GPT-LIVE.md` for the approved release.

## Unreleased — iOS build 16 live caption and launch branding candidate

- Show the latest three wrapped lines of V’s current reply in the expanded and Lock Screen presentation while V speaks. Keep Reaction, mute/end and a stable report link; opening text continues the same native call.
- Sanitize URLs before taking the trailing caption window, keep speech captions scoped to the current exchange, and retain the caption privacy setting. This follows incoming transcript updates rather than claiming word-level audio alignment or a manually scrollable widget.
- Register the existing purple portrait under the distinct VVoiceAppIcon resource, set App Shortcut brand colors and use the same artwork in the app-owned connecting card. The system-owned Action Button launch hint and its cache still require physical verification.
- Local candidate only; retains the build 15 signed rollback and existing audio/Intent behavior. No production web deployment or automatic real call.

## Unreleased — SeedDuplex full-duplex phone candidate · 2026-10-22

## 2026-10-22 — Native duplex release and iOS build 16

- Promote the human-reviewed native SeedDuplex candidate: reversible listening pause, response-owned playback replacement, per-call name-binding instructions and accepted-hangup fallback.
- Advertise the preferred phone input policy; capable web/iOS clients explicitly opt in. Legacy clients retain Speaker routing until upgraded.
- Add iOS native reversible AVAudioPlayerNode pause without stopping microphone capture, response retirement and matching ignored-speech recovery. Preserve build 15 report/Live Activity and web-delivered H5 behavior.
- Continuous television and bystander audio can still cause long pauses or unwanted model replies; synthetic tests do not replace physical iPhone acoustic acceptance.


- Native Candidate: after successful end_call, request a native TTS farewell if no audio follows; wait for matching real playback, cancel ending on a continued question, and bound an unavailable farewell instead of waiting forever.
- 原生全双工 Candidate 完成 9 通合成音频整链复测：正常插话可快速停声，但背景误暂停、持续电视抢答、小声迟缓和姓名互换串信息仍未通过验收；未上线。

- Compare provider-owned playback without local pauses against assisted native playback with reversible foreground yielding. Keep a single continuous model session and retire superseded response audio without resetting speaker context. Pure provider playback remains a diagnostic option; measured interruption latency is not accepted yet.
- Tighten the existing opt-in control ASR: partial standalone stop words cannot cancel playback; explicit V-addressed or speech-targeted controls can act early. Final standalone controls settle briefly and are revoked by continuing dialogue, a changed response owner, disconnect or call closure. No new Speaker/Decision chain or account authority.
- Clarify per-call voice/name/fact binding, corrections and other-person addressees in the native phone instructions. Real interference and binding acceptance is tracked separately; no blanket success claim.
- Opt-in native continuous phone audio with `VOICE_PHONE_INPUT_POLICY=native`; keep the current multi-speaker path as the default configuration and explicit comparison mode. Gateway, Worker and tool/account permissions are unchanged.
- Yield browser playback reversibly on sustained speech, retain the exact unplayed queue for noise/acknowledgments, and retire old response IDs when the native replacement arrives. Track speech before the first output and across syllable gaps; bound acknowledgment pauses and recognize explicit stop commands with an opt-in independent streaming ASR while native recognition is behind generation. Keep background work running and discard late audio from the stopped response.
- Verify real SeedDuplex and actual Chromium/WebKit audio output with synthetic input; physical microphone/echo, real-room interference and human acceptance remain pending. Candidate homepage notes and version/evidence are registered under `docs/releases/seeduplex-duplex-candidate-20261022/`. No main merge or production release.
## 2026-10-22 — iOS build 15 background report island

- Present new background reports as the conversation island with a full-text link. Wait for the actual background scene instead of consuming the alert during the inactive transition; treat changed report content as a new delivery after a manual fold.
- Protect the report alert briefly from cosmetic caption/waveform refreshes; explicit mute, fold, end and safety states remain immediate. Recover missed relay deliveries through the existing presentation endpoint while the call runs in background.
- Preserve the build 14 native capture path, remote H5 update shell and original call owner. The system still controls the expanded island's duration; build 15 is installed on the requested iPhone, with physical report acceptance recorded separately.

## 2026-10-22 — iOS web delivery · build 14 physical acceptance

- Add a complete, versioned H5 presentation package to web release artifacts. The new native shell validates, caches and loads compatible updates without recompiling Swift for everyday shared H5 UI changes.
- Pin resources during calls/reading; retain native audio and call ownership across page reloads. Reject stale documents, incompatible/corrupt packages and redirects; fall back to the last ready cache or bundled UI.
- Tianyi authorized merge, production Voice release and a binding-preserving iPhone upgrade. PR #58 and main checks passed; the homepage entry and public UI package are deployed. Build 12 overwrite installation preserved binding and confirmed the published resource handshake. Physical voice acceptance failed (greeting audible, no microphone response); build 13 signal diagnostics reproduced zero input on Bluetooth and built-in routes. At the user’s request the phone was restored to the previously accepted signed build 10, with further repair isolated from that device baseline. See `docs/ios/WEB-DELIVERY.md`.
- With physical Device Hub sharing stopped, build 14 passed user acceptance of Action Button start, lock-screen two-way voice and Dynamic Island mute/resume/end. A cold public UI download reached ready with the published revision. Added bounded signal/upload diagnostics and nonzero conversion/relay tests; core 16, native 46 and service 80 checks passed. PR #59 main checks passed; the main-sourced signed build 14 was overwrite-installed with identical accepted native inputs and binding retained. Delivery hashes are recorded separately.


## 2026-10-22 — V Voice iOS milestone integration · build 11

- Integrate the iOS app into main after user acceptance of real iPhone connection and two-way conversation. Preserve the background Action Button audio path, original embedded H5 UI and current-call Dynamic Island content links.
- Replace the iOS AppIcon with Tianyi's supplied purple headset portrait, imported as an opaque 1024×1024 asset without re-generating the artwork.
- Add the user-visible homepage milestone entry, retaining explicit acceptance limits for new island details and system scenarios. Native capabilities still require binary updates; remotely synchronized H5 delivery is a separate follow-up task.

## 2026-10-22 — iOS build 10 local device candidate

- Package the existing H5 shell with background connection / long-reply attention requests, explicit calling state and wider measured waveform from the separate island candidate.
- Preserve build 9 signed rollback; keep native audio and background Action Button lifecycle unchanged. Device installation and human acceptance are tracked separately in docs/ios/versions.json.
- No web/server production release is included; the bundled H5 update history remains the owning web version.

## Unreleased — iOS island calling and waveform candidate

- Show “呼叫中” in the compact island and “正在呼叫 V” with a cancel action in the connecting card. Keep the existing background Action Button intent and audio lifecycle.
- Stretch the audio waveform across the card using 27 fine columns, real energy history interpolation, tapered edges and short update transitions. Silence, stale snapshots and Always-On stay calm; reduced motion disables transitions.
- Include the prior connection/long-reply attention fixes from `b858899`. Local source candidate only; the physical iPhone still has build 9.

## 2026-10-22 — iOS build 9 local candidate: embedded H5 and Dynamic Island

- Preserve native build 8 as tag `ios-native-build8-20261022`, with its signed archive and IPA retained for overwrite rollback.
- Run the actual bundled H5 DOM, CSS, conversation components, reader, Reaction and sample comparison inside WKWebView. Keep binding/settings and the existing native call/audio owner; page reloads and content navigation cannot dial another call.
- Integrate the separate Dynamic Island candidate: compact status, audio card with measured energy snapshots, conversation/Reaction card, inline mute/end/fold, and a current-call link to the original H5 report reader. Respect lock-screen privacy and stale state.
- Verify source hashes, all 52 compiled widget images, bounded payloads, trusted-frame/current-owner bridge checks and unchanged background recording intent metadata. GPT Live native transport and physical build 9 acceptance remain pending. No web/server release, merge or deployment.

## 2026-10-22 — iOS build 8 local candidate: H5 interaction parity audit

- Restore human captions for speaker-routed calls by consuming speaker.utterance / speaker.decision on the existing relay. Keep consecutive speakers in the current round, stable per-utterance rows, participant names, uncertain-name labels, five colors and listen-only state.
- Restore scroll pinning, compact-portrait latch, recognition recovery notices, bounded thinking hint, task steps and accurate queued-supplement feedback.
- Share the H5 GFM lexer between conversation and report views; give ordinary long replies and media a reader card, retain their Reaction context, resolve relative media and deduplicate assets. Only actual backend documents receive content-shown receipts.
- Add server-driven model availability, Grok voice selection and pre-generated sample comparison with blind listening. A live call takes audio ownership from sample playback. Bundle the owning H5 update history and verify source parity.
- Preserve the existing background Action Button intent, capture engine and PCM relay. GPT Live native transport, the new Dynamic Island Reaction/waveform design and physical multi-speaker acceptance remain incomplete; see docs/ios/H5-PARITY.md. No web/server release, merge or deployment is included.

## 2026-10-21 — Mobile pickup, latency and accepted-turn continuity

- Recheck the current AudioContext before attaching capture/playback worklets, resume a foreground interruption, and replace a system-muted cached microphone on redial.
- Preserve an admitted question, its output gate and recovery deadline until a later request is confirmed. Quiet or undecided acoustic segments cannot cancel its search or spoken reply.
- Wait for the ASR application initialization response before announcing readiness; an initial retry cannot expose an uninitialized listening call. Record bounded ASR response counters.
- Retain only bounded audio lifecycle counters and states for physical-phone diagnosis. No raw audio or device identifiers are added.
- Distinguish active telephone dialogue from far-field room speech. Topic reactions and elliptical task supplements can continue the admitted conversation; heard side speech remains separate from that context. No extra Decision request or tool authorization is introduced.
- Keep uncertain new finals from replacing an accepted reply or lookup. The permissive idle-conversation fallback does not authorize interruption when both addressing and action evidence remain weak; clear requests and confirmed farewells can still interrupt. Retain the bounded addressing probability and interruption state in decision diagnostics.
- Bounded opt-in lookahead (`VOICE_STREAM_LOOKAHEAD=1`): one bounded speculative native lane can hear a new phone turn while the accepted reply continues. Only confirmed semantic admission promotes it and releases queued captions, audio and tools; quiet, stale, expired or overflowing lanes are discarded. Incompatible child/adult treatment retains the conservative fallback. No Gateway or tool identity change.
- On phone pickup, acoustic onset and an unconfirmed identity no longer cancel the welcome. Confirmed caller speech (including farewell) supersedes it; a staged first request can be promoted without replay. Household-device onset behavior is unchanged.
- Physical iPhone acceptance of the preceding candidate confirmed successful conversation, three delivered searches and zero whole-sentence fallback. One mixed-speaker notice corresponded to actual television/background voices, as confirmed by the caller. Fast stop-on-interruption remains a known limitation; this release does not claim it fixed.
- Release scope and candidate/production evidence are tracked in `docs/releases/voice-mobile-turn-20261021/README.md`. Homepage updates are maintained in `lab/gpt-live-h5/changelog.mjs`.

## Candidate - Home entry guidance

- Present missing/expired personal-link guidance under the home portrait, with concise copy and no unusable dial controls.
- Give temporary connection failures a manual reconnect action; keep call-time status separate and preserve existing entry authorization.
- Source integration only; no production activation is included.

## Candidate - Compact multi-speaker status

- Keep the current person and active search/background work on one line; shorten Speaker notices and truncate long names without expanding the footer.
- Show recovery/errors in place of routine work text while preserving the task cancel control and full accessible text.
- Source integration only; this PR does not activate a production release.

## 2026-10-20 - Pickup greeting and retired call ownership

- Retain already streamed audio on a name-only update; speaker, role and addressee changes still prepare a new native persona.
- Correct the personal name to Tianyi / 天懿 in native voice prompts, greetings and tool descriptions; entry IDs and account permissions stay unchanged.
- Restore the native Seeduplex welcome without requiring a registered voice or first utterance; caller speech supersedes a pending greeting.
- Reconcile web entry ownership with the direct transport registry before admission, releasing fully closed calls while preserving live and cleanup-pending sessions.
- Safari latency/redial diagnosis remains separate in PR #33; this change does not claim a fix for it.

# Voice release log

## 2026-10-22 — Unified four-client release

One verified main artifact now targets both the web/iOS and domestic robot/speaker services. Private Unix release control atomically holds new call admission only when calls, creation, delivery and device operations are idle; expiring holds, exact service/configuration checks and guarded rollback protect ongoing work. Legacy bootstrap refuses any existing client connection. The fleet command stages both nodes, retains pending targets, and records runtime hashes plus the iOS UI/client compatibility matrix. Native apps and firmware still require separate installation evidence. See [deployment contract](docs/unified-release.md); production delivery is verified on both nodes at `42ff625` and registered in `docs/releases/voice-unified-release-20261022/release.json`.


## Voice · 20261020 phone stage UI, task progress and held results · source main

- 手机通话界面用 React 重做，V 为主体，一行状态，当轮对话跟在状态下；桌面保持左头像右聊天两栏（#49）。
- 后台任务进行中按真实阶段播报，不在已放行的提问和 V 的回答之间插话（#47）。
- 后台结果交给提问人；提问人不在场时上屏并扣住，他回来后补播，结果不丢（#46、#52）。
- 后台状态读取失败在 120 s 内重试，不再把进行中的任务取消（#52）。
- 手机外放漏回的 V 自己的声音不算另一个人，一次拜拜即可挂断（#51）。

## Voice · 20261020 long calls and robot multi-speaker · source main

- 长通话：工具等待期间不挂断，结果回来后重新计时；慢查询播进度提示，查询失败、结果未播、识别卡住各说一次（#34）。
- 机器人/音箱接入流式多人识别，设备级开关；StackChan 使用固件近场门，服务端门关闭（#35）。
- 一周断线审计与插话回归测试（#36）；本地飞书未配置时不声明日历/飞书工具（#37）。
- Gateway 重启期间启动等待，不再崩溃重启（#38）；设备可配置追问窗口（#39）。
- 网页电话恢复 10-19 的豆包流式多人路由（10-20 02:44 曾回滚到 d37ac851）。

## Voice · 20261019 streaming multi-speaker · source 931c30e

- 豆包流式匿名 Speaker、对话关联姓名和角色、语义接话与原生语音并行；不改变工具身份。
- 主机确认自然告别并等待真实播放回执；挂断和后台任务分别管理。
- 保留正式入口记忆、搜索、Reaction、后台交付和发布空闲检查，GPT Live/Grok 不启用 Speaker 路由。
- 正式公网保留原生20ms上传；云端ASR独立聚合有界100ms，逐字节保持输入顺序及末尾数据。
- 首轮混合验收失败后实际回滚，修正版通过正式产品页混合恢复与后台取消、告别闭环。
- Linux 独立声线进程和模型 SHA256 校验；通过配置关闭，保留原正式产物及独立服务回滚。

## 2026-10-16 — Homepage notes and safe Voice entry publication

Restore the missing October 16 homepage release notes and make product-facing notes a release preflight requirement. Authenticated status now exposes whether active calls, session creation, or pending backend delivery prevents an entry cutover. Persist only bounded causal event metadata and numeric playback counters to distinguish received speech, tool waits and missing output; no tool arguments, result bodies or audio are added.

Production entry `d37ac851` is active, registered in [current.json](docs/releases/current.json). [Platform #396](https://github.com/vegekyd-sys/v-openclaw-platform/pull/396) adds the entry publication guard and verified legacy graceful-drain migration. The old H5 exited normally; no forced kill, Gateway restart or config change. All 177 package hashes and the unchanged plugin bytes match. Candidate checks: 80 Voice and 12 controller tests. The public homepage shows October 16 notes with no browser console errors. Late-result replies and busy natural hangup remain separate unresolved tasks; physical iPhone Safari was not retested.

## 2026-10-16 — Voice #23 farewell wording

GPT Live may say “再见，下次再聊” after an accepted caller hangup request. The page now recognizes that equivalent variant alongside “再见，下次聊”, while retaining host authority, current-user ownership, a terminal assistant turn and actual audio drain.

Production entry commit: `bcb82987c7cc6c61e87ecc9f28c320df6bfb470b`. Gateway plugin stays at `a9ac516860a8856470262957ad6ea0cc2670cb0e`, byte-identical to the new package for plugin/lib/server files; only frontend app.js changed. No Gateway restart or config change.

Both GPT Live and SeedDuplex synthetic natural calls automatically returned to idle with reset transcript and no browser errors. The recorded alternate farewell passes exact replay; live GPT used canonical wording. Physical iPhone Safari and unrelated backend/media tasks were not retested. First entry activation was rolled back after a controller receipt failure; the second passed all original guards. See [registration](docs/releases/voice-bcb82987-20261016/manifest.json), [current version](docs/releases/current.json), and [PR #23](https://github.com/vegekyd-sys/v-voice/pull/23).

## 2026-10-16 — Task continuity baseline

The earlier accepted task-continuity baseline uses Voice `a9ac5168` and the platform core release `v2026.9.1-db91.6-voice-task-continuity-20261016-r3`. Its five core file changes, shared VLab and production child-task/Feishu delivery acceptance, full captures and Voice registration are recorded in [platform release #394](https://github.com/vegekyd-sys/v-openclaw-platform/pull/394).

## Candidate development history

## Candidate · speaker-stream-linux.20261019.5

- 修复后台任务进行中、刚与孩子或另一人物聊天时，自然告别被旧对话重心压住的问题。
- 仅对已选中结束但不够确定的候选追加当前话语确认；普通对话仍为一次Decision请求。
- 告别确认不可用时保持通话；不改变工具权限或取消后台任务。
- 关闭流式多人模式中原生模型抢先挂断的旧路径，主机未确认时不能结束电话。
- 明确取消后台任务或切换话题仍可接话，不被静默门控拦截。

状态：独立 Candidate，未合入及未发布线上。

## Candidate · speaker-stream-linux.20261019.4

- 自然告别优先于多人静默判断；小何原生告别音频实际播放完后才挂断。
- 对旁人道别、引用、否定挂断、告别后继续提问保持通话；新语音可撤销挂断。
- 防止提前、错误或过时的播放回执结束电话；无告别音频时保留电话并允许重试。
- 增加真实语义、浏览器告别、长时重连、媒体并发隔离和重叠后恢复的验证工具。

状态：独立 Candidate，未合入及未发布线上。

## Candidate · speaker-stream-linux.20261019.3

- 修复 ASR 首句零时间戳被省略时漏句，短暂断连自动恢复并校正时间轴。
- Speaker 致命错误及时关闭音频通道，避免继续上传到失效路由；保留已受理后台任务。
- 候选音频按100ms合批，减少消息开销，并记录上传峰值及后台生命周期。
- 独立产品 Gateway/Worker 恢复 Memory Search、Web Search 和真实后台处理，使用私有记忆快照。
- 增加两声线在真实后台运行期间及完成后继续对话的端到端验证。

状态：独立 Candidate，未合入及未发布线上。验收见 `docs/experiments/speaker-background-2026-10-19.md`。

## Candidate · speaker-stream-linux.20261019.2

- 修正跨通话累计判断/音频预算和五分钟静默过期；每通独立限制，最长三十分钟。
- 不确定声线、混合语音和判断失败采用简短澄清；原生已获准问题增加无输出恢复。
- 自动多人静默增加置信度与明确向 V 发问的交叉检查，交接请求简短确认。
- 同人物连接准备复用；较早判断不再取消更新的已定稿问题。
- 新声线需要两个一致窗口，片段内身份不来回改号；已知声线使用有限高置信参考样本。
- 增加有界、无音频/声纹/聊天正文的分阶段诊断，仅用于独立 Candidate。

状态：Candidate，未合入及未发布线上。

## Candidate · speaker-stream-linux.20261019.1

- 将豆包流式多人候选部署到独立 Linux 服务，服务端识人、ASR、Decision 和原生语音不依赖 Mac 或浏览器推理。
- 增加受保护的 HTTPS 候选入口，沿用既有入口鉴权与服务端会话绑定。
- 改善 ASR 漏掉被叫人姓名时，对人际生活实物协作的安静判断；明确向 V 询问能力仍可回应。
- 验证脚本复用授权 Cookie，并逐项检查多人对象、旁话、排他和真实原生音频；失败收据保留。
- 候选首页日志仅在该独立入口展示，正式已发布列表不加入实验能力。

状态：独立 Candidate 已部署，未合入、未发布生产。版本元数据见 `lab/speaker-native/linux-release.mjs`，实际验收见 `docs/experiments/speaker-stream-linux-2026-10-19.md`。
## 2026-10-27 — Background task Feishu visibility release preparation

- Route GPT Live native consultation and shared Voice background tasks through the bound session's unified native Feishu presentation. Preserve the calling identity, task correlation, public progress and result return to the call.
- Keep ordinary speech outside this background-task flow. Integrate the current external-login fixes and publish homepage notes.
- Shared VLab and production acceptance, exact artifact and dual-node deployment receipts will be recorded after validation; this entry does not claim deployment.

## 2026-10-27 — Combined connection and audio release

- Deployed at `7baa878` through #171 to both Voice nodes after main CI passed. Three actual desktop Feishu calls connected and ended; dial-to-connected median 4.862 s. Homepage changelog and HTTPS artifact parity verified; Gateway identity/private configuration preserved. See [production receipt](docs/releases/voice-combined-release-20261027/release.md).

- Integrate Voice-only startup preparation from #169, the shared GPT `webrtc` response correction, and bounded server audio-delivery diagnostics. No Gateway restart or platform update, native binary or firmware change.
- Fix the AudioWorklet syntax error discovered in a real Feishu call: minification serializes the queue as an anonymous class. Bind the serialized expression explicitly inside the worklet and exercise minified microphone/playback processors in regression.
- Candidate suite: 1,023 Voice, 95 speaker and 11 fleet checks. Earlier candidate records below remain historical; physical native audio and Action Button changes are excluded.
- Production versions, real Feishu benchmarks and post-deployment evidence are recorded in `docs/releases/voice-combined-release-20261027/` after rollout.


## TV immediate dial candidate (2026-10-30)

- Home 0.4.18 starts a bounded local dialing cue in the click handler, before the WebView is ready. Shell 0.3.8 hands it off to the shared call sound and stops it on abort/teardown.
- Reassert a transparent native backing canvas at navigation commit and first reveal; keep the overlay root/body/app explicitly transparent. The reported brief white frame has not yet been reproduced in captured baseline videos; this is a first-paint safeguard pending user confirmation.
- Xiaomi remote voice key resolves through its proprietary VoiceControlService. No system key mapping or Xiaoai service changed.

- Shell 0.3.9 provisions the page microphone capability at commit, at most once per navigation, and gates native auto-dial on its acknowledgement. This removes the window where shared startup could select browser capture before the array capability was published.

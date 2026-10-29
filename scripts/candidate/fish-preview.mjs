// UI-only preview: no provider credentials, Gateway or microphone is opened.
import {createLiveH5Server} from '../../lab/gpt-live-h5/server.mjs';
import {createDirectVoiceService} from '../../lab/realtime-direct-tools/session.mjs';
import {FISH_STT_CANDIDATE_UPDATE} from '../../lab/gpt-live-h5/changelog.mjs';
import * as wsModule from 'ws';
const directVoice=createDirectVoiceService({wsModule,fish:{enabled:true}});
const bridge=createLiveH5Server({preview:true,directVoice,enableFish:true,candidateRelease:FISH_STT_CANDIDATE_UPDATE});
const port=Number(process.env.FISH_PREVIEW_PORT??29639);
bridge.server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({preview:`http://127.0.0.1:${port}`,paidCalls:false,fishAvailable:false})));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void bridge.dispose().then(()=>process.exit(0)));

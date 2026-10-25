import {pathToFileURL} from 'node:url';
import {isAbsolute,dirname,join} from 'node:path';
// Platform-owned policy and execution stay in v-openclaw-platform. Only trusted
// host configuration can select that module; the phone supplies no module/path.
export async function loadPublicGuestRuntime(env=process.env){
 const file=env.VOICE_PUBLIC_RUNTIME_MODULE;if(!file)return null;
 if(!isAbsolute(file)||!env.VOICE_PUBLIC_DATA_DIR)throw Error('Public backend requires explicit module and private storage paths');
 const {createPublicVoiceRuntime}=await import(pathToFileURL(file).href);
 const {publicDeepSeekProviders}=await import(pathToFileURL(join(dirname(file),'providers.mjs')).href);
 return createPublicVoiceRuntime({directory:env.VOICE_PUBLIC_DATA_DIR,...publicDeepSeekProviders({apiKey:env.VOICE_PUBLIC_API_KEY??env.DEEPSEEK_API_KEY,model:env.VOICE_PUBLIC_MODEL??'deepseek-flash'})});
}

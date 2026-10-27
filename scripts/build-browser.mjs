// Keep login/status independent of the call engine, while shipping the engine
// as one module instead of a network waterfall of audio/UI/avatar imports.
import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(import.meta.dirname,'..');
export const BROWSER_BUNDLE=resolve(root,'lab/gpt-live-h5/app-bundle.mjs');
export async function buildBrowser(){
  const result=await build({entryPoints:[resolve(root,'lab/gpt-live-h5/app.js')],bundle:true,
    plugins:[{name:'server-static-alias',setup(context){
      context.onResolve({filter:/^\.\/speaker-routing\.mjs$/},()=>({path:'speaker-routing.mjs',namespace:'voice-static'}));
      context.onLoad({filter:/.*/,namespace:'voice-static'},async()=>({
        contents:await readFile(resolve(root,'lab/speaker-native/client.mjs'),'utf8'),
        resolveDir:resolve(root,'lab/gpt-live-h5'),loader:'js',
      }));
    }}],
    external:['./entry-startup.mjs'],format:'esm',platform:'browser',target:['safari15','chrome100'],
    minify:true,legalComments:'eof',charset:'utf8',write:false,logLevel:'silent',absWorkingDir:root});
  return result.outputFiles[0].contents;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const bytes=await buildBrowser();await writeFile(BROWSER_BUNDLE,bytes);
  console.log(JSON.stringify({bundle:'lab/gpt-live-h5/app-bundle.mjs',bytes:bytes.length}));
}

import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const releaseRevision = release => hash(`vvoice-h5-1\n${release.minimumBridge}:${release.maximumBridge}\n` + release.files.map(f=>`${f.path}:${f.sha256}:${f.bytes}\n`).join(''));
export async function createH5Release(root, outputs) {
  const files = [];
  for(const path of Object.keys(outputs).sort()) {
    const bytes = await readFile(join(root,path));
    if(hash(bytes)!==outputs[path])throw Error('Stale H5 output: '+path);
    files.push({path,sha256:outputs[path],bytes:bytes.length,data:bytes.toString('base64')});
  }
  const release={schema:1,minimumBridge:1,maximumBridge:1,files};
  return {...release,revision:releaseRevision(release)};
}

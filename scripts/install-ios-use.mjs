#!/usr/bin/env node
import {readFile,mkdir,copyFile,readdir,lstat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

/** Explicit workspace install. Does not edit a Gateway config or restart a service. */
export async function installIOSUse(workspace,{source=fileURLToPath(new URL('../skills/ios-use',import.meta.url))}={}){
 if(!path.isAbsolute(workspace))throw Error('Provide the exact candidate/workspace absolute path');
 const root=path.join(workspace,'skills','ios-use');
 for(const parent of [workspace,path.join(workspace,'skills'),root]){
  const info=await lstat(parent).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(info&&(!info.isDirectory()||info.isSymbolicLink()))throw Error('Skill destination cannot be a symlink or file');
  await mkdir(parent,{recursive:true});
 }
 const manifest=[];
 async function copy(dir,relative=''){
  for(const item of await readdir(dir,{withFileTypes:true})){
   if(item.isSymbolicLink())throw Error('Skill source cannot contain symlinks');
   const rel=path.join(relative,item.name),destination=path.join(root,rel);
   if(item.isDirectory()){const existing=await lstat(destination).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(existing&&(!existing.isDirectory()||existing.isSymbolicLink()))throw Error('Invalid Skill subdirectory');await mkdir(destination,{recursive:true});await copy(path.join(dir,item.name),rel);}
   else if(item.isFile()){
    const existing=await lstat(destination).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    if(existing?.isSymbolicLink())throw Error('Skill destination cannot contain symlinks');
    const bytes=await readFile(path.join(dir,item.name));
    await copyFile(path.join(dir,item.name),destination);
    manifest.push({path:rel,sha256:createHash('sha256').update(bytes).digest('hex')});
   }
  }
 }
 await copy(source);
 return {name:'ios-use',path:root,files:manifest};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 if(process.argv.length!==3)throw Error('Usage: node scripts/install-ios-use.mjs /exact/workspace');
 console.log(JSON.stringify(await installIOSUse(process.argv[2])));
}

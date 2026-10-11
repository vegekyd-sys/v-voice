#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {writeFile} from 'node:fs/promises';
import {addGroupPhoneMenu,phoneMenuUrl} from '../lib/feishu-group-menu.mjs';
const {values} = parseArgs({options:Object.fromEntries(['chat','phone','origin','base-path','out','profile'].map(key=>[key,{type:'string'}]))});
try {
  if (!values.out) throw new Error('A new private --out receipt file is required');
  // Establish exclusive evidence ownership before any external mutation.
  await writeFile(values.out,JSON.stringify({phase:'prepared',chatId:values.chat})+'\n',{flag:'wx',mode:0o600});
  const api = async(method,path,body) => {
    const args=[...(values.profile?['--profile',values.profile]:[]),'api',method,path,'--as','bot',...(body?['--data','-']:[])];
    // execFile has no stdin option; use spawn for payloads, without a shell.
    const {spawn}=await import('node:child_process');
    const output=await new Promise((resolve,reject)=>{
      const child=spawn('lark-cli',args,{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
      child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
      child.on('error',reject);child.on('close',code=>{
        try {const result=JSON.parse(stdout||stderr);if(code!==0||result.ok!==true)reject(new Error('Feishu menu API failed'));else resolve(result.data);}
        catch {reject(new Error('Feishu menu API response was not confirmed'));}
      });child.stdin.end(body?JSON.stringify(body):undefined);
    });
    return output;
  };
  const url=phoneMenuUrl(values.origin,values['base-path']??'/voice',values.phone);
  const result=await addGroupPhoneMenu({api,chatId:values.chat,url});
  await writeFile(values.out,JSON.stringify({phase:'verified',at:new Date().toISOString(),chatId:values.chat,phoneId:values.phone,url,...result},null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({receipt:values.out,...result}));
} catch {
  console.error('Phone menu configuration is not confirmed; inspect the receipt and app permissions before retrying. No private phone credential is published.');process.exitCode=1;
}

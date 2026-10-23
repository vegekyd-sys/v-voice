// Basic identity only: scopeList=[] requests no calendar/contact/document scopes.
// https://open.feishu.cn/document/client-docs/h5/development-guide/step-3
export function feishuClientLoginPage({appId,state,phone,basePath}) {
  const config=JSON.stringify({appId,state,endpoint:basePath+'/feishu/client-login',guest:basePath+'/feishu?phone='+encodeURIComponent(phone)+'&guest=1'}).replaceAll('<','\\u003c');
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>连接飞书账号 · V</title><style>body{margin:0;background:#f5f6f8;color:#20242b;font:16px/1.7 system-ui,sans-serif;display:grid;min-height:100dvh;place-items:center}main{max-width:440px;margin:24px;padding:32px;background:white;border-radius:20px}h1{font-size:23px}p{color:#626a76}a{color:#20242b}</style><main><h1>正在识别当前飞书账号</h1><p id="status">确认后进入电话。无法获取账号时，仍可作为访客聊天。</p><a id="guest" href="#">作为访客继续</a></main><script type="application/json" id="login-config">${config}</script><script type="module" src="${basePath}/feishu-client-login.mjs"></script></html>`;
}

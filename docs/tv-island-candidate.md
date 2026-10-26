# TV 灵动岛共用 Voice 候选

2026-10-26；分支 `codex/tv-island-voice`。本地候选，不代表生产、真实模型或实体电视已验收。

## 归属与接口

电视展开仍加载同一套 H5，`?tv=1` 只启用横屏布局和 `window.vVoiceTV` 状态投影，不创建第二套通话引擎，也不授予工具身份。Android 薄壳、遥控器和悬浮窗由电视项目维护。

- `snapshot`：只读 `version:1`、页面 `owner`、通话 `generation`、更新 `revision`、`call`、`muted`、有界 `label`、`actions.{dial,mute,end}`。不输出账号、会话密钥或聊天正文。
- `action(name, {owner, generation})`：仅允许拨号、静音和结束，复用页面动作；拒绝旧页面、旧通话和不可用操作。返回 true 只代表请求接受，壳须读取新快照确认结果。壳发送动作时应回传按钮获得焦点/按下时的 owner 和 generation。
- 折叠/展开应保留同一个 WebView 和通话；退出由壳终止通话并释放麦克风。页面没有真实音频能量时不提供假波形。

共用 Voice 服务仅在当前 Gateway 授权目录实际包含电视工具时提供简短电视操作的直接调用指导，Web/iOS/音响/机器人共用。没有改变授权目录、身份或 invoke 检查。未列出的 `tv_command` 不得由兼容工具描述推测，也不能用 exec/ADB 绕过。accepted 不是实体完成；错误、unknown、缓存 idle 或无标题不触发自动重试。其他写操作沿用后台任务规则。

本次使用本地 Candidate：H5 和 Voice 内部策略使用现有接口，不修改 Gateway/Worker/权限。若后续补工具发现或权限协议，须在平台独立 PR 和共享 VLab 验收。

## 本地替身

在仓库根目录运行 `node scripts/candidate/tv-island.mjs`，访问 `http://127.0.0.1:26326/?tv=1`。选择 Grok Voice 3.0；它在本进程中被本地 Model 替身接管，不访问付费模型。

此入口标明“本地演示账号 / TV 替身 · 非真实身份”，只绑定内存模拟身份；Gateway 和模型都是替身。仅支持模拟电视状态、音量；文字“音量调到 15”可经真实 HTTP/WebSocket、共享 Voice 与工具分发路径获得 `simulation:true`、`physical_playback_verified:false`。输出音频为合成测试音，不是语音质量证据。不得将脚本作为真实身份代理或生产服务。只监听 loopback；工具轨迹写在忽略的 `artifacts/tv-island/` 中。

## 已验与未验

- `npm test`：967/967；包含 TV host 的可用性、旧页面/通话拒绝、错误状态、异步失败，以及四端共享电视调用和未授权工具拒绝。
- `npm run test:speaker-native`：95/95；`npm run check:ios-shell` 通过。
- 内置浏览器：1280×720、960×540 电视横屏和 390×844 普通手机布局；账号详情可打开，账号与通话标签可见。
- 本地 HTTP/WebSocket：建立模拟会话、文字触发音量工具、得到模拟工具回执、关闭会话。该项不是麦克风或模型语义验收。
- 电视项目另有 Android 模拟器 9 项流程证据，覆盖展开、折叠保留 owner、静音、挂断和 Home 释放；以电视项目最终组合 manifest 为准。

尚未验收：实际 Voice actor 授权目录中是否出现新版电视工具、真人语音/打断/远场/AEC、原遥控器实体路径、真实电视画面与音量结果。已知节点目录与 Voice actor 目录是不同查询，不能用节点列出工具证明实际调用权限。没有真实电视安装、服务部署、合入或固件变化。

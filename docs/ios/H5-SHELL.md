# H5 内嵌候选

## 保存的原生版

- 原生版基线：`f1f0600`，源码标签 `ios-native-build8-20261022`；原分支 `codex/voice-ios-action-button` 保留在该提交。
- 原开发签名 IPA 和 xcarchive 保存在本机 ignored `ios/build/saved-native-build8/`，IPA SHA-256：`a3393b1a9227f1472d50140b5948e714bd3614a41f70e1a551897387ae3f0bab`。
- 回退时用已保存的 App 覆盖安装，不卸载、不删除绑定。它保留的是 build 8 的实际安装状态；此前人工通过的后台按键结论来自 build 5，不扩大验收范围。

## 本版结构

App 页面直接运行已有 H5：原 `index.html` 页面 DOM、`styles.css`、`ui-bundle.mjs`、`call-view.mjs`、`content-view.mjs`、Markdown、52 图 Reaction 的原 renderer/reactions/telemetry、更新日志和声音对比页。没有重新写一套 CSS 或 SwiftUI 通话布局。设置与入口绑定仍用原生面板。

`ios/H5/native-h5.mjs` 只连接 H5 actions/view state 与既有原生通话。麦克风、播放、接通、静音、重连、结束和 ActivityKit 仍由同一个 `CallCoordinator` / `VoiceAudio` 持有。后台网页暂停或重新加载不能重拨、重新收音或新建通话。正文、任务和多人 speaker 行投影进原 H5 组件，阅读器、键盘、滚动、当前／全部、动画和头像变化由原网页实现负责。

生成文件位于 `VVoice/Resources/H5Shell`，是 Xcode 文件夹资源，目录结构保持原样。`sync-h5-shell.mjs --check` 对每个上游源文件、原图、未修改 CSS、生成 HTML／JS 的 SHA-256 做确定性核对；上游改动后需显式同步。脚本替换网页音频引擎启动脚本为原生桥、去掉不使用的 modulepreload，并加入容器 CSP。原 CSS 文件不变，仅为全屏 WK 的阅读器补充刘海安全区；声音对比页的原 top-level await 用 async IIFE 包裹，由原生路由只读提供已有样本。

本地页面使用 Apple 公共 WKURLSchemeHandler 和 WKScriptMessageHandlerWithReply。资源 scheme 只读取清单内的包内文件及两个只读 comparison 路由；消息 handler 仅接受包内主框架。会话／工具的权限和实际 voiceSessionId 均由原生与服务器决定；不把个人入口、访问 cookie、relayTicket、工具密钥注入网页。网页不能申请麦克风，也不能调用任意 API。外部链接在系统浏览器打开，不带桥接权限。

方案链接有两层等待：原生 view 尚未创建时保存目标，网页尚未 ready 时在 host 保存目标；旧方案即使已离开当前轮，也能从受当前 owner 校验的 document(id) 白名单取回，用原 H5 阅读器显示。没有因“打开全文”启动另一通电话。WebKit 重载时头像 API revision 仍由原生递增，避免在同一通话里重新从 1 开始被服务器拒绝。

## 边界

- 这是 H5 界面与原生音频的组合，GPT Live 的原生 WebRTC 接入仍未完成，在模型菜单明确不可选；不能因嵌入了页面而宣称该传输已经支持。
- 同一 H5 版本固定随候选包分发，后端更新页面不会静默改变本地包；通过源文件校验防止两边漂移。
- 无后台头像模型请求。H5 可见时原 Reaction 逻辑通过已有接口判断；界面隐藏时停止新的语义请求。观察事件的退役 owner 交付仍受原生当前通话保护，不作为与浏览器完全等价的观测承诺。
- 本地 fixture、模拟器、签名与安装各自记录。真实 iPhone 上的 VPIO、锁屏、媒体播放和实际语义听验仍需人工通过，不自动拨号或调用付费模型。
- 只改客户端页面和既有 API 的容器桥，不改服务端协议、Gateway、身份权限或共享配置，使用本地 Candidate 验收，无共享 VLab 写入。无合入／上线／Gateway 重启。

## H5 容器实测（灵动岛合并前）

- `sync-h5-shell.mjs --check` 通过，已有 `sync-h5-design.mjs --check` 保持通过。
- Core 10/10、原生既有＋H5 共 31/31、既有服务 79/79。其后补充同一 native owner 下的头像 revision 单调递增断言，H5 4/4 定向重跑通过；没有调用真实模型。
- 实际 WKWebView 使用本地协议服务：原 H5 多人气泡与“仅倾听”标签、原 reader 的表格 DOM、点击原 mute 按钮均通过；重载前后 inputBytes 增长、sessions=1，reload 前已缓存的方案目标能够打开。
- 首轮无可见窗口的 WKWebView 测试让 requestAnimationFrame 暂停，方案自动展开用例未通过；将实际 WKWebView 加入模拟器真实窗口后重跑通过，没有放宽断言或用纯字符串替代渲染。
- 在 serve-sim 的实际 iPhone 17 Pro 帧中看到 H5 首屏与原 Grok picker／试听入口；不是设计效果图。完整新灵动岛合并后另记最终签名、安装和真机验收状态。

## 合成 build 9

已合入独立灵动岛源码 `3e2ed32`（本分支提交 `86193ea`）。H5 原头像真正 displayed 后，当前前台 owner 的 reviewed pictureID 才可短暂发布到灵动岛；遮盖、晚到旧通话及未知图片均拒绝。后台不增加模型请求。原生音频继续独占收音与播放，波形使用真实输入和实际 playerTime 对齐的输出能量快照。

真实系统展开复验发现大卡底部被裁切，现把折叠按钮移入正文行、正文头像缩为 52 pt，保留底部 44 pt 静音／结束控件。serve-sim 实际看到完整按钮；点静音后本地零帧字节增加。后台送达本地方案后，点击入口进入同一通话 H5 reader，sessions 保持 3、inputBytes 继续增长。该计数是手动 fixture 累计值，不代表正式通话验收。

本版仍是本地候选；真机安装及实际按键通话接受在 versions.json / VALIDATION.md 分开登记。

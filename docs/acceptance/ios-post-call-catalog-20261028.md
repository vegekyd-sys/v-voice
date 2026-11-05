# iOS 挂断后的模型目录刷新（Candidate）

后续状态：Tianyi 已授权合入上线，PR #178 / `0d97329` 已发布双节点。下文保留候选阶段原始记录；实际发布与 18 项回归、真机未连接限制见 [发布登记](../releases/ios-post-call-catalog-20261028/release.json)。

- 日期：2026-10-28；分支：`codex/ios-post-call-catalog-20261028`；基线：`71073ae`。
- 状态：本地候选已验证，未合入、未部署，未更新手机安装包或 TestFlight。

## 原因与改动

App 展示共用 H5 页面，原生层提供设置和通话能力。冷启动 Action Button 快速拨号跳过 status；页面在通话中握手时，原生 refreshOptions 因 active 跳过。挂断没有补读目录，H5Snapshot 因而继续传入原生默认名称「小何」和默认模型选项。

H5 adapter 记录通话 owner，结束且页面可见时重用已有 bridge-1 ready 握手，读取服务端目录。后台结束推迟到页面可见；同一通话只触发一次，旧 owner 响应不覆盖新通话。原生 refreshOptions 已检查请求前后 active 和 binding，避免改变进行中的通话。

改动属于 Voice 内部 H5，复用既有接口和权限，使用本地 Candidate 模拟器验收；无需共享 VLab 或 Gateway 修改。可随后续 Voice H5 资源发布交付给支持现有资源更新的 App，无新增 Swift 生产实现。

## 验证

- 修复前真实 WKWebView 测试失败：模型名称仍为「小何」，挂断后 statusRequests 为 0。
- 修复后 H5ShellTests 11 项通过，0 失败；包含前台挂断、后台挂断后再显示两条冷拨号路径。
- 快速拨号 statusRequests 为 0；挂断后为 1；重复空闲快照仍为 1；fastDials 始终为 1；call owner 保持不变。
- 页面显示「豆包 SeedDuplex」，目录不含被隐藏的 Grok。
- 结果包：`/tmp/voice-post-call-after.xcresult`。使用本地协议 fixture，无真实模型调用；不代表真机声音、Action Button 系统唤起或线上热更新验收。
- Codex 内置浏览器已显示真实模拟器画面；页面截图保存在 `/Users/tianyicai/v-voice-releases/ios/post-call-catalog-20261028/after.png`。

## 发布前事项

先由 Tianyi 决定合入与上线。发布时将首页 `lab/gpt-live-h5/changelog.mjs` 加入本次实际交付的「修复 iOS 快速拨号挂断后模型名称与选项未同步」记录，重新生成资源，登记实际部署 commit，并在安装的 App 验证资源接收和冷拨号挂断路径。无需因此重启 Gateway。

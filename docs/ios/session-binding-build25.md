# iOS build 25：会话绑定真机验收

用户于 2026-10-23 授权合入并在本人 iPhone 测试。会话电话 PR #2 已合入为 `6860ae59f01ce6712027e2c3267424ec786f0ca1`，main CI 39927562680 通过。

本次原生包增加飞书/H5 会话的一次性绑定、`vvoice://settings/bind` 跳转与预填、相同有效绑定复用，保留旧 Keychain 和原操作按钮路径。build 25 同步打包 H5 reader 样式。会话电话服务仍在隔离候选环境，正式服务未随这次合入发布。

基线 build 24 已获用户真机接受；build 25 已完成签名、独立导出验包和覆盖安装，设备读回 1.0.0 (25)，真实通话待用户验收。安装采用覆盖方式，不卸载、不清空 Keychain、不自动发起通话。TestFlight 等本人手机验收后安排。

## 安装证据

- 签名源码：`d7edf61f1e7dd44192a85ac75b1980787c79e9c4`（PR #87），main CI 39927984033 通过。
- IPA SHA-256：`e3f44f4dc7c546ce79d7001d1eba1edf93655abf8a030385cc499ef8e735d058`。archive 与独立解包的 IPA 均通过签名、profiles、arm64、WebRTC、系统 intents、资源一致性和 Release 检查。
- 原绑定相关签名权限与 build 24 一致；覆盖安装，无卸载或 Keychain 重置。安装前正式服务通话、建连、后台任务、设备操作均为零。
- build 24 签名回退包已复制并核对 SHA。正式服务和 Gateway 未重启，TestFlight 未发布。
- 安装后普通前台启动成功；未自动拨号。

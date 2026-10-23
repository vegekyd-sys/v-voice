# iPhone 单连接拨号 v1

本轮减少拨号关键路径的串行往返，目标是按键至实际可说话接近 2–3 秒；在真机测量前不宣称达到。

`GET /api/status` 为可用服务声明 `nativeDialVersion: 1`，App 按已验证绑定缓存兼容能力。原生 build 28 可在同一个 WebSocket `/api/dial` 上获得带版本的 `reservation` 与原有 `ready`／媒体事件；客户端仍要等 `ready` 才提示接通并上传收音。麦克风按现有后台启动修复提前准备，连接前 PCM 不缓存／上传。

服务端新旧连接入口共用 `reservePhoneCall`，保留真实 cookie/device grant、Origin、入口映射、精确 session/agent 检查、发布门禁、并发／频率限制和 cleanup。新请求只接受 phone/model/voice/dialVersion/nativeRuntimeVersion，不允许客户端传 session/actor/权限或输入策略。输入策略使用当前服务配置，实际原生策略仍由 reservation 的 nativeRuntime 描述。

收到 reservation 前不能发送媒体；无效／外部会话 frame 被拒绝。取消发生在会话检查或分配过程中时不启动 provider，或清理刚分配的拥有者。已连接 socket 的结束继续走已有 provider cleanup。明确 401/403/404/426 且未收到 reservation 时允许旧路径刷新／兼容；未知网络失败不自动重复创建通话，下次用户重试使用旧路径重新协商。

工具目录和当前上下文用 Promise.all 同时读取；不共享跨会话内容缓存，不提前建立付费模型连接。GPT WebRTC、现有网页和已安装旧 App 保留原连接流程。

## 候选验证

- 新服务测试覆盖单连接创建、cookie/Origin/参数拒绝、精确会话不存在、同 session 的 alias/第二设备竞争、验证中取消、reservation 中取消，以及真实 iOS device grant 的跨入口／撤销。
- 新原生测试覆盖无 HTTP 前置请求的实际收音、静音／挂断／重拨、准备中取消、外部 owner 拒绝和明确 404 的旧协议回退。
- 生产服务代码 + 原生客户端 + 本机模拟 upstream 集成通过，验证 nativeRuntime、实际 PCM 双向传输与零 HTTP 拨号前置请求。未用模拟器结果代替真实 iPhone 的速度验收。
- 初轮原生全量有三项因 shared fixture 未启动连接失败；补齐独立 fixture 后三项及新增集成通过。模拟器系统 linkd/音频 QoS 日志不作为真实声学结论。

构建、安装、生产发布与实测耗时另附交付记录；build 27 是本轮前的已安装回滚基线。

## 2026-10-23 交付

PR #101 已合入 main，主分支检查 39961345175 成功。从合入提交 `ffccc8fb6b38cd9662bd108f455a5e41aaba6a70` 构建的同一产物已通过统一发布器更新网页/iOS 服务和设备节点，两端 ready、产物哈希一致，Gateway 进程未重启。首页已实际显示“iPhone 拨号减少等待”。

原生 1.0.0 build 28 已在目标 iPhone 安装并读回版本；签名、Release 配置与 Keychain 绑定权限核对通过。保留 build 27 回滚包，未发布 TestFlight。启动尝试时手机锁定，已请用户解锁打开一次 V 以读取兼容能力，再从操作按钮测试。真机 2–3 秒目标尚未验收。

服务 819 项、设备服务 95 项、发布控制器 11 项通过。原生最终按不同用例计 81 项通过、1 项跳过；初次全量的 3 项 fixture 连接失败在启动独立 fixture 后复测通过，不能表述为一次全量全部通过。

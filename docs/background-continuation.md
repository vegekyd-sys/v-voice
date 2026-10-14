# 电话结束与后台任务接续

普通挂断只关闭麦克风、播放、Provider 连接和这通电话的展示责任。已由 Gateway 接纳的 Agent 任务保留原 runId、会话、工具准入和用户授权，继续完成；不重新委派、不重做外部操作。快速本地工具仍按原规则收尾。明确取消任务仍通过既有 exact-run abort / Worker process 退出证明，不能把挂机当成取消。

用户在电话中要求把进展或结果发群时，Voice 从最终 USER 字幕建立交付订阅，复用既有 Gateway `send`。目的地只来自本人入口绑定的飞书会话，模型不能传任意 chatId。指定其他群需要继续明确确认目的地，不替换当前绑定。未要求发送时不自动对外发送。`send_task_updates` 只是订阅，不启动第二个 Agent。

交付使用原任务的真实公开进展和最终正文，过滤 analysis / reasoning，去掉语音摘要包裹。发送按顺序去重，实际 messageId 才算确认；发群失败留独立审计证据，不能把原 Agent 任务的成功改成失败，也不能说已发送。结果不会回灌已挂断的旧电话。原会话可继续在飞书使用既有工具。

## 运行边界

SeedDuplex 的任务生命周期由独立 Voice 服务持有。GPT Live 的原生生命周期由 Gateway Talk 主机持有，完整体验还需要平台 `voice-independent-task-lifetime` 补丁。该补丁只对 `v-voice-gpt-live` Provider 生效，既有逻辑已支持关闭后登记接续 run 和保留已授权的 mutation grant。其他 Provider 不改变。

生产进程收到 SIGTERM/SIGINT 后拒绝新请求、关闭媒体并等待既有任务/交付收尾，再断开 Gateway。不要 SIGKILL，不要在活跃后台任务期间强行发布。直接服务 `dispose({drain:true})` 用于生产收尾；默认清理模式用于测试异常退出。结果观察上限十分钟，超过上限只报未确认，不重复执行。这里没有新增持久化队列：服务崩溃、整机断电和强制超时杀进程后的自动投递恢复不在本轮保证范围。

## 验证

`npm test` 覆盖普通挂断、明确取消、重拨、插话/最终结果退休、所有权、发送拒绝以及挂断后回执日志。`tests/background-continuation-live.mjs` 是单独显式运行的 VLab 探针，不在普通测试中触发付费或外部发送。它使用 VLab 的现有 Gateway/Worker 和既有验收群，真实执行安全延时命令并读回同 run 的结果。

探针的 SeedDuplex 前端事件是协议注入；不采集用户音频、不声称等同完整麦克风/Provider 通话验收。平台补丁另有真实 Talk 主机函数执行测试。合入后平台部署需经过共享 VLab lease 验收，生产上线及 Gateway 重启仍需单独授权并遵守任务排空流程。

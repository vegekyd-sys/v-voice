# 语音后台任务控制共用机制

GPT Live 和豆包使用同一个 OpenClaw 公共 SDK 执行引擎：
`openclaw/plugin-sdk/realtime-voice.controlRealtimeVoiceAgentRun`。

- GPT Live 原有 Talk 适配器继续负责 native consult 和 continuation 的身份绑定。
- 豆包由 Voice 插件将本电话通过 `chat.send` 启动的精确 run 适配为 SDK 的 `runTarget`。注册连接、会话、run 和通话 ID 必须匹配，已结束或替换的登记不能控制。
- Voice 共享 `lib/voice-task-control.mjs` 维护控制请求、模型提示词和接受结果的含义。四种模式为 status、steer、followup、cancel；旧 cancel_task 作为现有取消清理的兼容入口。
- 不复制 OpenClaw 的排队、任务调度或意图分类器。真实 Worker 验证发现公共 SDK 转交入站条件缺少原任务的工具权限指纹，因此另提最小平台 PR：任务身份投影保留已有权限和交付策略，控制函数原样传入；校验不放宽。普通挂断继续与已受理的后台任务解耦。

## 结果含义

`queued=true` 只证明原任务接受条件，`applied=false` 防止把接受说成已经生效。执行当前工具不会被修改条件强行中断，条件在后台可接收的阶段处理。拒绝、压缩期间不能接收、任务结束和身份改变都不能口头承诺成功。

豆包的口头补充由语音模型选择 openclaw_agent_control；界面明确提交的后台补充直达原任务。没有后台任务时，文字仍发给语音模型，并显示“补充内容已发送”，不声称已交给不存在的后台。

## 交付

Voice 服务及插件放在独立 v-voice PR；公共 SDK 的两处必要修复单独放平台 PR。插件新增 RPC 必须先被 Gateway 加载，才能发布对应 Voice 服务；仅更换网页服务不能使新 RPC 生效。正式发布前需要共享 VLab 验证插件加载和现有 Worker 集成。Gateway 重启仍走 v-self-restart，等待已有业务完成。本轮开发和 Candidate 不改变生产或共享 Gateway。

测试证据分别记录自动回归、真实 Agent 控制和真实语音。自动测试不能替代真实模型工具选择、手机音频或真人体验验收。

本轮共享环境收尾已撤回 `voice-background-20261015` 并释放 lease；生产没有成功加载该 runtime。下一次正式发版必须现场检查平台 #371 的任务生命周期两处文件是否已经进入基线。若尚未进入，需要将已合入的 #371 产物与本轮 SDK 权限证明修复一同组合发布，不能把源码已合入当成生产已经生效。其他 agent 已接手的共享版本不由本任务覆盖。

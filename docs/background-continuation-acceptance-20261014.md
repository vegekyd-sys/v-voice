# 挂断与后台处理解耦：Candidate 证据

日期：2026-10-14。Voice 基线 9f17241；平台基线 dev 63e988b。未合入、未部署线上、未重启 Gateway。

## 实际链路

在既有 VLab Candidate 源码目录运行 `tests/background-continuation-live.mjs`，真实 Gateway/Worker、真实 Agent exec/process 和真实 Feishu 投递；SeedDuplex 前端使用协议注入，不是音频 Provider 通话。只执行安全延时测试，不点外卖、不付款。

| 用户/系统动作 | 实際执行与观察 |
| --- | --- |
| USER 最终字幕要求“挂电话后把进展和结果发在群里” | 订阅本人电话绑定的既有 VLab 验收群 |
| delegate_to_v 启动安全延时任务 | chat.send 返回原 runId，后台实际执行 exec/process |
| 普通挂断 | Provider/client 关闭；没有 chat.abort 原 run |
| 重新拨号 | 新 voiceSessionId 可创建并关闭 |
| 退出 Voice（drain=true） | 等待原任务完成/交付，没有取消原 run |
| 后台完成 | 真实最终结果读回对应同一个 run；未向旧电话发送 backend.result |
| 明确取消第二个独立安全任务 | exact-run chat.abort，cancelled=true，processCleanupFailures=0 |

后台延时任务 run：`voice-bfca6f65-97b2-499e-8655-11a6b9b1d4f2-8c4dd230-f107-4296-926c-eabd852bf93a`。取消测试 run：`voice-8c05cd2e-c1c1-4433-b9cb-3c574d4c7fdd-54a0eddc-7595-4694-8e3f-c9791d18ed72`。

23:17 的接续通知 `om_x100b63cd9f8720a4cfe14b5cad37adf` 与最终结果 `om_x100b63cd9cff3ca4ce37e94317783e5` 都已通过飞书只读接口读回，发送者为 V - Lab；最终正文包含原任务唯一标记 `VOICE_CANDIDATE_CONTINUE_f7bf6854`。

第一次试验投递失败：测试机器人没有加入生产电话群，飞书返回 230002。没有给测试机器人增加生产群权限；改用既有「VLab 发布验收 B」后成功。失败试验不计为通过，也未重下真实外卖订单。

共享 Gateway 测试前后 PID 4058769，InvocationID 42df13c437404261a048abf4b7482ee8，active。测试目录与源码独立，不改共享 runtime/config。

## 自动回归与覆盖边界

Voice 全量 393 项通过；平台任务生命周期 9 项通过，包括真实 Talk 主机函数、显式取消以及其他 Provider 不变。平台测试也在 VLab Node 22 运行过，包含最终的 run metadata 转发，已在 VLab Node 22 重测并固化。

验证了既有插话/结果退休、报告呈现、工具权限和失败回执回归。没有真实 GPT Live WebRTC 音频验收；没有测试真实外卖、支付或新增群目的地。平台补丁尚未加载到共享/生产 Gateway，合入后需共享 VLab 集成验收。服务崩溃后的自动续发不属于本轮承诺。

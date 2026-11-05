# 不更新平台的接通等待替代方案

2026-10-27。用户要求为平台 #499 找到不更新平台的方式，保护线上任务，不重启 Gateway。本方案只更新 Voice，沿用原有签名 actor RPC 和工具授权，不复制平台的成员判断或路由规则；不依赖 #499、iOS #170 或新 App binary。

## 两项实际改动

**合并正在进行的相同准入读取。** Voice 的会话 directory 按 server-owned tenant/openId/userId/phone 合并尚未返回的 `voice.feishu.resolve`；每个 directory 实例的账号/应用/密钥独立。仅开始不足 1 秒的查询允许新请求加入，成功或失败立即移除，不缓存完成后的准入结果。每个调用者仍单独生成 immutable binding 和当前姓名，旧查询完成不会移除新的进行中查询。下一批、不同账号/租户/userId/会话和慢查询均重新核验。

**预约后提前准备本通电话的环境。** 已通过准入且分配了 voiceSessionId 的 actor-scoped 通话，在返回 reservation 时就开始只读工具目录和上下文请求，与 HTTP 返回和 relay 的独立身份核验并行。当前会话的准备快照仅能在开始后不足 1 秒被本通电话消费一次；已失败或延迟的 handoff 重新读取，快照不跨电话分享。提前阶段不开语音模型、不接收麦克风、不执行工具。

这是工具目录/上下文快照，不是准入或工具授权凭证。relay 仍先通过现有 cookie、设备 grant、当前成员资格和 call owner 校验，才能 attach；每次实际 Gateway 工具调用仍由原平台核验。飞书本地只读查询仍在执行前重新读取当前工具策略，并验证 CLI guard/app/user。准备后撤销 exec 的回归证明：模型即使知道该工具，也不能执行真实账号读取。

## 保持线上平台不变的对照

### 真实准入 RPC 的并发去重

在生产主机内使用现有 Gateway 和已绑定 actor，交替执行生产 directory 源码与候选源码，各 3 次，每次 2 个同时的准入请求。只执行签名只读 `voice.feishu.resolve`，没有通话或消息。

| 指标 | 生产 directory | 候选 |
| --- | ---: | ---: |
| 每批 Gateway 查询次数 | 2 | 1 |
| 三次完成时间 | 600 / 521 / 522ms | 531 / 542 / 530ms |
| 中位数 | 522ms | 531ms |

查询负载减半，但本批没有直接时延提升，不能把去重写成延迟减半。见 [directory-live-ab.json](directory-live-ab.json)。

### 连接现有线上 Gateway 的准备链路 A/B

基线直接读取当前运行的 Voice `b4ed555cd3171534a9a57067b5bb8a1936ba0a34` 的 `session.mjs`，候选执行本工作树的实际源码。两边使用相同 actor 和线上 Gateway；每轮真实执行 relay handoff 对应的当前准入 RPC，以及工具目录和 6 条会话历史读取。语音 provider 和 relay client 是本机协议 fixture，没有真实模型连接、设备或公网传输，历史内容仅留在服务器进程内，输出只有时长/次数/源码 hash。

交替顺序 baseline→candidate、candidate→baseline、baseline→candidate：

| 从预约到模拟 ready 的准备时间 | 生产源码 | 纯 Voice 候选 |
| --- | ---: | ---: |
| 三个样本 | 1149 / 1090 / 1092ms | 605 / 641 / 597ms |
| 中位数 | 1092ms | 605ms |
| 工具/上下文 Gateway 读取数 | 2 | 2 |

这一段中位数减少 **487ms，约 45%**。主要收益来自把原先连续等待的真实 Gateway 准入和环境读取重叠，没有通过少取历史或不检查权限实现。见 [preparation-production-ab.json](preparation-production-ab.json)。它与 #499 使用不同手段，取得接近量级的准备阶段收益，不能将其解释为完整手机通话快了 45%。

同日对上一版 Voice 候选 `dc612c6` 的对照为 1108→578ms；[更早探索样本](preparation-exploratory-ab.json) 也保留了一次候选 4035ms，其中现有 Gateway handoff 准入为 3396ms，触发延迟准备刷新。没有删除慢样本来宣称长尾消除。单次 Gateway 查询自身的长尾仍可能发生，本方案不改变它的内部执行。

另用固定 500ms handoff、650ms 目录、800ms 上下文、600ms 模型、200ms 辅助检测的本地协议回放，对上一版候选各 5 次，中位数 1905→1404ms。见 [controlled-replay.json](controlled-replay.json)。

## 路径差异与验收

- 提前准备主要帮助 HTTP reservation→relay 的网页和 App 兼容路径。iOS 已使用 `/api/dial` 单 socket 时，reserve→attach 基本连续，没有相同的独立 handoff 等待可隐藏；不承诺该路径也额外节省约半秒。它仍获得既有 #169 的同请求去重/连接并行，以及本轮同时准入的去重。
- 1017 Voice、95 speaker、11 fleet 回归通过，build:ui、check:ios-shell、diff check 通过。覆盖即时/延迟 handoff、过期快照刷新、撤销工具策略、预约后挂断不能启动 provider、同账号名字不混用、跨账号/租户/会话隔离、失败和慢查询重试。见 [validation.json](validation.json)。
- 只使用既有 Gateway RPC，无平台协议、配置、模块或权限实现变更；本次不需要占用共享 VLab 或重启 Gateway。当前尚未合入或发布；没有真实付费模型、手机音频或实体 Action Button 验收，build 32 声音/打断基线仍须实际回归。
- 正式发布只走 Voice `release-fleet` 的双节点空闲保护，繁忙延期；不激活平台 #499，不修改 Gateway。正式发布时另更新正式首页日志和版本登记，当前只更新 Candidate 日志。

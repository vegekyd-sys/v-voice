# 重拨前旧通话重复清理（Candidate）

状态：原候选验收记录。现已通过 PR #180 合入并部署 4f06888；正式验证见 [发布记录](../releases/redial-cleanup-20261028/release.json)。基线 `2172c71`，生产服务基线 `0d97329`。只修改 Voice 服务的 HTTP close 回执，无 Swift 生产代码、音频/打断实现、Gateway 或固件修改。

## 根因

1. 已安装 App 挂断时先停止媒体并关闭 relay，再后台发送 HTTP close。
2. relay 的服务端清理先完成；`releaseClosedDirectCalls()` 将 context.active 清空。HTTP close 随后到达，被统一的 active-owner 检查返回 409。
3. 原生 `closeCall` 将 409 视作失败，保留 Keychain pendingVoiceID。下一次拨号先执行 `recoverPreviousCall()`，再次收到 409 后才清除旧标记并继续，增加一次串行 HTTP 往返。

本日已保存的 build40 真机诊断存在 `call.end → close 1041ms/409`，下次 `dial.recover → close 1015ms/409 → dial.fast`；后续还观察到 965ms、1875ms 的恢复请求。这些是历史原始观测，不是候选真机收益。

## 修复边界

每个已经验证的 visitor context 只保留最近四个、五分钟内**确认完成清理**的通话 ID。HTTP close 对这个 context 已结束的 ID 返回既有 `{ok:true}`，让现有 App 正常清除 pendingVoiceID。此路径不再调用 provider，也不触碰当前的新通话。

- 只有成功完成 close 或 direct `hasSession` 确认已移除的 ID 才记入；清理抛错/仍在进行不能伪装成功。
- 其他 visitor、未知或过期 ID 继续 409；其他接口如 heartbeat 不接受已结束的 ID。
- 请求仍经过原有入口、cookie、origin 和身份检查；不存在全局已关闭 ID 查询，不以头像 Reaction 状态证明权限。
- 已有 App 不需新包。部署前残留的旧 pending ID 仍可能在首次拨号清理一次；后续通话结束即可使用新回执。

这属于 Voice 内部生命周期修复，复用既有 Gateway 接口与权限，在本地 Candidate 验收，不占用共享 VLab。

## 实际对照

使用生产 HTTP 服务、relay/provider 适配和原生 VoiceAPI/CallCoordinator，只有模型上游为本地模拟。给 HTTP close 固定加 500ms 延迟，稳定制造“relay 先清理，HTTP 后到达”的顺序；不是公网或真实语音速度。

同一份编译好的 iOS 测试产品，服务修改前后各连续三次重拨：

| 指标 | 修复前 | 候选 |
| --- | --- | --- |
| 每次重拨的多余 close 请求 | 1 / 1 / 1 | 0 / 0 / 0 |
| 重拨至 connected（ms） | 765 / 675 / 672 | 231 / 226 / 200 |
| 中位数（ms） | 675 | 226 |
| 上次挂断 HTTP 回执 | 409 | 200 |

证明的是这一次重复 HTTP 请求被消除；不承诺真机稳定快 449ms 或 1s，也不等同于首次拨号、Action Button 按下至扬声器出声。

## 检查

- HTTP hosted 回归 14 项通过，包括重复 close、跨 visitor、较新的通话不受影响、失败清理继续重试、过期和容量限制。
- 同一原生二进制的完整 SharedDuplexFlowTests 5 项通过，包括重拨、生产协议音频/打断和同包策略更新。
- 上述本地阶段 Voice 1033、设备服务 95、发布控制 11 项通过；该阶段无真实模型调用、原始录音或新包安装。
- 本地结果包：`/tmp/voice-cleanup-before-run.xcresult`、`/tmp/voice-cleanup-after.xcresult`、`/tmp/voice-cleanup-shared-suite.xcresult`。

## 2026-10-28 真机交替对照

使用同一 iPhone（iOS 27.0.1）、同一份 build40 Debug 测试二进制、同一 HTTPS 地址/服务器端口/真实 SeedDuplex，按 A→B→B→A 顺序测试。每组四通，第一通预热不计入重拨统计；最终两边各六次有效重拨。没有人为延迟。每组开始前只重启本次独立服务，维持相同限流初始条件；正式服务未回退、未修改，Gateway 未重启。

| 中位数 / 结果 | 旧服务 | 候选 |
| --- | ---: | ---: |
| 重拨前额外清理 | 271.5 ms | 0 ms |
| 原生传输测试开始至 relay ready | 1807.5 ms | 1485 ms |
| 合成测试句回复首个 PCM 到达 | 6301 ms | 5977.5 ms |
| 回复硬件播放游标开始推进 | 6385 ms | 6066.5 ms |
| 六次重拨前仍有旧 pending 标记 | 6/6 | 0/6 |
| 全部通话（含预热）close 成功并清除 pending | 2/8 | 8/8 |

测试入口为 `DeviceAudioTests.testLivePublicRedialCleanupLatency`：真实 `VoiceAPI.recoverPreviousCall/closeCall`、`RelayTransport` 和 `VoiceAudio`，独立 Public Keychain。物理收音回调只用于发送本地合成句及零 PCM，现场麦克风样本不发送、不存储。有效 16 通全部接收到模型 PCM，并观察到 `AVAudioPlayerNode` 播放游标推进；挂断立即停止引擎并清空队列。候选六次重拨均没有恢复清理请求；旧版额外清理范围 227–393ms。

**范围：这是原生传输自动短测，不是 Action Button/锁屏完整 UI 测速。** 测试直接串行编排恢复、音频启动和 relay；正式 CallCoordinator 会重叠部分准备，因此绝对值不能当成“按键到接通”。首段音频是合成测试句的回复，包含输入时长与模型生成，不是正常欢迎语，也不是扬声器声学录音。使用独立 Public 上下文，不经过个人会话的 Gateway 工具。本轮未重测长插话。观察到接通中位数减少 322.5ms，其中明确消除的清理等待中位数为 271.5ms；小样本仍有网络/模型波动，不承诺每次都快 1 秒。

两组失败/无效前测完整保留：首组测试脚本漏调用每通的 `audio.beginStream()`，音频序号跨通残留导致最后一通不播放；修正脚本后，所有正式 A/B 均使用同一新二进制。另组未重启独立服务，累计六次拨号触发原有限流，中断在第三通；整组排除，之后各组统一重启本次服务。没有修改产品音频代码或生产限流。

真机原生源码与已接受 `a1146b3` 一致。测试后从原 archive 恢复并启动 Release 1.0.0（40），安装回执成功、版本读回为 40；独立绑定删除，个人入口未改动，临时服务与隧道确认停止。共 22 次真实模型短通话（含排除组），另有一次限流拒绝；测试预算目标 $5、上限 $10，实际供应商账单未核对。仅提交去标识统计，[完整数字与范围](redial-cleanup-20261028-physical.json)，原始日志/结果包保留在仓库外。

2026-10-28 经用户授权已合入并上线，首页日志与双节点回执已验证。正式公网前后探针清理等待 208→0ms，但接通 1264→1629ms；小样本含一次断连、随后两通成功，不宣称整体稳定提速。手机锁屏，未完成正式个人会话的按键/欢迎语前后验收；上述 Candidate 真机结果保留独立范围。


## 正式环境上线后真机补验

手机解锁后，复用上述同一份 build40 Debug 测试二进制，改接正式 Public HTTPS 入口，完成四通短测（预热一通、有效重拨三次）。四通均 close 成功、清除 pending，收到模型 PCM 并观察到硬件播放游标推进；三次重拨额外清理均为 0ms。接通中位数 2245ms，合成句回复首 PCM 6851ms、硬件播放游标推进 6942ms。原始统计与范围见 [正式真机回执](../releases/redial-cleanup-20261028/phone-production.json)。

上线前手机锁屏，未采集同条件正式真机基线。历史个人通话曾有 972/1581ms 的重复清理，但上下文与时间不匹配；Candidate 的六对六 ABBA 也仍单列，不能与本轮拼成正式上线提速百分比。此前正式 Mac 探针的一次断连仍保留，根因未确认，本轮四通成功不替代该问题的调查。

测试后已从原 archive 恢复并启动 Release 1.0.0（40），安装/启动回执成功，设备版本读回为 40。使用独立测试 Keychain，个人入口保持原绑定。本轮是原生传输与硬件播放短测，未覆盖按键/锁屏完整用户路径、声学听验或长插话；未采集现场人声。新增四次模型短通话，供应商账单未核对。只补验收文档，不再次发布服务。

# 重拨前旧通话重复清理（Candidate）

状态：本地候选通过，尚未合入或部署。基线 `2172c71`，生产服务基线 `0d97329`。只修改 Voice 服务的 HTTP close 回执，无 Swift 生产代码、音频/打断实现、Gateway 或固件修改。

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
- Voice 1033、设备服务 95、发布控制 11 项通过；无真实模型调用、原始录音或新包安装。
- 本地结果包：`/tmp/voice-cleanup-before-run.xcresult`、`/tmp/voice-cleanup-after.xcresult`、`/tmp/voice-cleanup-shared-suite.xcresult`。

## 下一次真实验收

使用已安装 build40、同一网络/账号/模型，记录按键、拨号、dial.recover、connected、PCM/播放开始；至少比较三次温重拨。核对挂断 close 200、pending 清除、下次没有 close 请求，并确认挂断/长插话不退化。用户接受后再决定合入与上线；发布前补首页正式更新日志、版本登记和双节点回执。

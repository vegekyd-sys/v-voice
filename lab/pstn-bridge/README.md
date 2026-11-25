# 中国大陆电话外呼桥（原型）

让 V 用现有 Voice 链路给一个中国大陆手机号打电话，接通后双向实时说话。2026-11-25 原型，**没有号码、没有拨过真实电话**。

## 怎么接

```
指定发起人（飞书 ou_）
  └─ call-policy：已同意的 +86 手机号、单线、每号每日 ≤3 次、08–21 点、主叫不可选
  └─ asterisk-ami：AMI Originate → PJSIP/<11位号码>@<运营商 SIP 中继>（主叫号由中继开通时绑定）
        对方接听 → Asterisk 执行 AudioSocket(<uuid>, <桥地址>)
  └─ audiosocket：TCP，8 kHz slin16 双向；只接受本次拨出的 uuid
  └─ bridge：8k⇄16k/24k 重采样，20 ms 实时放音，插话检测，挂断与失败处理
  └─ device-link：作为一台 native 设备连 Voice /device/voice（Bearer 设备令牌）
        → 现有 device-endpoint + session.mjs：模型、工具、会话绑定、结束逻辑全部复用
```

电话是 Voice 的又一台“设备”：设备记录决定绑定哪个飞书会话与权限，桥不传 sessionKey 或身份。Voice 侧零改动；建议设备记录开 `deviceBargeIn:true`（手机端有回声消除，线路上的插话基本是真人声）。

## 行为约定

- 一次 `call()` 最多拨一次。忙线、拒接、拥塞、无人接听、媒体腿未到、Voice 故障都直接给出结果，不重拨、不排队。
- 是否打断由 Voice 决定：桥只在 V 说话时检测到持续人声后发一次 `barge-in`；收到 `audio.clear` 才丢弃未播音频。
- 对方挂断 → `call.end`；V 结束（end_call、空闲等）→ 挂电话。
- Voice 连不上或通话中掉线 → 先给对方播回退提示（`fallbackPcm8k`，实际部署需准备一段“V 暂时连不上，稍后在飞书回复你”的录音），再挂断，结果为 `voice-unavailable`。
- 未拨出的 AudioSocket 连接直接挂断，不进 Voice。

## 验证

```sh
npm run test:pstn-bridge
```

16 项本地测试：G.711/重采样、AudioSocket 分包、准入策略；端到端用**真实 TCP AudioSocket + 真实 Voice device-endpoint/session + 脚本化模型 socket + 模拟运营商**，覆盖接通、听（对方声音以 16 kHz 进模型）、说（模型 24 kHz 音频以 8 kHz 实时到对方）、插话取消与清空、双向挂断、四种未接通不重拨、Voice 拒绝/掉线回退、陌生腿拒绝、AMI 拨号报文与结果映射。

**未验**：真实运营商/中继/号码、真实 Asterisk（AMI Reason 码按常见定义，部署版本需核）、真实手机听感与延迟、回声、DTMF、长通话、并发。测试通过不代表能打通真实电话。

## 部署还需要

1. 企业主体开通的外呼线路（SIP 中继或厂商 SIP 对接）及其主叫号。
2. 一台 Asterisk（PJSIP 中继 + AMI 账号 + AudioSocket），和桥同机或内网。
3. 一条 Voice 设备记录（私有配置）与回退录音。
4. 发起入口（飞书里谁说“给某号打电话”）尚未实现，属于下一步；现在只有 `bridge.call({initiator,to})`。

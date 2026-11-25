# 中国大陆电话外呼：线路调研与桥接原型（2026-11-25）

目标：指定人员发起，V 给本人或明确同意的大陆手机号打一通电话，接通后用现有 Voice 双向实时说话。不做营销、群呼、改号。本次只读公开资料，未联系厂商、未注册、未购号、未拨真实电话。

## 三件事分开看

- **号码**：被叫看到的主叫号。只能是开通线路时绑定的号（固话/中继号），不能自选、不能显示个人手机号。
- **外呼权限**：企业实名 + 语音资质 + 话术/场景报备 + 厂商人工开通。查到的国内云厂商都不给个人或个体户开。
- **媒体接入**：能否把通话音频实时双向交给我们。决定 V 用不用得上现有 Voice 实时模型。

## 路线对比（官方文档，价格以开通时为准）

| 路线 | 号码 | 资质 | 打国内手机 | 媒体接入 | 价格 | 开通 |
|---|---|---|---|---|---|---|
| 阿里云 VMS「语音SIP」 | 中继号（30+ 省） | 企业实名+语音资质；**邀约制**，商务给账号打标并补签协议 | 能；同一被叫 1 次/分、5 次/时、20 次/天 | **标准 SIP Trunk**，IP 白名单+被叫前缀，北京/上海/深圳接入点；自建 Asterisk 拿原始 RTP → 本原型 | 0.11 元/分起，号 35 元/月 | 资质约 1 工作日 → 话术 → 打标补签 → 报对接 IP → 联调 |
| 阿里云 IMS「AI实时互动电话」`StartAIAgentOutboundCall` | VMS 专属真实号（固话） | 同上，且需「语音SIP打标」；官方写明“因合规风险尚未默认开放” | 能（手机号并发 3、固话 15） | 平台做 ASR/TTS，LLM 可接 OpenAI 规范自研接口；**无原始音频** | 示例约 243 元/月（1 号+1000 分钟，未逐项核） | 同上 + 商务审批 |
| 腾讯云 TCCC `CreateAICall` | 仅自携运营商 SIP 中继号 | 企业 | 能；08–21 点，同一被叫 24h ≤5 次 | 自定义 LLM（openai 等）及自定义 STT/TTS；无原始音频 | 智能体 1999 元/月含 8000 分钟 | 资质 → 自携号接入 → 购包 |
| 运营商 SIP 中继（电信/移动） | 本地固话 | 企业，营业厅办理 | 能 | 标准 SIP/RTP | 无官方公开价 | 营业厅；**整行未经官方确认** |
| 华为云语音通话 | 固话 | 企业 | 能 | 仅通知/验证码，无实时媒体 | 0.18 元/分 | — |
| 火山引擎 | 不提供号码 | — | 不直连 PSTN | 需自建 SIP2RTC | — | 语音SIP 文档显示“未上线” |

来源：阿里云 [AI实时互动电话](https://help.aliyun.com/zh/ims/user-guide/how-to-make-smart-phone-call)（已核原文）、[语音SIP接入流程](https://help.aliyun.com/zh/vms/voice-sip-access-process)（已核原文）、[语音SIP定价](https://help.aliyun.com/zh/vms/voice-sip-and-voice-dual-pricing)、[资质 FAQ](https://help.aliyun.com/zh/aiccs/support/faq-about-enterprise-qualification-review)；腾讯云 [CreateAICall](https://cloud.tencent.com/document/product/679/111211)、[计费](https://cloud.tencent.com/document/product/679/95641)、[外呼规则](https://cloud.tencent.com/document/product/679/79155)；华为云 [资质标准](https://support.huaweicloud.com/productdesc-VoiceCall/rtc_03_0008.html)；火山 [FAQ](https://docs.volcengine.com/docs/6348/1568689)。

产品参考：Meta「Muse」公开信息只说面向美国付费用户打给商家，供应商未公开；豆包「小豆」11-24 邀请制公测，可代打餐厅/酒店/门店，主叫号与供应商未公开。均不作为供应商依据。

## 推荐

- **首选：阿里云 VMS 语音SIP → 自建 Asterisk → 本桥 → 现有 Voice。** V 的实时模型、工具、会话全保留；SIP 打标本来就是 IMS 路线的前置，多走一步就能拿到原始音频。
- **备选：阿里云 IMS StartAIAgentOutboundCall**，LLM 填 V 的 OpenAI 兼容入口。上线快但变成“平台 ASR→文本→TTS”，不是 Voice 的实时说话，打断与音色由阿里云决定。
- **再备选：腾讯云 TCCC**，前提是先有运营商 SIP 中继号。

## 未确认

- Aliyun 语音SIP 对接 IP 是否必须大陆公网固定 IP（文档只要求提供呼入/呼出 IP）；V 主机在新加坡，大概率需要一台国内固定 IP 主机跑 Asterisk + 桥。
- 打标/开白的审批标准与时长；个人自用、非营销场景能否过话术审核。
- “禁止虚假主叫”语音专门规定目前只见征求意见稿；本方案不改主叫，不受影响。

## 原型

`lab/pstn-bridge/`，见其 README。16 项本地测试通过，全量 `npm test` 1542 项通过。没有号码，不能称真拨通。

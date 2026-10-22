# 火山多人语音实验

独立实验，不接入 V/Gateway、生产 Voice V 或音箱固件。目标是验证“说话人＋话语＋当前会话对象 → 模型选择回应对象和表达方式”。

本轮 API 测试预算约 5 美元、比较总额不超过 10 美元；费用以供应商账单为准。实验服务另设 60 次模型调用、10 分钟总输入、6000 字 TTS 的进程上限，单次会话三分钟。仅监听本机。

## 三种模式

- `exclusive`：在调用对话模型之前筛选已绑定人物的转写，其他人物不进入该模型的上下文。当前允许讲话的人可以明确交接给另一位；目标改变后，原讲话人也会被过滤。切换模式或专注对象清空历史，防止旧多人内容带入。原始音频仍由火山 ASR 处理；这不是音频波形分离，不能保证重叠抢话下不漏入旁人内容。
- `adaptive`：传入所有人带身份的话，由模型选择是否回应、回应谁、主要对象是否改变。支持天意明确交接给十二。
- `group`：允许模型回应多人。

主要对象 `nextTargetId` 与当前这句的实际回应对象 `addresseeIds` 分开记录。“十二”作为孩子的姓名，不当成年龄。人物身份仅来自会话校准，不因语音自称而自动改绑。

## 2026-10-15 已验证

链路：Seed ASR 2.0（`volc.seedasr.sauc.duration`，双向流式二遍）→ 本次会话人物绑定 → Doubao Seed 2.1 Lite `260915` → Seed TTS 2.0 / 小何。

- 39.012 秒合成音频、六次发言：A/A/B/A/C/B，实际 API 返回声线 0/0/1/0/2/1。输入按真实时间发送，最终返回用时 41.005 秒。按声句结束算，说话人确认仍有明显延迟，不能当作低延迟语音验收。
- 通过模型结构化返回的 `nextMode`、`nextTargetId`、`policyChangeRequested` 表达明确交接；没有明确交接标记的专注目标越界会被程序拒绝。
- 最终三种模式共 16 次真实模型调用、21,633 tokens，单次模型耗时约 1.8–4.5 秒。专注模式在天意明确交接后只放行十二，原讲话人和未知声线被拦截；自适应模式切换对象和孩子表达；共同对话可切换对象。回执为 `decision-results.json`、`decision-checks.json`。
- 内置浏览器完整回放自适应测试：显示六次“人物→话语→模型对象”结果，实际返回 TTS 并进入播放器播放状态；浏览器控制台无相关错误。未进行物理听感验收。
- 内置浏览器另跑“只跟十二”：六次发言中四次非目标被拦截，只有十二的两次发言调用对话模型。两轮浏览器合计模型调用八次，与服务端计数一致。
- 单独生成的实际 MP3：24 kHz、单声道、4.056 秒，ffprobe 与完整 FFmpeg 解码通过。
- 七项本地逻辑测试覆盖模型前过滤、历史清空、对象交接、交接后过滤原说话人、模型越界拒绝、格式校验、ASR 去重/身份修订告警。
- 不使用合成回放预绑定捷径的应用协议测试：先让两种音色分别走“下一句是天意/十二”校准，绑定到声线 0 和 1；校准不调用对话模型；再发天意交接和十二提问，真实模型切换对象并返回孩子风格的语音。回执为 `calibration-verification.json`。
- 最终内置浏览器复测专注交接：从“只跟天意”开始，识别天意明确交接后，界面对象改为十二，后续天意与未知声线均被拦截，十二的问句正常返回语音；控制台无相关错误。

### 明确未通过或未验收

- **预注册声纹姓名匹配未通过**：使用两个不同的官方合成音色创建测试声纹，记录均为正常状态、256 维 embedding。A 新句匹配 B=0.1904、A=0.1860，不能据此自动认人；B 新句的第一、第二名也接近。连注册源音频自身的分数也不够拉开差距。原因尚未定位；不能推广为火山真人声纹能力无效。
- **重叠人声分离未通过**：A/B 等幅重叠测试只返回一个声线。不要把流式 `speaker_id` 当成重叠音频分离；正式专注场景需要另测 RTC 声纹降噪/TSE。
- 自适应模式可能接纳陌生人的话题切换，即使主要对象仍为十二。此行为已显露，不能把结构化标签正确等同于对话策略符合用户期望。
- 真人声线稳定性、你与十二的身份绑定、真实麦克风路径、回声、抢话、自然交接体验尚待真人测试。

## 试用

右侧内置浏览器：`http://127.0.0.1:26318/`。

1. 可先点击“回放三人合成测试”；身份来自已知合成素材的校准，不是自动认人通过。
2. 真人测试点击“开始真人测试”；点击“下一句是天意”，由天意单独连续说五秒，看到绑定成功。
3. 点击“下一句是十二”，由十二单独连续说五秒，看到第二条声线绑定成功。
4. 在自适应模式说“现在你先和十二聊”，观察实际回应对象和表达方式。未绑定声线保持未知。
5. 专注模式也可以由当前允许讲话的人明确交接，例如天意说“现在只和十二说话”；模型确认交接后，后续只放行十二。也可通过界面手动切换。首次真人试验先轮流讲话。

真人原始音频不写入磁盘。该实验不把语音身份用作付款、授权或其他敏感动作的认证依据。

## 运行与复现

设置 `VOLC_SPEAKER_ENV_FILE` 指向已有服务端凭据文件（不复制到仓库），包含 ASR、TTS API Key 和火山 OpenAPI AK/SK。临时 Ark token 只在进程内存中；客户端不接触凭据。

已创建一个独立按量推理接入点、两个合成声音测试声纹和一个测试声纹组用于本次实验，没有修改已有接入点或生产配置。这些测试资源保留用于后续复核；声纹没有用于真人入口的身份判断。

```sh
npm run test:volc-speaker
node lab/volc-speaker/generate-fixtures.mjs
node lab/volc-speaker/run-asr.mjs artifacts/volc-speaker/turn-taking.pcm artifacts/volc-speaker/streaming-result.json
node lab/volc-speaker/run-decisions.mjs
npm run lab:volc-speaker
# 先结束浏览器中的通话，再从另一个终端验证无预绑定的校准路径：
node lab/volc-speaker/verify-calibration.mjs
```

本机实验接入点 ID 位于被 Git 忽略的 `artifacts/volc-speaker/ark-endpoint.json`。真实测试回执、声纹结果、原始合成素材也在该忽略目录；没有真实用户音频。`run-asr.mjs` 自动生成同名的 `-turns.json`，供决策测试读取。新的 ASR 测试要生成对应的新转写，不能用旧转写冒充新结果。

## 官方接口依据

- [流式说话人分离及短音频声纹匹配](https://docs.volcengine.com/docs/DoubaoVoice/speaker-separation?lang=zh)
- [语音侧声纹注册与管理](https://docs.volcengine.com/docs/DoubaoVoice/voiceprint-registration-management-api?lang=zh)
- [RTC 声纹降噪与多人识别](https://docs.volcengine.com/docs/real_time_communication/Voiceprintconfigurationmulti-personrecognitionornoisereduction?lang=zh)
- [临时 Ark 鉴权](https://docs.volcengine.com/docs/ark/get-api-key-api?lang=zh)
- [HTTP 流式 TTS](https://docs.volcengine.com/docs/DoubaoVoice/unidirectional-streaming-text-to-speech-http?lang=zh)

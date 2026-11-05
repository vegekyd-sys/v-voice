# 后台任务等待期间的播报

电话把长任务交给 V 后台（`delegate_to_v`）后，等待期间听起来始终是 V 一个人在做事。

## 说什么（按优先级）

1. **V 自己写的进展句**：来自任务的 `progress` 记录，或 Gateway 的 `item/preamble` 事件。同一句只说一次；包含“做完了”的句子不播。
2. **正在做的事**：Voice 的 Gateway 连接每次连上都调用 `sessions.subscribe`，只认本任务自己的 run 和它派出的子任务。播报最近一步的主题，比如“我在查勇士赛程”“我在看 nba.com 上的内容”。命令行、子任务和不认识的工具不播。
3. **很久没动静**：45 秒没说过话时，最多说两句不带时间的话（`IDLE_LINES`）。

不报秒数，计时只留在屏幕上。工具返回内容和模型推理不播报。

## 结果

豆包不能根据结果自己组织语言：真实接口上 `response.create` 报 `unknown event` 并断开连接；未知 id 和迟到的工具结果都不会让模型开口。所以结果由主机用 V 的声音念：

- 后台按 V 本人的口吻写语音摘要，第一句就是结论。
- `speakableResult` 去掉过程开场（“我查了一下，”“收到。”），把“后台”换成“我”。
- 屏幕和模型上下文仍是完整正文。

## 没做完不能说好了

`V_ONE_VOICE_POLICY` 禁止这样说。主机还有一道拦截：任务进行中，模型文字一出现完成说法（`claimsCompletion`），就取消这段回复并改口（`NOT_DONE_LINE`）。文字比音频早约 0.5 秒，所以来得及。刚返回过原生工具结果时不拦；“等我整理好了告诉你”这类承诺句和否定句不算。

## 什么时候说

节奏参数在 `session.mjs` 的 `NARRATION_DEFAULTS`。用户在说话、刚说完（4 秒内）、V 正在播放、Decision 门待定、有已放行但还没回答的提问时都不说。**有原生工具在等结果时绝不注入语音**：#28/#34 证明注入 `speech_text_buffer.commit` 会让迟到的结果被吞。多人识别下这句话经 `hostSpeech` 过主机输出门。

## 工具开始前的提示

豆包在同一轮先开口再调用工具时容易丢结果（2026-10-20 合成对比：真先开口的 5 题里 3 题没被回答），所以 `VOICE_TOOL_START_NOTICE=model` 只是实验开关。

## 审计

`transcript-log` 只记录 `backend.stage`、`backend.progress-spoken`（kind 取 fact、stage 或 idle）、`backend.stages-observed`、`backend.child-run`、`speech.premature-completion-cut` 的种类和计数。说出的话本身是 `source:"task-progress"` 的字幕，只在实际音频开始时记录。

## 边界

合成通话验证的是服务端链路和真实后台，不等于真机或真人听感。完成说法的拦截在真实通话中还没触发过，只有单元测试。结果仍要等 V 的长回答播完、用户说完才播。发布回执见 `docs/releases/one-voice-20261030/release.json`。

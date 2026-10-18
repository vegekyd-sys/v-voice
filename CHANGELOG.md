# V Voice changelog

## Candidate · speaker-stream-linux.20261019.1

- 将豆包流式多人候选部署到独立 Linux 服务，服务端识人、ASR、Decision 和原生语音不依赖 Mac 或浏览器推理。
- 增加受保护的 HTTPS 候选入口，沿用既有入口鉴权与服务端会话绑定。
- 改善 ASR 漏掉被叫人姓名时，对人际生活实物协作的安静判断；明确向 V 询问能力仍可回应。
- 验证脚本复用授权 Cookie，并逐项检查多人对象、旁话、排他和真实原生音频；失败收据保留。
- 候选首页日志仅在该独立入口展示，正式已发布列表不加入实验能力。

状态：独立 Candidate 已部署，未合入、未发布生产。版本元数据见 `lab/speaker-native/linux-release.mjs`，实际验收见 `docs/experiments/speaker-stream-linux-2026-10-19.md`。

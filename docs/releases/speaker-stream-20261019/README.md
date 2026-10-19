# Voice 流式多人发布 20261019

范围：正式 Voice 启动入口启用豆包流式多人，使用正式既有 Gateway、入口身份、工具、记忆与搜索；保留 Reaction、GPT Live/Grok 原生路线。未复制 Candidate 数据库、私有 Gateway 或记忆快照。Gateway 插件保持生产原版本，不因源码包包含插件而装载它。

基线：线上 Voice d37ac851；Gateway 插件 a9ac5168。候选 c873c898 的真人体验、真实接口与播放验证见此前验收；本发布分支合入 main，保留正式后台任务 SDK 和 releaseReadiness。发布来源保持独立分支，不自动合入 main/dev。

运行配置：VOICE_STREAM_SPEAKER=1，VOICE_SPEAKER_PYTHON、VOICE_SPEAKER_MODEL、VOLCENGINE_ASR_API_KEY、既有服务端 Decision 凭据。Linux CPU 推理，模型固定 SHA256 校验；声线模板仅在通话内存中存在。

发布核对和回滚：使用平台既有独立 Voice 发布控制器，正式服务无通话、无创建和后台任务、无 relay 连接时切换；保留原 pointer、启动 drop-in、私有环境、Gateway PID/start/invocation/config 哈希及旧产物。额外 Speaker drop-in 和 runtime 在独立目录；回滚恢复原 launcher/pointer，去除本次 Speaker drop-in，Gateway 不重启。私有操作记录位于服务器 release 的 receipt，不能提交凭据和真实聊天记录。

验收环境选择：只涉及 Voice 内部音频、模型适配和既有 Gateway 接口，沿用独立 Candidate，不写共享 VLab。正式预启动与切换后继续验证真实 ASR/Decision/豆包、身份与工具；无跨服务协议和授权变更。

限制：合成音频真实接口检查不代表新增手机蜂窝、物理外放 AEC 或多账号验收。具体上线版本、产物哈希、测试结果与回滚状态在发布后登记。

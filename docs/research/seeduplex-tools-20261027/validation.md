# 本轮验证与重跑

研究基线：main `002313bd66978dc188b5fea898cb0a1a633f8cc9`；产品行为代码来自 PR #155 / `7ce20a2de22bedba1cc32086d5f832a44539cd8c`。本轮改动仅为研究材料、离线采样/聚合脚本及其测试，没有编辑运行模块、首页更新日志、版本登记或生成 iOS 包。

## 已完成

- fetch 并读取最新 AGENTS / UPDATE-GUIDE；独立 worktree 和 `codex/seeduplex-tool-study-20261027` 分支；未使用总控集成 worktree。
- 官方接入必读的真实内置浏览器页面和官方接口可检索正文核查。工具数上限与 schema 完整子集未公开确认，报告保留未知。
- 通过 `ssh v` 只读核对网页生产服务路径和三个相关源文件 hash；均与研究基线一致，见 [provenance.json](provenance.json)。双节点状态引用既有回执，未声称本轮重验另一节点。
- 8 种身份/设备的真实服务声明路径在内存 WebSocket 中通过，包含 Public、actor reader 缺失、Gateway 缺 exec 和设备可用差异；没有模型连接、工具执行或系统设备操作。
- 私有日志在生产节点原地聚合，限定日期，只返回白名单统计；没有将原始聊天/ID/参数/结果复制到 Git 或发送给模型。
- 聚合器 5 项测试通过，覆盖信息不泄漏、未知名称过滤、缺失回执不填零、不成对/重复事件、半开窗口、时区与分位数。
- 40 条合成人工评测题的数据结构、唯一 ID、基线工具名、参数标签与文档相对链接检查通过；它们没有模型输出，不能当成 40 条模型验收通过。
- 按用户本次纠正撤回 typed adapter Candidate；题库升级为 v2，工具字段改为示例路径，不再用正确工具白名单约束 agent，按目标和参数语义评估其他获准组合。未修改运行代码或全局 memory。
- `git diff --check` 通过；本轮不以运行全量产品测试来装饰纯研究交付。

## 无费用重跑

在本分支仓库根目录：

```sh
node scripts/research/seeduplex-tool-inventory.mjs
python3 -m unittest discover -s tests -p voice_tool_aggregate_test.py -v
git diff --check
```

采样器只使用源码中的真实服务/适配器和内存 fixture；仅打印名称/体积/计数，不打印 instructions、凭据或会话标识。目录是合成的 6 项，不是现场 Gateway 工具数。Unicode 字符数/UTF-8 字节数不等于 token。

授权维护者若要重新读取同一节点日志，可将脚本通过 SSH 标准输入送到远端 Python；不上传文件、不写远端配置：

```sh
ssh v 'sudo python3 - /var/lib/openclaw-voice-h5/transcripts --start 2026-10-24T00:00:00+08:00 --end 2026-10-27T12:52:31+08:00' < scripts/research/voice-tool-aggregate.py
```

该命令没有发起任何新通话或后台任务。只有相应授权的维护者才应访问私有日志。聚合文件固定快照窗口；晚到日志可能改变重跑结果，不覆盖旧快照冒充同期结果。

## 尚未完成的验收

| 验收 | 状态 |
| --- | --- |
| SeedDuplex 当前版本真实选工具/参数准确率 | 未运行；需要本任务付费测试授权 |
| 16/24/32 工具或长短描述的受控 A/B | 已提供预算和矩阵，未运行 |
| 真实用户同题前台/后台总延迟与成本 | 未运行；日志分布不能替代 |
| 四端自然语音、插话、权限变化、锁屏 | 未验；离线握手不替代 |
| 日历写入、Notes、跨设备执行 | 仅方案；未新增工具、无真实写入 |
| Candidate / VLab / 生产部署 | 本轮均无部署；未占共享 lease |
| 合入 / 上线 | 由后续授权决定，研究 PR 不代表上线 |

本轮没有需要停机回滚的运行变更。离线脚本不会进入 Voice 服务路径；若不采用研究方案，关闭 PR 即可保留当前产品行为。

# V App 规划：和飞书 1:1、iOS 专属能力、多人、架构

2026-10-30 CST 起草。现状见 [README](../README.md)：App 以 operator 身份连 Gateway，
自己用 Swift 从原始事件拼出工作卡、提问卡、审批卡，已在 VLab 私有 Gateway 上跑通。

## 1. 结论先说

**App 不应该自己再实现一遍飞书体验，而应该成为 V Experience 的又一个渠道。**

现在 App 的做法（Swift 里重写会话折叠、工作卡状态机、审批卡文案）正是 Tianyi 不想要的
「重复优化」：飞书每改一处，App 要再改一处，而且永远追不上——飞书上很多体验
（接管卡、凭据卡、夜班卡、插话、Harness 切换、页脚）根本不在 Gateway 事件里，
是飞书补丁和插件直接发给飞书的。

V Experience（`v-openclaw-platform/apps/v-experience/`）本来就是为这个建的：
渠道无关的逻辑算出「要显示什么」，每个渠道只写一个薄渲染器。钉钉、企微、Telegram
已经这样上线（10/05）。App 加进去后：

```
Gateway 挂点（progressCard / taskRegistry / question / approval / 回复回调 / presentation）
        │
   V Experience（渠道无关：状态、规则、文案 → 卡片描述）
        │
   ├─ 飞书渲染器（今天还是飞书补丁，按 10/05 决定逐块迁入）
   ├─ 钉钉 / 企微 / Telegram 渲染器（已上线）
   └─ App 渠道（新）：把卡片描述原样推给 App，App 用原生 SwiftUI 画
```

这样「一处优化，所有渠道都有」，App 也不用为体验改动重新发版（服务端下发卡片）。

## 2. 和飞书 1:1 对齐

### 2.1 做法

1. **App 渠道插件** `apps/v-experience/app/`：一个 OpenClaw 渠道插件（和钉钉连接器同一层），
   入站把 App 发的消息当作渠道消息（带发送者身份、走同样的命令权限和插话逻辑），
   出站把 V Experience 的卡片描述和插件发的 presentation 推给 App。
2. **卡片描述格式**定一份版本化的「V 卡片」schema，元素按飞书卡片 2.0 选（markdown、分隔线、
   分栏、按钮、图片、输入框/密码框、折叠面板），因为飞书是参照物，飞书渲染器以后也吃同一份。
   App 遇到不认识的元素降级成文字，旧版 App 不会坏。
3. **插件卡片自动到 App**：接管卡、凭据卡、夜班交付卡今天走 `message send --presentation`
   → 渠道的 `renderPresentation`。App 渠道实现这个接口，这些卡就直接出现在 App 里，
   按钮回调走插件原来的处理函数（`/v-handback <id>` 这类）。
4. **App 里的 Swift 状态机退役**：`HistoryMapper` / `LiveTransport` 里拼工作卡的逻辑删掉，
   只保留连接、渲染、本地乐观显示（发送中、重发）。

### 2.2 体验清单（以飞书为准）

| 飞书体验 | 现在 App | 走 V Experience 后 | 需要先做的 |
|---|---|---|---|
| 过程流式（说明逐句、工具行） | Swift 自拼 | 卡片描述 | — |
| ☑️▶️◻️ 进度清单 | Swift 自拼 | 卡片描述 | — |
| ⏳ 后台任务行 | 没有 | 卡片描述 | — |
| Ask User（1–3 题、多选、其他、打字回答） | 部分 | 卡片描述 + `question.resolve` | — |
| 审批卡（发 owner、结果原地改写） | Swift 自拼 | 卡片描述 | 审批逻辑从飞书补丁移进 V Experience |
| 凭据录入（密码框，不进记录） | 没有 | 原生表单 → secret-entry | core 的 `messageChannel === "feishu"` 改为渠道列表 |
| 「电脑」接管卡 | 没有 | presentation | — |
| 夜班「需要你」、完成交付卡 | 没有 | presentation | v-nightshift 发卡时带上 App 渠道 |
| 插话（回复中继续发） | 没有 | 渠道入站 | 插话逻辑从飞书补丁移进 V Experience |
| `/model` `/vcc` `/vcodex` `/vds` 切换 | 没有 | 渠道入站 + 命令权限 V3 | 把 App 渠道加进命令权限渠道列表 |
| Runtime 页脚 | 没有 | 卡片描述 | 页脚逻辑移进 V Experience |
| 表情回应、NO_REPLY 静默 | 静默已处理 | 渠道层 | — |
| 图片、文件收发 | 没有 | 渠道附件 | App 端上传/预览 |

「需要先做的」那几项正是 10/05 决定里「飞书分块迁入 V Experience」的内容。App 给了一个
提前做的理由：迁一块，飞书、钉钉、企微、Telegram、App 五处同时受益，
飞书用现有测试回归保证行为不变。

### 2.3 验收

每项体验用同一个 candidate 回合，同时接假飞书和 App 渠道，比较两边收到的卡片描述，
要求语义一致；再各在真机上看一眼渲染。

## 3. iOS 上能给 V 开的能力

按「普通用户一用就觉得不一样」排序：

1. **推送 + 锁屏直接操作**：V 回复、提问、审批、「需要你」都推送；通知上直接点「允许一次」、
   选选项，不用打开 App。审批和凭据用 Face ID 确认。
2. **灵动岛 / 实时活动**：V 在干活时锁屏和灵动岛显示进度清单（2/4 · 正在搜索…），
   V Voice 已有 Activity 扩展可以参考。
3. **分享到 V**：任何 App 里的照片、网页、文件、聊天截图「分享 → V」，带一句话交给 V。
4. **手机作为 V 的节点**：OpenClaw 原生有节点命令（`camera.*`、`location.get`、
   `notifications.*`、`device.*`），官方 iOS App 就是这样把手机能力开给 agent 的。
   V 可以「拍一张给我看」「我现在在哪附近」「帮我记个提醒」，每类能力由用户单独授权、随时关。
5. **Siri / 快捷指令 / 操作按钮**：「问 V …」、把常用任务做成快捷指令，按操作按钮直接对 V 说话
   （拨通 V Voice 或转文字发到 App）。
6. **小组件**：V 当前在忙什么、夜班进度、待我处理的事。
7. **和 V Voice 互通**：聊天里一键转电话，电话结束后的总结回到同一个会话。

前三项价值最大、风险最小；第 4 项最能体现「V 是我的助理」，但要先定权限边界。

## 4. 一个人用还是多人用

**按多人设计，先给你一个人用。** 现在的 App 是 operator 身份：能看到 V 上所有会话，
等于管理员，只适合你自己。给别人用需要：

- **身份**：App 用户 = 一个渠道用户，和飞书用户同样走 owner / 非 owner 规则、命令权限、
  `allowFrom` 名单。登录建议用飞书登录（团队成员都在飞书里，身份天然对上）；
  用 OpenClaw 原生的 `session.identityLinks` 把同一个人的飞书 ID 和 App ID 关联，
  App 里的私聊就是你飞书里那条私聊的同一个会话，两边无缝续接。
- **两种视图**：所有人看到「我和 V 的对话 + 我所在的群」；只有 owner 额外有「控制台」
  （所有会话、审批、设备管理），也就是今天 App 的 operator 能力。
- **多个 V**：App 支持添加多个 V（你的 V、Mirror V 上别人的 V、测试用的 VLab），
  像切换账号一样切换。每个 V 的设备令牌分开存。
- **分发**：自己用直接装（现在这样）；给团队用走 TestFlight；对外再考虑上架。

## 5. 架构

### 5.1 服务端（v-openclaw-platform）

| 部分 | 位置 | 职责 |
|---|---|---|
| V Experience | `apps/v-experience/v-experience.mjs` | 渠道无关的状态、规则、文案，输出卡片描述 |
| V 卡片 schema | `apps/v-experience/schema/` | 版本化的卡片格式 + 共享测试样例（App 和服务端共用） |
| App 渠道插件 | `apps/v-experience/app/` | 入站消息、出站卡片和 presentation、按钮回调、推送 |
| 推送 | App 渠道插件内 | APNs 令牌认证，只推「要你看/要你做」的事 |

### 5.2 App（v-voice/client）

拆成 Swift 包，UI 和协议分开，扩展能复用：

| 包 / 目标 | 内容 |
|---|---|
| `VKit` | Gateway 协议、设备身份、Keychain、会话与消息模型。没有 UI |
| `VCards` | V 卡片 schema 的 SwiftUI 渲染器 + 快照测试 |
| App | 会话列表、聊天、设置、配对、多 V 切换 |
| 扩展 | 通知操作、分享、实时活动、小组件、App Intents，都只依赖 `VKit` + `VCards` |

### 5.3 迭代规则

- 体验改动在服务端改卡片描述，不改 App；App 只在加新卡片元素或新系统能力时发版。
- 协议带版本和能力声明（App 告诉服务端自己认识哪些元素），服务端按能力降级。
- 卡片 schema 的样例文件同时跑服务端测试和 App 快照测试，两边对不上就红。
- 测试照旧：VLab candidate 私有 Gateway + 假飞书 + App 渠道，真机最后看一眼。

## 6. 分阶段

| 阶段 | 内容 | 结束标志 |
|---|---|---|
| 0（已完成） | App 原型直连 Gateway，装到 Tianyi 手机 | 手机上能打开 |
| 1 | V 卡片 schema + App 渠道插件；App 改为渲染卡片描述；工作卡、清单、后台行、提问 | candidate 上同一回合 App 与假飞书卡片一致 |
| 2 | presentation：接管卡、凭据卡、夜班卡到 App；推送 | 真机收到接管卡并完成一次接管 |
| 3 | 飞书独有逻辑迁入 V Experience：审批、插话、Harness 切换、页脚 | 飞书现有测试全过，App 同时具备 |
| 4 | 身份与多人：飞书登录、identityLinks、owner 控制台、多 V | 第二个人用 TestFlight 正常使用 |
| 5 | iOS 能力：实时活动、分享、节点能力、快捷指令、小组件 | 逐项真机验收 |

## 7. Tianyi 的决定（2026-10-30）

1. 手机上的 App 连生产 V。生产 Gateway 没有公网入口，先用 Tailscale 内网的 HTTPS 入口
   （`tailscale serve` → V 的 tailnet 地址，只有自己 tailnet 里的设备能连），
   手机要开 Tailscale。公网入口以后单独定。
2. 方向：**App 作为 V Experience 的渠道**，「飞书分块迁入 V Experience」随之提前。
3. 登录：**飞书登录、Apple 登录、手机号以后都支持**。身份层按「一个人可以有多种登录方式」设计，
   都映射到同一个 V 用户，再由 `session.identityLinks` 关联到各渠道 ID。
4. **V Voice 以后合进这个 App**：一个 App 里聊天 + 电话。合并前两个 App 并存；
   `VKit` / `VCards` 按两边都能用来拆，V Voice 的通话、实时活动、绑定流程逐步搬进来。

# 四端统一发布

一次 Voice 发布包含两个服务节点：`web` 服务网页和 iOS，`devices` 服务小机器人和音响。两个节点使用同一份已合入 main、CI 通过、逐文件 hash 验证的 artifact。上海音频节点保留，不把家庭设备音频迁回海外。Gateway、身份、入口和设备配置保持原样。

## 唯一日常发布入口

```sh
npm run check:ios-shell
npm test
npm run test:speaker-native
python3 -m unittest discover -s tests -p 'release_fleet_test.py'
# PR 合入 main，确认 main CI 通过后，在干净的合入提交上打包。
npm run package -- /absolute/private/artifact-directory
node scripts/verify-package.mjs /absolute/private/artifact-directory
npm run release:fleet -- inspect --inventory /absolute/private/inventory.json --receipts /absolute/private/receipts
npm run release:fleet -- publish --artifact /absolute/private/artifact-directory --inventory /absolute/private/inventory.json --receipts /absolute/private/receipts
```

私有 inventory 必须同时包含 `web` 和 `devices` 两个目标；不能用单节点配置绕过同步。`web.ssh` 固定为 `v`，设备节点使用其已有独立 SSH 连接。服务仅允许 `openclaw-rtc-h5.service` 和 `v-voice-speaker.service`。地址、配置、令牌、设备身份及完整运维回执不提交。结构参考 `release-inventory.example.json`。

发布会先上传并校验两个节点的产物、安装锁定依赖，再分别尝试空闲切换。某个节点忙碌或身份变化时保留原服务，输出 pending、退出码 3；另一个已经完成的节点不会被强行重启。默认在 15 分钟内每 15 秒重试忙碌目标（`--wait-seconds` 可调整，0 表示不等待）；服务身份或私有配置变化不自动重试。超时后空闲时重跑同一命令，只处理未完成的目标；已经运行目标版本时不会重新安装其依赖。只有两个运行节点的 commit 和 filesSha256 都匹配，matrix 才能标记服务器同步完成。一次失败不能写成四端完成。

这个命令只在一次已授权的正式发布中执行；合入普通代码并不绕过既有上线授权。发布者必须使用本入口，不再只切网页电话服务。

## 通话保护

### 私有持久化目录

启用 `ProtectSystem=strict` 的服务必须将 `VOICE_IOS_BINDINGS_FILE` 和 `VOICE_CALL_REPORTS_DIR` 指向该 unit 的 `StateDirectory` 下（目录 0700、凭据文件 0600、服务用户拥有）。不要将整个 OpenClaw 配置目录改为可写。首次调整先备份并逐文件校验已有数据，配置在统一发布切换时加载；随后以运行服务的 mount namespace 和服务用户验证可写，并通过真实 App 绑定确认凭据已保存。仅用 root 在服务外写入不能证明服务可写。

- 服务提供仅本机服务用户/root 可访问的 Unix 管理 socket（0600，父目录 0700），没有公网管理 API。它返回当前 PID、版本、iOS UI revision、通话/建连/后台交付/设备拍照数量和有限设备版本信息。
- 在同一事件循环中检查所有工作为 0，随后关闭新通话接入，没有“检查空闲后又拨入”的间隙。已有通话、建连和交付会使申请失败；申请失败不改变服务，也不关闭连接。网页/iOS 建连与设备已有 WebSocket 上的 call.start 都受保护。
- hold 最长两分钟，发布程序崩溃会自动恢复接入。新服务启动时也短暂保持 hold，完成版本、原配置与 Gateway 身份核验后才恢复拨号。
- 停止服务前再次比较 PID、Invocation、运行路径、unit、私有配置及 Gateway 基线。只操作两个 Voice unit；`SendSIGKILL=no` 和无限停止等待防止 systemd 强杀迟到任务。失败回滚同样要求新服务处于 hold、无任何工作；不能强杀新版本上已经开始的通话。

### 首次迁移旧服务

旧版没有原子 hold。仅允许私有 inventory 中已核对源码 SHA 的版本迁移。控制器保持一个已认证的本地 HTTP 探针连接，临时拒绝服务端口的 **新建 loopback TCP 连接**，随后确认除了探针外没有任何已建立、握手中或半关闭连接，并再次检查通话、建连、后台任务为 0。存在任何设备连接都延期，不能踢掉空闲长连接来通过检查。

规则只针对本次服务端口和唯一随机标识，既有连接不被丢弃；两分钟 systemd watchdog 自动撤销，正常结束立即清理。后续发布使用进程内 hold，不再需要该引导规则。

## 四端版本与能力

| 端 | 日常同步范围 | 单独升级范围 |
| --- | --- | --- |
| 网页 | 服务实现与页面，刷新后新会话使用新版 | 浏览器既有能力边界 |
| iOS | 同一服务器与校验过的 iOS UI 包；空闲前台更新，不改正在通话的界面 | Swift 音频、GPT 传输、App Intents、灵动岛、权限及新 bridge，必须编译安装原生版本 |
| 小机器人 | 上海 Voice 模型/对话/工具服务、xiaozhi 适配及已有 Reaction 协议 | 唤醒、麦克风/扬声器/AEC、舵机、摄像头驱动及固件协议 |
| 音响 | 同一上海 Voice 服务、既有设备协议 | 唤醒、AEC、音频驱动及固件协议 |

artifact 的 clients 字段列出四端归属、iOS UI revision/bridge 范围/已接受原生 build、设备协议。`matrix.json` 的服务器完成状态不等于真机体验完成。原生或固件变化必须另附安装版本、兼容性、回滚及实际验收记录；缺少设备上报就记 unknown，不能把本地编译版本冒充设备运行版本。当前固件没有可靠通用 OTA 回滚，因此不能为了服务升级自动刷机。

设备现场的 native / multi-speaker 策略、音量和会话绑定保留。不同终端的输入策略是明确配置，服务同版本不要求强制相同麦克风处理。新功能若需要改协议或客户端能力，应先做兼容版本与对应端升级，不能只开服务器开关。

## 本次验收范围

本次是独立 Voice 发布控制与观测，不变更 Gateway RPC、Worker、身份或会话协议；本地 Candidate 的真实 HTTP/WebSocket 测试和模拟 systemd/网络失败测试覆盖发布边界，无需占用共享 VLab。无自动拨号、付费模型测试或设备刷机。上线回执另行登记实际双节点版本、Gateway 未变和页面/iOS UI 包 hash；真实音响/机器人听感仍以本人使用验收为准。

## 行为一致性回归

同一产物只能证明代码版本一致。共享对话能力不得按 phone/speaker 关闭；新增能力需同时通过 `session.test.mjs` 中四端的搜索、任务进度、插话与结果矩阵，设备协议继续通过 `device-endpoint.test.mjs`。硬件适配边界及当前候选验收范围见 [共享终端行为](shared-terminal-behavior.md)。

# iOS 与网页通话延迟核查（build 30 候选）

2026-10-23。用户已确认 build 29 的会话绑定、切换和操作按钮跟随正常；同一 iPhone、同为豆包的网页通话主观上明显快于 App。本轮尚未完成整体延迟问题的真机接受，不把采集优化等同于“根治全部延迟”。

## 已确认的问题与改动

- 原生代码请求 20 ms 输入，却使用 `AVAudioNode.installTap`。Apple SDK 明确说明 tap 的缓冲范围为 100–400 ms；真机记录实际约 100–103 ms 一批，再拆为 5 个 20 ms 包。切成小包不能消除采集前的等待。
- 改用 `AVAudioSinkNode` 的实时输入回调。回调只把 Float32 样本复制到预分配的、无锁且有界的环形缓存；转换与 Swift 回调在串行 worker 上运行。按 20 ms 消费并沿用原有 PCM16LE/24 kHz 协议；溢出报错结束，不静默丢弃过期语音。Voice Processing I/O、HFP 和原生后台所有权保留。
- 原生音频启动仍发生在 Action Button 的系统录音授权窗口内，首帧就绪检查移到已有的接通前检查点，与网络握手重叠，不再串行等待。上游 ready 与实际输入到达两项仍是显示接通的必要条件。
- relay/dial 请求标记为 Apple 的 `responsiveAV` 网络服务类型。这是实时音频调度提示，不宣称它能修复任意 CDN/运营商延迟。
- 增加有界的采集间隔、主线程交接、上传峰值、WebSocket RTT、首包至播放器启动和暂停/恢复计时。只保留本地数值与状态，不记录音频、聊天正文、入口、cookie 或请求 URL。

## 现场证据与限制

| 范围 | 结果 | 解释边界 |
| --- | --- | --- |
| build 29 真机近期启动 | 一次约 2.9 s 接通 | 单次现场值，不是分位数保证 |
| 原管线真机采集 | 最大相邻交付约 103 ms，主线程交接最大约 35 ms | 不支持把数秒停顿直接归因于主线程 |
| 原管线真机播放 | 收到首包至 `player.play()` 约 9–30 ms | 不含声卡输出延迟、网络和模型等待 |
| 真机正常通话 WebSocket RTT | 常见约 325–400 ms；较长输出时见 2.75–3.49 s | 已观察到网络等待，根因仍需进一步控制变量；不是服务端模型耗时 |
| 真机固定合成语音，原生传输 | 3 轮语音输入结束至首个回复包约 2.62/2.13/2.16 s | 仅传输测试，未播放；最初测试缺少 HTTP 保活导致约 47 s 后关闭，不能把该关闭认作 App 故障 |
| Mac Chrome 网页固定合成语音 | 3 轮约 1.87/2.33/2.60 s | 不是同一物理 iPhone，不能据此宣称真机一致 |
| 同一模拟器、同一绑定、相同合成 PCM | WebKit 约 2.12/2.29/1.83 s；URLSession 约 2.14/2.57/2.27 s | 两者受控结果接近；仅替换传输实现没有证明可以根治用户观察到的差异 |
| 新采集管线模拟器 | 相邻交付约 20 ms，最大约 21 ms | Voice Processing I/O 必须另做真机验证 |

合成语音由本机 TTS 生成；不保存或回传现场麦克风样本。模拟器/真机的 opt-in live test 只发送合成 PCM 和静音。调试测试需要现有用户授权且默认跳过，不在常规 CI 中调用真实模型。

## 验证状态

- Swift core：40 passed。
- 完整 App 模拟器回归：87 passed / 0 failed / 2 skipped。覆盖绑定切换、快拨、早到音频、麦克风启动、打断/恢复、H5 更新、灵动岛和共享 runtime。
- 候选真机 Debug 构建：通过；新的 VPIO 输入路径和实际延迟对照尚待真机自动测试。
- iPhone 当前系统报告 `passcodeRequired=true`，Xcode 拒绝锁屏启动测试。镜像入口也要求本机认证，没有尝试绕过系统认证。
- 正式发布、主干合入与整体延迟“已根治”：未宣称。build 29 签名包作为回退保留；此前安装的 build 30 为诊断包，不是正式交付。

## 官方依据

- [What's New in AVAudioEngine (WWDC19)](https://developer.apple.com/videos/play/wwdc2019/510/)：低延迟实时输入使用 sink，普通 tap 不在实时上下文运行。
- 本机 Xcode SDK `AVAudioNode.h` 的 `installTapOnBus` 注释：tap bufferSize 支持 100–400 ms。
- [responsiveAV](https://developer.apple.com/documentation/foundation/nsurlrequest/networkservicetype-swift.enum/responsiveav)：实时、对延迟敏感的音视频连接调度类型。

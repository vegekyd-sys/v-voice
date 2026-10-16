# Speaker device candidate — 2026-10-16

Tianyi approved replacing the speaker's model-direct media path with the Voice
server relay, with SeedDuplex as default. Test in a separate existing session;
the eventual Twelve Home binding and three-model selection remain product
requirements. Household access to Tianyi's tools is not opened by this work.

## Recovered baseline

- Production Voice entry: d37ac851487b8fd9023ad0c922bdb1cf485984ec (#25).
- Existing device commits: 05678e3 (device endpoint), 92398f1 (backpressure/uplink
  diagnostics), eb8cf4f (bounded follow-up window).
- Existing independent candidate service: v-voice-speaker-candidate, port 26250.
  Production Voice remains on its original process. No Gateway patch/restart.
- Device protocol: authenticated `/device/voice-candidate` WebSocket; 16 kHz
  mono PCM16 uplink, 24 kHz mono PCM16 downlink. This is deliberately asymmetric:
  hardware records 16 kHz and the existing providers emit 24 kHz.
- Server owns model session, tools, task continuation, transcripts and endings.
  Firmware owns wake, microphone, playback, local volume and status light.

## Takeover fixes

Device tokens are validated against their actual header format. A pending call
reserves the bound session against a second device as well as browser clients.
A blocked speaker's server-side WebSocket output is capped at 4 MiB; exceeding
it closes that device call and its provider rather than growing without bound.
The release package includes the dynamically imported device endpoint.
The no-screen prompt limits the current device to Tianyi's personal test.

## Validation and limits

514 Voice tests passed, including real local WebSocket authentication, unchanged
16 kHz input through the SeedDuplex adapter, PCM downlink, two-device contention,
bounded output, Grok selection, natural idle and provider shutdown. These are
protocol/provider fixtures, not paid model or physical acoustic acceptance.

The candidate is isolated with Nice=5, CPUQuota=60%, MemoryHigh=200M and
MemoryMax=300M. Production readiness was true with no active call, session
creation or backend task at takeover. This establishes process isolation,
not a measured production first-word latency guarantee.

Hardware/audio evidence and exact final commits will be appended after tests.
GPT Live relay is not implemented by the recovered candidate (only SeedDuplex
and Grok); do not advertise all three models on hardware yet. The recovered
firmware is half duplex; do not label it as verified interruption support.
Raw audio, transcripts, device mappings, credentials and images remain private.


## Isolation correction requested by Tianyi

All speaker services on production V were stopped. Testing moved to an independent
VLab Candidate with own Gateway 26470, Voice 26471, state, token and one Worker;
channel ingress, scheduled jobs and heartbeat are disabled. Shared VLab's Gateway
and lease remain unchanged. The production Gateway and web phone identities were
preserved. Resource caps alone were not treated as proof of zero interference.

The first real VLab SeedDuplex PCM question passed: server ready in 804 ms,
first output 2984 ms after question end, 75454 output bytes, no virtual underrun.
Physical acoustic and Agent-tool parity remain separate acceptance gates.


The captured hardware uplink was intelligible to local offline ASR with no
clipping (peak 11593). Cropped original input failed through SeedDuplex; the
same crop at 2× gain received a reply. Device configuration now supports an
opt-in `inputGain` (1–4, default 1); only the physical Candidate speaker is set
to 2. Phone input and the simulator retain unity. Hardware retest is required.


The 2× profile alone did not resolve the subsequent live hardware trial. An
opt-in hardware noise gate is now available for testing room-noise effects on
provider endpointing: default disabled, raw PCM RMS threshold configurable,
and a sample-counted 500 ms hold preserves quiet speech tails despite bursty
network arrivals. Tests cover real PCM pacing and unchanged default pass-through.
This optional calibration is not enabled in the Candidate device mapping. It
must not be described as a verified repair.


## Native duplex and long-answer transport candidate

Tianyi confirmed that a natural hardware question received a formal reply and
that the timbre is correct; the reported remaining problems are stutter later
in a long answer and inability to interrupt. Keep the successful 6fc29ab runtime
as the rollback reference. The optional noise-gate experiment is not enabled.

The next transport patch limits PCM wire lead to 480 ms, retains unsent PCM in
a bounded server queue, clears it immediately on the shared Voice audio.clear,
and preserves audio.done/end.after-playback ordering. Source metadata marks
host-injected speech so hardware uses the same backend-speech barge-in contract
as the web relay. This creates no model, task, transcript or tool execution path.
Firmware continuously uploads XMOS post-AEC input during native model speech;
only local device acknowledgement is guarded. WS writes move off the audio-pump
loop, and native clear also retires already-buffered hardware output.

Hardware long-answer, echo and interruption acceptance is pending for this
patch. Server pacing tests exercise 30 seconds of exact sample preservation,
clear before the old answer finishes, source/end ordering, late-turn clock
reset and bounded socket backlog. Firmware compiles and the 80/300 ms backend
speech-onset helper passes a native host test.

The first synthetic native-duplex hardware round connected in 1077 ms, had a
maximum audio-pump loop gap of 33 ms, and reported 11 receive-ring underflows.
It is not a passing long-answer/interruption result. Code inspection found
that receive-ring depletion could trigger rebuffering while the separate
500 ms speaker queue still contained audio. Firmware now waits for arriving
packets while that queue drains, rather than fading/rebuffering on each packet.
A fresh human long-answer/interruption check is pending. The physical speaker
remains on VLab; no production Voice or Gateway was restarted for these changes.

A read-only Candidate Gateway catalog check and a real `exec` marker invocation
succeeded through the existing `tools.invoke` RPC. This proves the tool transport,
not full tool/account parity. The private Candidate currently has no Voice-owned
Lark CLI configuration, and its Codex provider is disabled in the older VLab
baseline. Personal Feishu queries and complete backend model parity are therefore
still outstanding. Production OAuth state was not copied or refreshed for this
check. No household caller identity or permission was added.

## 2026-10-16 冻结交接：功能接通，可靠性未通过

用户要求停止当前实验、交接下一位。真人曾确认音箱能够收到正式回答、音色正常；随后仍有长句卡顿、不能自然打断，以及唤醒蓝灯亮但没有正式回答。不能将当前 Candidate 交付为可稳定使用。

现场仍使用同一套 Voice session/provider/tool/task/end_call 路径，没有另建音箱 Agent 服务。正式 V 的旧音箱 bridge 和早期音箱 Candidate 已停；正式 Voice/Gateway active，本任务没有重启它们。音箱改在自有 VLab Candidate（独立 Gateway 26470、Voice 26471、私有 state 和 tunnel），没有占用共享 VLab integration lease。正式 V 的首字和全部功能没有做全面真人回归，不以健康状态替代此项验收。

Voice 实际运行 `04ab11f850e0ea0f741f9a2bc5a084fddd4bd8d6`，本分支之后的提交只更新记录。服务端验证 522 tests 通过，包含 PCM pacing、clear 与 done/end 顺序；它们不证明真实设备听感。可重复的 Mac 模拟对照收到 1407 ms 音频，首 PCM 为问题结束后 1851 ms，最大 chunk gap 204 ms，400 ms 预缓冲下虚拟 underrun 为 0。

设备本轮明确观察到两类失败：一通真人失败只有 3200 B（100 ms）上行、无用户最终转写；其他通话已有正式输出但硬件收包空档达 2.4–16.6 秒。SDK 升级、IPv4/IPv6、TCP_NODELAY、写超时调整均未证明有效。最后 common TLS lock 实验又出现 1500 ms 锁超时、6 次 underrun、I2S ISR queue overflow，并以 `uplink-failed` 结束。尚未完成 provider → Node 实际发送 → cloudflared → ESP 接收 → I2S 的同 turn 时序定位。

当前设备保留失败诊断固件，代码已保存为 Speaker commit `f1c5bff2e61a92faffaad589caf0ded69f1ea38b`，app SHA256 `de5c0c3dd8067e7ffadd7f52bb65d6754cf6a9681fd0b7214f22cf7e04ce23a7`，没有继续刷回滚。Speaker 工作区与详细交接：`/Users/tianyicai/v-speaker/.claude/worktrees/speaker-v-integration-review-ac3615/verification/voice-relay-takeover-20261016.md`，含私有证据位置、负结果、回滚 hash/命令和待 review 的控制帧短写/连接销毁边界。已知曾能回答的保守参考是固件 `f4919448…` 配 Voice `6fc29ab`，但半双工和长句仍有限制，不是完整验收基线。

下一位先决定是否恢复保守基线，再同步捕获各段实际时间，分别定位上行停止与下行积压，避免继续盲调 buffer。稳定后才验真人长回复、打断、工具进度、自然告别。独立 Candidate 的 Lark 账号与 Codex provider parity、三模型选择、家庭权限、十二家最终绑定、线路录音和一周试用均未完成。所有工作仍在独立分支，没有合入平台 dev 或正式上线。

## 2026-10-17 续接：卡顿根因是家庭国际链路丢包

夜间从家庭网络实测：到 V（新加坡）丢包 14–23%，到 VLab（首尔）14–25%，到 Cloudflare 隧道节点 20–28%（RTT 约 200+ ms），到国内 0%。此前“Mac 模拟器同 Candidate 正常”的对照走的是 Mac 本地代理（fake-ip），不代表家庭直连；Mac 改走家庭直连后同样出现 2.4 s 收包间隔和多次欠载。硬件上的 2–16 s 停顿与 TCP 重传退避相符。Voice 服务端、pacing 和 tunnel 均不是主因。

`83d1807` 增加按设备的 `playoutLeadMs`（200–5000，默认 480 不变），VLab 物理音箱为 2000：设备收到 `audio.clear` 会丢弃全部缓冲，提前量只用于吸收短时停顿，不推迟打断。523 tests 通过。VLab Candidate 现运行 `speaker-83d1807`；音箱另经 V 的 8443 直连入口（仅 nginx 转发，经 tailnet 到 VLab）接入，正式 Voice/Gateway 未改动、未重启。

根本解决需要国内音频中转节点（理想是国内运行音箱的 SeedDuplex 会话，仅工具/Agent RPC 跨境），待用户决定服务器。在此之前不能宣称晚间流畅。

## 2026-10-17 02:20 CST：国内 Voice 节点

本分支 `af3e191` 发布包已部署到腾讯云上海轻量服务器，专供音箱：音箱 ↔ 上海 Voice ↔ 火山 SeedDuplex 全在国内，Gateway RPC 经只能转发的 SSH 隧道回 VLab Candidate Gateway（26470）。未改代码，未改动正式 Voice/Gateway。家里模拟器对照：首句 1.3–1.6 s、最大包间隔 92–151 ms、虚拟欠载 0；同时段经新加坡/VLab 为 5.2–8.6 s 与偶发 2 s 输入中断。真机静音诊断 3/3 通过（设备欠载 0，服务端无 `input-paused`）。工具一致性仍受 VLab Candidate 限制（Lark、Codex provider）；Grok 从国内节点的可达性未验证，GPT Live 仍未接入音箱。

# V Voice for Android — Candidate 0.1.1 (2)

Android 11+，独立包名 `com.versa.vvoice.candidate`。此候选从当前已合入的 Voice main 开始；没有改动或合入正在推进的 iOS／入口统一工作，也没有部署服务。

## 实现边界

直接加载 `https://openclaw.tianyi.live/voice/` 的现有 H5：拨号、模型适配、声音播放、字幕、Reaction、任务、Markdown 和文档阅读均使用网页实现。日常网页更新会随加载进入 Android，无需复制 UI 或模型策略。

原生只负责：

- Public 安装凭证、已有 `ios-public`／`ios-binding` 协议、加密入口列表、绑定链接和系统深链。API 名称为历史兼容名称，不新增 Android 专用授权方式。
- Android 麦克风和前台定位权限；后台通话前台服务、音频焦点、通知栏静音／挂断。
- WebView 生命周期、可信来源桥、系统浏览器登录入口和 Markdown 系统文件保存。

新安装准备 Public，不自动拨号或申请麦克风。原入口失效后会提示并返回 Public，保留已保存入口。固定入口仍引用服务端已有的账号、通话人与会话映射。飞书账号在系统浏览器登录后，用网页生成的 App 绑定链接回到 Android 确认绑定。

通话音频继续使用现有 WebRTC／AudioWorklet，前台服务保持后台执行。没有建立另一套语音决策或工具权限。每次拨号的延迟挂断有独立代次，不能结束下一通电话。

仅配置的服务来源能使用桥和麦克风；拒绝子 frame 消息、跨来源链接凭证、证书错误、HTTP 正式服务和重定向凭证发送。安装密钥在 Android Keystore 中加密，Cookie 为 HttpOnly，关闭备份／设备迁移；录音和位置权限按需请求，不请求后台定位。不录制或保存音频。

## 与 iOS 对齐的细节

首页移除独立标题栏，右上角保留设置文字，通话中换成轻量设置图标；阅读器和网页弹层展开时隐藏。设置使用底部面板，Public 固定第一，标记当前入口，支持本机移除绑定；通话中可查看设置，但不能切换或移除入口。Android 返回键依次收起键盘、网页弹层、阅读器和文字输入，再将通话放入后台。加载与错误提示居中，保留系统安全区。

## 构建

需要 JDK 17+、Android SDK 36 / Build Tools 36，以及可用的 Android SDK 环境变量。

```sh
./android/gradlew -p android :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
node --test android/tests/*.test.mjs
```

安装包：`android/app/build/outputs/apk/debug/app-debug.apk`。默认连接正式 Voice 服务；安装和准备入口不会拨号。候选使用开发签名，未提交 Google Play，正式分发需独立签名与发布验收。

`bundleRelease` 可生成未签名 AAB，用于验证商店构建，不等于可发布。正式版不接受 `voiceServiceUrl` 覆盖。

## 无付费模型的 Android 回归

以下操作仅对你指定的测试模拟器执行，不能省略设备序列号。Fixture 使用真实服务、授权及模型适配器，模拟上游模型；不使用真实账号工具，不访问付费模型。

```sh
npm ci
node android/scripts/fixture-server.mjs
adb -s emulator-5584 reverse tcp:29849 tcp:29849
ANDROID_SERIAL=emulator-5584 ./android/gradlew -p android :app:connectedDebugAndroidTest \
  -PvoiceServiceUrl=http://127.0.0.1:29849/voice/
```

测试覆盖 Public 准备不拨号、同页重拨、前台／后台／锁屏采集、合成音频实际进入 Worklet 并消耗播放队列、网页字幕、通知栏挂断和麦克风释放、iframe 拒绝、绑定入口保存与选择、失效回退和加密存储。UI 测试为本地指定模拟器执行；CI 验证编译、lint、单元测试和 H5 桥契约。

只读镜像（可在 Codex 右侧打开）：

```sh
node android/scripts/mirror.mjs emulator-5584
```

测试包与交付包共用源码；生成交付 APK 时必须去掉 `voiceServiceUrl`，核验包内服务地址并保留 SHA-256。

## 验收边界

模拟器链路证据不等于真实手机听感、打断、回声、蓝牙路由或各厂商省电策略验收。Android 定位复用网页按需定位，目前仅前台；不声称与 iOS 的原生后台定位等价。系统浏览器飞书授权需要真人账号验收。Apple 的 App Intents / Live Activity 不属于 Android 实现范围。

版本与具体证据见 `docs/android/candidate-2.md`；上一版保留在 `docs/android/candidate-1.md`。本次按 Voice 内部终端适配选择 Candidate 验证，使用既有 Gateway／授权接口；没有 Gateway、Worker、共享配置或跨服务协议变更。

参考：[Android 麦克风前台服务约束](https://developer.android.com/develop/background-work/services/fgs/service-types#microphone)、[WebView 权限回调](https://developer.android.com/reference/android/webkit/WebChromeClient#onPermissionRequest(android.webkit.PermissionRequest))。

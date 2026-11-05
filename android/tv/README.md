# V Voice Android TV

电视原生薄壳，已从独立本地仓库迁入 v-voice。当前源码 0.3.11，原仓库代码提交 `1c3fcb4a7969fea06ad03819a2f6ea214e37c664`，迁入快照 `905dcb6`。

负责阵列麦克风桥、单 WebView 前台服务、跨应用浮层、遥控焦点及屏幕关闭清理。共享页面在 `../../lab/gpt-live-h5`，本地 fixture 为 `../../scripts/candidate/tv-island.mjs`。首页由独立 family-tv 仓库维护。

## 本地构建

JDK 17/21、Android SDK 34：

```sh
./gradlew --no-daemon :app:testReleaseUnitTest :app:lintRelease :app:assembleRelease
python3 tools/local.py
```

默认包名 `live.tianyi.vvoice.tv.lab`，仅装命名模拟器。正式电视使用受控兼容构建与既有签名，不分发个人入口/签名。真实设备当前已安装 0.3.11-host-focus-tv，配套首页 0.4.19-media-cue-tv；用户确认点击能听到拨号音、加载没有白框。源码迁入本身不重装 APK。真人远场回声、物理 STR 的验收独立保留。

## 发布与回滚

共享服务遵循 `../../docs/unified-release.md`。原生变更另冻结准确 APK、源码和兼容差异，经授权安装；保留原同签名 APK，不清数据。旧仓库和本地冻结证据暂保留用于追溯，不再作为后续开发入口。

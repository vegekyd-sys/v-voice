# V Voice Android TV

电视原生薄壳，已从独立本地仓库迁入 v-voice。原生壳迁入时为 0.3.11，原仓库代码提交 `1c3fcb4a7969fea06ad03819a2f6ea214e37c664`，迁入快照 `905dcb6`。

负责阵列麦克风桥、单 WebView 前台服务、跨应用浮层、遥控焦点及屏幕关闭清理。共享页面在 `../../lab/gpt-live-h5`，本地 fixture 为 `../../scripts/candidate/tv-island.mjs`。首页由独立 family-tv 仓库维护。

## 全屏通话候选 0.4.0

在家庭首页点 V 拨号，接通后按确定或选「全屏」。全屏使用网页通话页。有讲解内容时，画板自动出现在聊天旁边；收起画板后可从「看画面」重新打开。图片可打开查看，多页讲解用「上一页」「下一页」翻页。收起、返回或 Home 后可以打开其他应用，回到桌面再点头像可继续同一通话。放大图片或打开报告时，返回先关闭当前内容。

在仓库根目录运行下列命令可在本地复查。模拟麦克风开始送帧后，替身会提交月相问题、答复和配图。语音、模型与图片来源均在本机。

```sh
TV_FIXTURE_LESSON=1 TV_FIXTURE_RECOVERY=1 node scripts/candidate/tv-island.mjs
```

在另一个终端构建并用下方工具安装到 FamilyTV_UI，打开家庭首页的 V 头像即可体验。

## 本地构建

JDK 17/21、Android SDK 34：

```sh
./gradlew --no-daemon :app:testReleaseUnitTest :app:lintRelease :app:assembleRelease
python3 tools/local.py
```

默认包名 `live.tianyi.vvoice.tv.lab`，仅装命名模拟器。正式电视使用受控兼容构建与既有签名，不分发个人入口/签名。真实设备当前已安装 0.3.11-host-focus-tv，配套首页 0.4.19-media-cue-tv；用户确认点击能听到拨号音、加载没有白框。源码迁入本身不重装 APK。真人远场回声、物理 STR 的验收独立保留。

## 发布与回滚

共享服务遵循 `../../docs/unified-release.md`。原生变更另冻结准确 APK、源码和兼容差异，经授权安装；保留原同签名 APK，不清数据。旧仓库和本地冻结证据暂保留用于追溯，不再作为后续开发入口。

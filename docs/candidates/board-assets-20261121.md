# 画面上的作品（board assets）Candidate · 2026-11-21

分支 `claude/board-assets`。开关 `VOICE_BOARD_ASSETS=1`（要求流式画面，即 `VOICE_BOARD_STREAM` 不为 0）。不开时行为与主线一致。未合入、未上线。

## 要解决的事

有了讲解画面之后，通话里生成的图片和视频反而看不到了：它们走对话区的卡片，手机上被画面盖住；讲解工具还写明「不会生成图」。语音模型对生成结果只有一条链接文本，对屏幕上有什么并不知道。Tianyi 11/21 的要求：

1. 生成的画面能成为讲解中的一个画面。
2. 生成出来的图片、视频，V 要能感知：「生成一张海报」→「把它动起来」。
3. 画面成为图片和视频模型的交互空间。

## 做法：每通电话一个素材架

`lab/gpt-live-h5/board-assets.mjs`。本通话里 V 生成的每张图、每段视频都登记成一件「素材」：短编号（a1、a2…）、类型、从哪件变来、状态（生成中 / 好了 / 没做成）、生成时的要求，以及看过一眼之后的「图里有什么」。它有三个读者：

| 读者 | 拿到什么 |
|---|---|
| 页面 | 新区块 `work`（`{"t":"work","asset":"a1"}`）。生成一开始画面上就有铅笔稿；图好了在同一个框里显影；让图动起来时，视频接过图的框。同一件东西的各个版本共用一个框，下面一排小图可以回看。 |
| 语音模型 | 指令里多一段「屏幕素材现状」，素材变化时静默更新（和设备状态同一条通道：豆包用成对的历史记录，Grok 用 session.update）。创作命令里 `--image a1` 由服务换成真实链接，模型不用抄链接。工具结果里带编号和「图里有什么」，V 可以说出画面里真实的内容。 |
| 画面作者 | 请求里多了 `assets`（已有的作品）和 `make`（这通电话能不能现画）。可以把已有作品放到讲解页上；能现画时可以要一张：`{"t":"work","make":"…"}`，一次回答最多一张。 |

来源有三种：

- **通话里直接生成**（`exec makaron …`，目前只有 Tianyi 本人主入口有执行器）：命令开始即登记，结果回来即显影。
- **后台 V 生成**（`delegate_to_v`，所有入口）：结果里的图片、视频链接登记上架。后台生成期间画面上没有铅笔稿（事先不知道它会出图）。
- **讲解时现画**：只在通话自己有执行器时（同上，本人主入口）；每通电话最多 `VOICE_BOARD_MAKE_MAX` 张（默认 3）。

交互：点一下作品就是「这张」（服务端记住，写进「屏幕素材现状」）；点中后旁边出现「动起来」「再来一版」，点了等于打字说了那句话，走的仍是语音模型自己的工具调用。

## 改了哪里

- 新文件：`board-assets.mjs`（素材架 + 看图）、`board-assets-client.mjs`（页面侧）、`ui/board-work.jsx`（作品区块）、测试 `board-assets.test.mjs`。
- `board-scene.mjs`：区块类型 `work`。
- `board-director.mjs`：`place` / `retitle` / `state`；画面作者写的 `work` 区块的校验和现画；同一请求里作品页不被另开一页顶掉；有作品的页不再另贴照片。
- `session.mjs`：创作命令开始 / 结束时登记；「屏幕素材现状」的更新；交后台时附上素材链接；讲解现画的执行器。
- `seeduplex-realtime-provider.mjs`：`updateTerminalContext` 可带通知名和应答句（原行为不变）。
- `server.mjs`：开关、`/api/board-assets`（iOS 走 `page/board-assets`，不需要新 App）、接到审计流。
- `board-lesson.mjs`：讲稿请求可带 `assets` 和 `make`。
- 页面：`board.jsx`、`call-ui.jsx`、`call-view.mjs`、`app.js`、`ios/H5/native-h5.mjs` 各几行接线；`styles.css` 一段样式。

## 与画布线（`claude/board-canvas-live`）合并时

- 两边都改了 `board-scene.mjs`（各加一种区块）、`board-director.mjs`、`board.jsx`、`server.mjs`、`styles.css` 和候选脚本；改动位置不同，冲突应限于相邻行和重新生成的打包文件。候选脚本已采用画布线的写法（`VOICE_BOARD_CANDIDATE` / `_PORT`），只多了 `VOICE_BOARD_ASSETS`。
- 看图是同一件事：画布线的 `board-eye.mjs` 看照片找「讲到哪圈到哪」，这里的 `createAssetEye` 看作品说「图里有什么」，并且已经让模型顺带写出各部位的位置（`parts`，千分比框，目前只存不画）。合并后可以让画布的 `stage` 直接放作品（`pic` 指向素材），指针在生成的图上圈着讲；两次看图可以并成一次调用。
- `photo`、`stage` 上有「一页一张大图」的规则，这里把 `work` 也算作大图。

## 验证过的

- 单元测试 17 项（素材登记、编号换链接、版本共用一个框、失败重来、视频等待超时后续上、看图超时不挡结果、后台结果入架、点选、作品页不被顶掉、画面作者只能放架上有的、讲解现画、页面侧轮询）。全量 `npm test` 通过。
- 本机替身环境 `node scripts/candidate/board-assets.mjs`（真实的 H5、语音服务、创作执行器和素材架；语音模型、Makaron CLI、画面作者、看图是替身，不产生任何真实生成）。无头 Chromium 桌面和手机宽度各跑一遍：铅笔稿 → 显影 → 点选 → 动起来 → 视频原位替换；讲解页里现画一张。截图在 `docs/acceptance/board-assets-20261121/`。

## 没验证的（要真实通话）

- 豆包 / Grok 是否按「屏幕素材现状」用编号（`--image a1`），以及是否会把看到的内容说出来。
- 通话中途静默更新指令对豆包是否稳定（设备状态一直在用同一条通道，但素材更新更频繁、文字更长）。
- 画面模型（DeepSeek）能不能看图、看得准不准、要多久。可用 `scripts/candidate/asset-look-on-v.sh <图片链接>` 单独验证（一次模型调用，不打电话）。看图失败不影响其余功能，只是 V 说不出图里的细节。
- 真实生成的耗时下，讲解里现画的图赶不赶得上讲到它的那一句。
- 真机 iPhone、飞书内嵌页。

## 用法

```bash
VOICE_BOARD_CANDIDATE=board-assets-20261121 VOICE_BOARD_CANDIDATE_PORT=29647 VOICE_BOARD_ASSETS=1 scripts/candidate/deploy-board.sh
VOICE_BOARD_CANDIDATE=board-assets-20261121 VOICE_BOARD_CANDIDATE_PORT=29647 VOICE_BOARD_ASSETS=1 scripts/candidate/deploy-board.sh --update
VOICE_BOARD_CANDIDATE=board-assets-20261121 scripts/candidate/deploy-board.sh --stop
```

候选的画面记录在它自己的 `transcripts/board-<UTC 日期>.jsonl`：`board.asset`（每件素材的状态和耗时）、`board.asset-look`（看图是否成功、耗时）、`board.place`。

## 还没做

- 搜到的照片（图集、配图）不在素材架上：它们没有公开链接，V 知道画面上有图集，但不能直接拿某一张去改或动起来。
- 圈一块地方改图、版本对比、视频作为讲解画面。
- 非本人入口的直接生成（现在只能经后台，等待更久）。是否放开是权限和费用的决定，不在这次范围内。

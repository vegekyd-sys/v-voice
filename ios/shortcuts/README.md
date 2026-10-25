# Notes 快捷指令模板（Candidate）

生成器位于 `../scripts/make-apple-notes-shortcuts.py`。它输出可检查的 unsigned plist，不含真实正文、token 或个人签名。必须使用已安装 App 的十位 signing TeamIdentifier：

```sh
python3 ios/scripts/make-apple-notes-shortcuts.py /private/output --team-id TEAM_ID
shortcuts sign --mode people-who-know-me \
  --input '/private/output/V 新建备忘录.unsigned.shortcut' \
  --output '/private/output/V 新建备忘录.shortcut'
```

追加模板同样签名。个人签名文件保留在私有目录，不提交仓库；用于分发的 `anyone` 签名需另行生成和核验。

新建模板：解析 Shortcut Input 字典 → requestID/token/text → 实际创建 Note（OpenWhenRun=false）→ 从 Note 获取文本 → 已安装 V Voice 的 VerifyAppleNoteIntent → Stop and Output。绝不将输入 text 直接连接 savedText。追加模板在导入时要求选定固定 Note；其输出必须是实际追加后的 Note，待真机确认。

导入成功、签名成功、动作目录可见分别记录；都不等于真实写入成功。iPhone 上须确认核对动作识别，再通过当前 V 请求测试完整回执。Mac 没有 iPhone 专用 V Voice 动作的可执行环境，不能用 Mac 预览替代真机接受。当前状态见 `../../docs/ios/ios-use/validation.json`。

依据：[Apple Shortcuts CLI 与签名](https://support.apple.com/guide/shortcuts-mac/apd455c82f02/mac)、[打开编辑页的 URL scheme](https://support.apple.com/guide/shortcuts/apda283236d7/ios)。Notes 创建和文本读取参数已用本机苹果编辑器实际生成的 workflow 校对；导入问题格式参考 [Cherri 编译器源码](https://github.com/electrikmilk/cherri/blob/main/shortcutgen.go)。

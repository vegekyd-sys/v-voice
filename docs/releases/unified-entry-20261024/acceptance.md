# 电话入口与 App 绑定统一：生产验收

用户完成手机飞书 Candidate 验收并授权上线。PR #129 合入 main 后，合入提交的 Voice、speaker 和发布控制测试全部通过，使用统一发布器发布到 web/iOS 与上海设备服务两个节点。

生产运行提交和产物 hash 见同目录 release.json；两个节点均 ready，发布 hold 已释放。Gateway 的 PID、InvocationID、启动时间和配置 hash 与发布前完全相同；原 Voice 版本、启动参数、私有环境和回滚回执保留。

已核对生产 V 应用的免登 callback 白名单、Voice/Gateway app ID 与旧入口配置。现有配置足够，无需修改飞书权限、事件、回调或重新发布应用。旧群/私聊的 App ID 映射由服务端规范化兼容。

正式域名的 7 个公开资源与发布产物逐文件 hash 一致。飞书客户端入口 HTTP 探针确认完整电话页位于已登记 callback，页面配置使用生产应用。浏览器确认：已登录旧私聊显示原会话和 1 个历史设备；旧群显示实际群名和既有设备；访客保留 iOS App 入口；首页更新日志显示本次正式更新。无自动拨号或付费模型调用。

HTTP 探针和浏览器不是生产手机 SDK / 音频验收。用户的真机验收发生于 Candidate；本次不升级 Swift 或固件，不改变 build 32 稳定音频基线。

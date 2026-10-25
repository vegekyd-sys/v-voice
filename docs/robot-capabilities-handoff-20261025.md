# StackChan 能力线交付（进行中）

总控：V Voice 总控；本路不合并、不上线、不刷机、不占共享 VLab。

## 继承基线

- Voice 独立 worktree：`voice-shared-terminal-behavior/v-voice`，分支 `codex/stackchan-capabilities-20261025`，基于 main `ab8ad23`。
- 固件独立 worktree：`v-stackchan/worktrees/controlled-capabilities-20261025`，分支 `codex/stackchan-controlled-capabilities-20261025`，继承 `8d88b0b` / PR #1 的 rc2 收音、清队列修复。PR #1 尚为草稿，不能退回仓库默认分支的旧音频行为。
- 上次真人确认：rc2、1 米、播放音量 75、输出增益 1.6，自然插话及时、播放清楚、没有误停。100% 音量未通过，后台任务最终参数回归仍缺。此次不把历史听验外推为新固件验收。

## 已知硬件实现与待核实现场

- 当前板级配置为 ESP32-S3 / CoreS3，GC0308 DVP 摄像头，320×240、20 fps；已有拍照/JPEG 上传、视觉模型描述、无快门音的音频并行 worker。拍照结果必须来自当前请求的真实图片。
- 两根 SCS 舵机：yaw（id 1）软件限位 −128°…128°；pitch（id 2）3°…87°且有堵转保护。没有 roll 轴，不能声称真的左右歪头。自然操作将采用更小范围，单位明确为角度；物理校准/NVS、在线反馈决定实际可用范围。
- 已有 `self.robot.get_head_angles/set_head_angles`，但旧接口成功只证明已下发；读失败会退回软件估算角度，不能充当硬件完成证据。需要明确反馈有效性、deadline、取消与完成状态。
- 现有 35 种机器人 Reaction 由 Voice 目录生成；本路改为复用 H5 的语义选择结果，只做脸与两轴动作映射，不另建机器人语义分类器，不逐帧调用模型。

## 公共薄层需求（位置线牵头，本路不另建注册中心）

- 服务端注入 `version`、`terminal.kind=robot`、可信 actor/session/device 绑定；能力状态来自已认证连接的探测与运营配置交集，模型不能选择其他设备或扩权。
- 本路提供模块适配器：`capabilities()` 和 `execute(operation, params, {requestId, voiceSessionId, deadline, signal})`；公共薄层负责请求 owner、去重、过期、断线与权限拒绝传播。适配器仍在执行前/后核对当前连接，拒绝旧会话回执。
- 暂定操作：`robot.observe`、`robot.move`、`robot.gesture`、`robot.reaction`、`robot.cancel`。精确名称可随公共薄层统一。前端保留少量 look / robot 动作工具；后端 `robot-use` 通过同一薄层请求当前端，禁止失败后转 exec/其他设备绕过。
- 摄像头需请求级 upload 关联（requestId / 当前通话 / 单次 token），图片只交视觉模型，不将上传令牌交给模型；返回真实照片摘要与采集证据。同一通话继续回答，拍照超时或取消不阻断音频。
- 动作返回 accepted / running / completed / cancelled / expired / failed；只有有效硬件反馈到目标才 completed，单纯下发不能 completed。表情回执只证明渲染已应用，不能证明电机已到位。

## 预计公共文件接入点

- 本路模块集中在 `lab/robot/`、`xiaozhi-wire.mjs` 和设备端点，固件在独立仓库。
- 共享 `session.mjs`、`tools.mjs`：仅增加小型适配器调用/工具入口；与位置线的当前端上下文及设备请求 hook 接口协同，避免重复实现 owner 与后端转发层。候选交付会列出精确冲突点。
- `robot-use` 入口短文，视觉/动作详情按需加载。候选 V 的实际发现与后端加载另列证据，不能只以 Markdown 文件存在宣称完成。

## 验证计划

本地确定性回归覆盖能力缺失、限位、节流、取消、过期、旧连接与错误回执；私有 Candidate 验证 Skill 发现和真实模型工具路径。硬件刷写与现场拍照/可观察动作由总控排期，保留当前镜像及参数备份，不误刷 ReSpeaker。

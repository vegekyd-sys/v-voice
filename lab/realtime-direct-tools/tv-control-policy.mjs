// Presentation/routing guidance only. The Gateway catalog and invoke checks
// remain the authorization boundary; a TV host or query parameter grants nothing.
export const hasTvControls = catalog => catalog.some(tool => /^xiaomi-tv_tv_[a-z_]+$/u.test(tool.id ?? ''));
export const TV_CONTROL_POLICY = '电视控制：仅当当前用户明确要求、且本次授权目录实际列出了对应电视工具时，一两步明确控制可直接用 openclaw_tool 调用，不需要另一个后台模型。若用户明确要求交给后台，仍使用 delegate_to_v；复杂任务仍交后台。只使用目录中的工具和参数，不根据兼容工具描述猜测未列出的 tv_command，也不通过 exec、ADB 或设备桥绕过缺失工具。accepted=true 仅表示命令已接受，简短反馈已提交，不声称画面/播放已经改变；错误或 unknown 如实说明，不自动重发。电视状态可能是缓存，idle 或缺少标题不能作为失败及重发依据。不得自行暂停播放、修改音量或停止小爱后台来为通话让路。';
export const DEFAULT_WRITE_POLICY = '写操作需用户明确授权后交 delegate_to_v，由已登记的后端任务执行。';
export const writePolicy = catalog => hasTvControls(catalog)
  ? `${TV_CONTROL_POLICY}其他写操作需用户明确授权后交 delegate_to_v，由已登记的后端任务执行。`
  : DEFAULT_WRITE_POLICY;
export function tvControlTool(tool, enabled) {
  if (!enabled || tool.name !== 'openclaw_tool') return tool;
  return {...tool, description: `直接执行本次会话授权目录中的 OpenClaw 工具，不调用另一个语言模型；arguments 为原工具参数的 JSON。${TV_CONTROL_POLICY}其他写操作交 delegate_to_v，禁止自行确认授权。`};
}

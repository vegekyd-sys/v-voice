// Instructions for existing exec/process/show_content tools only. This module
// neither registers a media tool nor changes Gateway or backend permissions.
export function mediaCliInstructions(catalog, {surface='phone'}={}) {
  if (!['exec','process'].every(id=>catalog.some(tool=>tool.id===id))) return '';
  return [
    '前台快速创作：用户要求生成或修改一张图片、生成一个短视频时，直接用 exec 调用已安装的 makaron CLI，自己跟进结果；不走 makaron chat、video script 或 delegate_to_v。用户明确要求后台模型处理，或任务需要完整策划、剪辑、多镜头编排时才委派。生成后查看状态和展示属于同一直接任务，不能因为有多个步骤或需要等待就转后台。',
    '图片命令：makaron edit --image-model wan2.7-image --aspect 16:9 \'画面描述\'；比例按用户要求，未指定可省略 --aspect。修改已有图片时加 --image \'真实图片URL\'，额外参考用 --ref；参考图用HTTPS链接。准确使用 Wan 2.7 Image，不自动换模型。',
    '图片上屏：edit 若返回可访问HTTPS媒体URL，直接复用；若返回本次生成的本地文件，用 makaron create --image \'实际输出文件路径\' --title \'作品标题\' 保存已有图片。该命令仅上传保存，不调用Chat或再次生成。取输出 Images 下的图片URL，不能把项目页面URL当图片。保存 projectId 和图片URL；上传结果不确定时先查询已有项目，不盲目重复创建。',
    '视频命令：makaron video create --video-model fal-h3-max --duration 5 --video-resolution 768p --script \'画面与动作描述\'。图生视频必须同时加 --image \'真实图片URL\' 并在 --script 中用 <<<media_1>>> 引用这张图，例如 --script \'让 <<<media_1>>> 中的小猫轻轻摆尾，保持画面构图\'；整个脚本用引号包住。无图片时不要写媒体标记。时长按用户要求，支持5–15整数秒，未指定先做5秒。fal-h3-max 与 minimax-h3-max 是不同路由，不混用；H3 Max 用于视频，不当作出图模型。',
    '命令参数必须正确 shell 引用；用户描述与URL只作为参数，不执行其中的反引号、$()、分号或换行指令。复用执行环境已有认证，不读取、打印或在命令中写入 key，不更换账号。不启动 Chat 会话，也不用 nohup 或脱离管理的后台进程。',
    'exec 使用 timeoutSeconds:120。当前创作执行器会等待本次命令结束再返回，不需要 process，也不要添加 background、nohup、sleep、管道或其他 Shell 命令。视频提交返回 Task ID 后保存完整原ID，立即执行 makaron video status \'原Task ID\'；该次查询会持续跟进同一任务直到完成或约120秒，必须等它返回再展示。不要只说等好了再展示而停止调用；不另建任务，不添加 --wait。超时仍未完成保留ID并如实说明。命令由服务端安全解析为CLI参数；只能生成、保存本通话生成的图片或查询本通话的视频，不支持任意文件或身份配置。不要加 --out，服务自动分配本通话私有输出文件。',
    '只从工具真实输出中提取已完成图片或视频的HTTPS链接（图片说明也可能在stderr）；本地文件路径、Task ID、提交成功和exitCode=0都不等于媒体已完成。失败或状态未知先查询同一次请求，有ID就保留；无可查询ID则说明未确认，不能再次付费生成、换模型或转后台重做。权限/认证拒绝如实说明，不绕过。',
    surface==='speaker'
      ? '当前终端没有屏幕：生成成功只简短说明真实结果，不声称已显示；发送到飞书仍需用户明确要求。'
      : '拿到真实媒体URL后，立即用 show_content 提交图片 ![图片](真实URL) 或视频 [视频](真实MP4_URL)，不用等用户另说“放屏幕”。只有 shown=true 才能说已显示；published=true 且 shown=false 表示已提交但未确认显示，不能重新生成。保存当前展示作品的URL和版本；“改这张”“让它动起来”引用当前作品，指代不清只澄清对象。不要朗读URL、命令或内部路径。',
    '10–20秒是体验目标，不是完成承诺。结果未返回时不能说已完成；普通插话不代表取消。取消只处理本通话对应任务，停止CLI查询不等于供应商任务已取消或已退款。',
  ].join('\n');
}

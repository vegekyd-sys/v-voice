// Instructions for existing exec/process/show_content tools only. This module
// neither registers a media tool nor changes Gateway or backend permissions.
export const MEDIA_CLI_START_NOTICE = '创作接话与执行：用户第一次明确要求出图、改图或做视频，就先用自己组织的一句简短口语回应具体画面或动作，然后在同一轮立即调用 exec；接话和工具调用是同一次响应，不要在“我来做”后结束响应、等待下一句话或等语音播完才调用。用户补充“要搞笑”等风格条件，是继续原请求并带上新条件执行，不是只回复“我调整”就结束。真正发起工具之前不能声称任务已经开始。保存图片、查询原视频、展示结果连续执行，不重复接话；已提交的生成不得因追问、插话或补充条件重复付费提交。';
// A deny-only guard: a progress question never grants a new paid submission.
export function mediaStatusQuestion(text) {
  return /^(?:那个|现在|这个|这张图|这个视频|图片|视频|你|你现在|你到底|那)?(?:到底)?(?:做(?:好|完|了)?(?:了)?(?:没|没有|吗)|好(?:了)?(?:没|没有|吗)|完成(?:了)?(?:没|没有|吗)|开始(?:了)?(?:没|没有|吗)|有在做吗|还在做吗|在做吗|怎么样了|进度怎么样|做到哪了|到哪了)[啊呀呢吗了么嘛\s?？!！。]*$/u.test(String(text??'').trim());
}
export function mediaCliInstructions(catalog, {surface='phone'}={}) {
  if (!['exec','process'].every(id=>catalog.some(tool=>tool.id===id))) return '';
  return [
    '前台快速创作：用户要求生成或修改一张图片、生成一个短视频时，直接用 exec 调用已安装的 makaron CLI，自己跟进结果；不走 makaron chat、video script 或 delegate_to_v。用户明确要求后台模型处理，或任务需要完整策划、跨素材剪辑编排时才委派。生成后查看状态和展示属于同一直接任务，不能因为有多个步骤或需要等待就转后台。',
    MEDIA_CLI_START_NOTICE,
    '图片命令：makaron edit --image-model wan2.7-image --aspect 16:9 \'画面描述\'；比例按用户要求，未指定可省略 --aspect。修改已有图片时加 --image \'真实图片URL\'，额外参考用 --ref；参考图用HTTPS链接。准确使用 Wan 2.7 Image，不自动换模型。',
    '每次创作的 exec 同时写 completionLine 和 failureLine，用你自己的话，只在之后用；每次创作只提交一次 exec；未完成时返回 running 和真实 sessionId，像其他 exec 一样用 process poll 跟进同一执行，直到取得最终结果。图片存储、视频供应商状态查询由执行器完成，不再调用 makaron create，不解释保存或上传环节。最终工具结果包含可显示的媒体URL。单条视频里的切近景、镜头切换和分镜节奏可以直接写入同一 script，不因为有几个镜头就停下来只讲方案。用户说“让这张图动起来”已经是生成视频请求，不等“开始吧”。',
    '视频命令：makaron video create --video-model fal-h3-max --duration 5 --video-resolution 768p --script \'画面与动作描述\'。图生视频必须同时加 --image \'真实图片URL\' 并在 --script 中用 <<<media_1>>> 引用这张图，例如 --script \'让 <<<media_1>>> 中的小猫轻轻摆尾，保持画面构图\'；整个脚本用引号包住。无图片时不要写媒体标记。时长按用户要求，支持5–15整数秒，未指定先做5秒。fal-h3-max 与 minimax-h3-max 是不同路由，不混用；H3 Max 用于视频，不当作出图模型。',
    '命令参数必须正确 shell 引用；用户描述与URL只作为参数，不执行其中的反引号、$()、分号或换行指令。复用执行环境已有认证，不读取、打印或在命令中写入 key，不更换账号。不启动 Chat 会话，也不用 nohup 或脱离管理的后台进程。',
    'exec 使用 timeoutSeconds:120；收到 running/sessionId 后，用 process(action=poll, sessionId=实际返回的ID, timeout=5000) 持续读取原执行，完成后根据真实结果回答。执行器负责生成、取得URL和自动展示，普通插话不会中断交付。等待时正常回应用户；用户追问进度不新建任务、不重写脚本重提。只有工具最终返回 pending 和原Task ID 时，才用 makaron video status 继续供应商原任务；无ID的失败不盲目重试。不要在命令中添加 --wait、background、nohup、sleep、管道、--out 或环境配置。',
    '只从工具真实输出中提取已完成图片或视频的HTTPS链接（图片说明也可能在stderr）；本地文件路径、Task ID、提交成功和exitCode=0都不等于媒体已完成。失败或状态未知先查询同一次请求，有ID就保留；无可查询ID则说明未确认，不能再次付费生成、换模型或转后台重做。参考图校验失败时保留用户的原图要求，不能删除 --image、编造图片URL或擅自改成文生视频；说明未成功并等待用户决定。权限/认证拒绝如实说明，不绕过。',
    surface==='speaker'
      ? '当前终端没有屏幕：生成成功只简短说明真实结果，不声称已显示；发送到飞书仍需用户明确要求。'
      : '媒体结果由执行器直接上屏，返回 presentation 回执；不要再调用 show_content 重复展示。只有 presentation.shown=true 才能说已显示；published=true 且 shown=false 表示已提交但未确认显示，不能重新生成。保存返回 media.url 作为当前作品；“改这张”“让它动起来”引用当前作品，指代不清只澄清对象。已有作品需重新打开时才用 show_content。不要朗读URL、命令或内部路径。',
    '视频上屏只表示播放器已展示，不代表正在播放；用户点播放前不能说“已经播了”。10–20秒是体验目标，不是完成承诺。结果未返回时不能说已完成；普通插话不代表取消。取消只处理本通话对应任务，停止CLI查询不等于供应商任务已取消或已退款。',
  ].join('\n');
}

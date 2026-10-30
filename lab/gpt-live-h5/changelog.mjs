export const ONE_VOICE_CANDIDATE_UPDATE = {
  version:'voice-one-v.20261030.1',date:'2026-10-30',
  title:'等任务时听起来始终是 V 一个人（Candidate）',status:'candidate-validation',
  items:[
    'V 不再说“交给后台”，进度和结果都用第一人称。',
    '结果从结论开始说，去掉“我查下”这类开场；完整内容仍在屏幕上。',
    '不再播报“已经多少秒”，只说真实进展；很久没动静时最多说两句，不带时间。',
    '任务还没做完时，V 如果抢先说“整理好了”，会被当场拦下并改口。',
    '尚未上线；合成通话已验证，真人听感待验收。',
  ],
};

export const WEB_DIAL_CANDIDATE_UPDATE = {
  version:'voice-web-dial.20261028.1',date:'2026-10-28',
  title:'网页拨号减少重复等待（Candidate）',status:'candidate-validation',
  items:[
    '网页将本次身份核验、创建通话和语音接入放到同一条连接，减少接通前的重复请求。',
    '保留每通电话的身份和权限检查，取消拨号会关闭本次连接。',
    '仅候选验证，完整飞书菜单至接通的真实收益仍待对照；不需要更新平台或原生 App。',
  ],
};

export const IOS_GPT_TRANSPORT_CANDIDATE_UPDATE = {
  version:'voice-ios-gpt-transport.20261027.1',date:'2026-10-27',
  title:'iOS GPT Live One 连接修复（Candidate）',status:'candidate-validation',
  items:[
    '修复已绑定会话选择 GPT Live One 后，拨号因传输信息缺失而失败的问题。',
    '候选已验证原生 WebRTC 双向合成音频、字幕、静音恢复与挂断。',
    '尚未上线，真实 iPhone 收音、扬声器、打断和后台通话等待验收。',
  ],
};

export const GROK_VISIBILITY_CANDIDATE_UPDATE = {
  version:'voice-grok-visibility.20261027.1',date:'2026-10-27',
  title:'正式模型目录收敛（Candidate）',status:'candidate-validation',
  items:[
    '正式电话模型列表保留小何和 GPT Live；Grok 测试路径由服务端显式开启。',
    '旧 Grok 选择在空闲刷新后回到可用模型，不切换正在进行的通话。',
    '仅候选验证，尚未合入或上线；设备测试配置和原生版本保持。',
  ],
};

export const STARTUP_LATENCY_CANDIDATE_UPDATE = {
  version:'voice-startup-latency.20261027.3',date:'2026-10-27',
  title:'飞书进入与 App 拨号减少等待（Candidate）',status:'candidate-validation',
  items:[
    '飞书身份准备直接随首页加载，减少开始识别账号前的网络等待。',
    '网页与 App 拨号复用同一次请求刚完成的会话核验，减少重复等待；新请求仍重新核验。',
    '语音连接与打断检测并行准备，两者就绪后才接通；飞书只读工具在实际使用时检查授权。',
    '通话预约后提前准备当前会话，与连接握手并行；同时到达的相同账号与会话请求合并进行中的核验。',
    '仅隔离候选验证，真实手机与 Action Button 接通时间仍待实测，尚未上线。',
  ],
};

export const ENTRY_LATENCY_CANDIDATE_UPDATE = {
  version:'voice-entry-latency.20261027.1',date:'2026-10-27',
  title:'电话进入速度优化（Candidate）',status:'candidate-validation',
  items:[
    '电话页优先开始飞书身份确认，缩短等待页面程序加载的时间。',
    '重复进入复用相同版本的页面程序；账号、会话和成员资格仍逐次核验。',
    '仅隔离候选验证，尚未上线；真实手机与飞书客户端速度另验。',
  ],
};

export const FEISHU_LOGIN_PERSISTENCE_CANDIDATE_UPDATE = {
  version:'voice-feishu-login-persistence.20261026.1',date:'2026-10-26',
  title:'外部账号登录保持与身份切换（Candidate）',status:'candidate-validation',
  items:[
    '通过飞书卡片确认后，重新打开电话保留已确认账号，不再因免登失败退回 Public。',
    '电话首页显示当前使用方式和连接飞书身份入口，可以主动切换身份。',
    '切到 Public 后，可从账号设置返回上次连接的账号与会话。',
    '旧登录需重新确认一次；之后在原有 30 天有效期内保留，每次访问仍检查会话资格。',
    '已完成本地页面与回归验证，尚未上线。',
  ],
};

export const FEISHU_CARD_CONFIRM_CANDIDATE_UPDATE = {
  version:'voice-feishu-card-confirm.20261025.5',date:'2026-10-25',
  title:'飞书身份原页确认与账号界面优化（Candidate）',status:'candidate-validation',
  items:[
    '打开页面保留原来的电话按钮；点击后换上 V 的引导表情，以一句提示引导回飞书确认，确认后原页连接。',
    '姓名与群会话分层显示，简化账号设置；网页右上角直接进入 iOS 绑定。',
    '确认后的姓名与群会话可以一起绑定到 iPhone，同群不同账号的绑定分别保留。',
    '身份与权限由服务端核验，群入口不会授予其他成员的个人工具账号。',
    '身份链路已完成真实内外部账号验证；新界面通过本地交互与 iOS 模拟器验收，尚未合入或上线。',
  ],
};

export const ACCESS_MODES_CANDIDATE_UPDATE = {
  version:'voice-access-modes.20261025.1',date:'2026-10-25',
  title:'Public、账号会话与设备权限（Candidate）',status:'candidate-validation',
  items:[
    '使用方式归为 Public 和已连接账号与会话，设备与权限集中管理。',
    '网页 Public 与飞书访客沿用 V 原有搜索、记忆和后台任务。',
    '固定网页保留预配置账号、通话人和会话，音箱与机器人可引用同一入口映射。',
    '私有入口失效时可明确选择 Public；不自动切换身份或拨号，原绑定仍保留。',
    'App 首页显示当前入口，设置页展示 Public、我的账号与会话、设备与权限。',
    '当前为候选验证，尚未合入、发布或更新 TestFlight。',
  ],
};

// Product-facing notes for shipped Voice updates. Keep newest entries first;
// experiments and unaccepted capabilities do not belong in this list.
export const IOS_PUBLIC_CANDIDATE_UPDATE = {
  version:'voice-ios-public.20261025.3',date:'2026-10-25',
  title:'Public 搜索、记忆与后台任务（Candidate）',status:'candidate-validation',
  items:[
    'Public 使用 V 原有网页搜索、记忆搜索和后台任务，前后台遵守同一份个人内容红线。',
    '全新安装自动准备独立 Public 访客会话，无需飞书登录或复制链接；启动不会自动拨号。',
    '保留已有入口和当前选择，可添加多个绑定并查看已验证账号标签。',
    '设置页共用一个入口列表：Public 固定第一，其他会话依次排列；选中状态、添加与移除采用统一的轻量样式。',
    '会话列表提供可见的本机移除按钮，移除当前额外入口后回到 Public。',
    '首次系统权限需要时操作按钮引导到前台；已有授权继续后台通话。',
    '后台结果沿用报告卡片，挂断不中断已接纳任务；明确取消仍控制原任务。',
    '仅 Candidate，真机声音、锁屏和操作按钮验收另行登记。',
  ],
};
export const IOS_IDENTITY_CANDIDATE_UPDATE = {
  version:'voice-ios-bound-identity.20261024.2',date:'2026-10-24',
  title:'iOS 身份、日历与内容提示修复（Candidate）',status:'candidate-validation',
  items:[
    '绑定时同时保存已验证的飞书姓名，App 通话继续使用这份来电人身份。',
    '从飞书重新生成绑定链接时，补齐同一账号、同一会话旧绑定缺失的姓名。',
    '切换飞书账号或从访客绑定到飞书时，App 不再复用另一身份的旧绑定。',
    '恢复按当前已验证飞书账号直接查询日历，简单查询无需转交后端模型。',
    '修复新通话残留旧内容已清除提示，以及旧内容请求晚到时误显示错误。',
    '仅 Candidate 验证，尚未合入或上线。',
  ],
};
export const UNIFIED_ENTRY_CANDIDATE_UPDATE = {
  version:'voice-unified-entry.20261024.1',date:'2026-10-24',
  title:'电话入口与 App 绑定统一（Candidate）',status:'candidate-validation',
  items:[
    '直接显示电话页面，在页内确认飞书账号，移除独立的账号识别页。',
    '新旧群链接和私聊共用会话映射，保留已有 App 绑定与原通话记录。',
    '访客也可使用 iOS App 入口，继续自己的访客对话。',
    '仅 Candidate 验证，尚未合入或上线。',
  ],
};
export const RESPONSIVE_INTERRUPTION_CANDIDATE_UPDATE = {
  version:'voice-responsive-interruption.20261024.1',date:'2026-10-24',
  title:'轻声插话响应修复（iOS 32 候选）',status:'candidate-validation',
  items:[
    '修复上一候选中已确认的人声仍被音量和持续时间门槛挡住的问题，轻声、短句更容易打断。',
    '保留人声确认、忽略旁聊后续播和新回答替换旧尾音。',
  ],
};
export const CONFIRMED_INTERRUPTION_CANDIDATE_UPDATE = {
  version:'voice-confirmed-interruption.20261024.1',date:'2026-10-24',
  title:'插话误停播修复（iOS 31 候选）',status:'candidate-validation',
  items:[
    '播放时的疑似声音不再单独触发短暂停顿，本地确认人声后仍可及时插话。',
    '保留旁聊被忽略后接着播放，以及新回答替换旧尾音。',
    '修复测试中发现的通话结束时偶发退出；当前为真机验证候选。',
  ],
};
export const FEISHU_MULTIUSER_CANDIDATE_UPDATE = {
  version:'voice-feishu-parity.20261024.1',date:'2026-10-24',
  title:'电话与文字共用能力（独立 Candidate）',status:'candidate-validation',
  items:[
    '新群和机器人私聊可自动出现电话入口，打开后由飞书确认来电者身份。',
    '电话沿用对应文字聊天的会话与工具权限，不同人的任务和通话记录分别校验。',
    '当前在独立 Candidate 使用 VLab 飞书验证；新群和首次私聊真实入口验收进行中，生产未开放。',
  ],
};
export const SESSION_REPLY_CANDIDATE_UPDATE = {
  version:'voice-session-call.20261023.7',date:'2026-10-23',
  title:'私聊通话体验与摘要修复（候选）',status:'candidate-validation',
  items:[
    '私聊和群聊统一为通话状态与结束纪要，不再逐轮刷问答卡。',
    '通话提示改为「V正在电话通话」，结束后原地显示「V电话通话已结束」与总时长。',
    '短通话摘要采用低推理强度，临时失败自动重试一次；完整对话始终保留。',
    'V 会像助理整理会议纪要一样，以第一人称开场归纳重点和结论；总结卡不再重复时长与提问次数。',
    '网页右上角 iOS App 入口可打开 App 设置并自动填好绑定链接；已绑定同一会话可直接继续。',
    '飞书登录可保持 30 天，服务更新不再导致重复授权；首次使用仍需确认身份。',
    'TestFlight 下载待本轮验收后开放。',
    '支持查看和解除已绑定 App；旧个人电话入口继续兼容。',
    '同步主干 iOS build 24 的统一电话能力桥和查询接话更新。',
    '本轮仅候选环境验证，尚未发布 TestFlight 或正式上线。',
  ],
};
// Used only by the isolated candidate's release file, never VOICE_UPDATES.
export const NATIVE_DUPLEX_CANDIDATE_UPDATE = {
  version:'voice-seeduplex-duplex.20261022.7',date:'2026-10-22',
  title:'原生多人和停声验证候选',status:'candidate-validation',
  items:[
    '修复已接受挂断却没有后续告别语音时，电话一直不结束的问题。',
    '收紧停声条件：未说完的“先停”不再直接取消正在播的回答。',
    '补充本通话内两人各自确认姓名和个人信息的对话规则。',
    '仅 Candidate；持续电视、人声干扰和真人设备验收仍在验证。',
  ],
};
export const VOICE_UPDATES = [
  {
    version:'voice-redial-cleanup.20261028.1',date:'2026-10-28',
    title:'再次拨号减少一次等待',
    items:[
      '修复部分 iPhone 通话挂断后，旧通话标记没有及时清除的问题。',
      '下一次拨号无需重复确认已结束的通话，减少一次网络等待；实际收益随网络情况变化。',
      '由服务端更新交付，现有 App 即可使用，无需安装新版本。',
    ],
  },
  {
    version:'voice-ios-post-call-catalog.20261028.1',date:'2026-10-28',
    title:'修复 iPhone 挂断后的模型显示',
    items:[
      '修复操作按钮快速拨号后，挂断页面仍显示旧默认名称「小何」的问题。',
      '挂断并回到页面后同步最新模型名称和可选项，与网页保持一致，不增加拨号前等待。',
      '通过共用页面更新交付，无需安装新的 iOS 测试包；空闲时打开 App 可获取更新。',
    ],
  },
  {
    version:'voice-call-response.20261028.1',date:'2026-10-28',
    title:'拨号减少等待，iPhone 通话响应优化',
    items:[
      '网页将身份核验、创建通话和语音接入放在同一条连接，减少拨号前的重复请求。',
      'iPhone 新版优先显示呼叫反馈，减少开始通话前的界面准备等待。',
      'iPhone 挂断立即停止本地通话，服务器连接在后台清理；清理完成后可再次拨号。',
      '修复连续插话超过 15 秒后可能恢复播放旧回复尾音的问题。',
      'iPhone 三项改进需要安装 1.0.0（40）；实际接通速度受网络和模型响应影响。',
    ],
  },
  {
    version:'voice-connect-audio.20261027.1',date:'2026-10-27',
    title:'减少拨号等待，修复网页与 GPT 连接',
    items:[
      '飞书身份确认随首页开始，网页与 App 拨号减少重复核验和串行准备的等待。',
      '修复网页取得麦克风权限后，音频模块启动报错、无法接通的问题。',
      '修复 iPhone 已绑定会话选择 GPT Live One 后因传输信息缺失而拨号失败的问题。',
      '补充音频交付与播放状态诊断，便于排查停顿；不保存原始音频。',
    ],
  },
  {
    version:'voice-entry-cli.20261027.1',date:'2026-10-27',
    title:'进入更快、挂断更及时，支持按需生成电话链接',
    items:[
      '电话页提前开始身份确认，重复进入复用相同版本的页面程序，减少等待。',
      '点击挂断立即停止本地通话并恢复页面；再次拨号仍等待原通话清理完成。',
      '正式电话模型列表保留小何和 GPT Live。',
      '网页可继续在 V App 中使用；未安装时提供 TestFlight 安装入口，安装后返回原页完成绑定。',
      'V 可按需创建独立访客电话或飞书登录邀请，并查询有效期、撤销链接；邀请沿用收件人自己的账号权限。',
    ],
  },
  {
    version:'voice-calendar-consent.20261027.1',date:'2026-10-27',
    title:'日程直接办理，保留指定的日历服务',
    items:[
      '使用小何或 Grok 明确要求创建日程后，直接办理或交后台，不再仅因写入或转后台重复询问授权。',
      '后台交接保留原要求、指定服务、对象、时间和最新修正；缺少必要信息时只确认缺项。',
      '飞书会话的个人日程默认使用已授权飞书账号，不以企业微信替代；账号权限失效仍说明实际原因。',
    ],
  },
  {
    version:'voice-background-feishu.20261027.1',date:'2026-10-27',
    title:'后台任务在飞书里也看得见',
    items:[
      '通话中交给会话执行的后台任务，会在绑定的飞书会话里展示请求、公开进度与最终结果。',
      '任务沿用原会话和飞书原生卡片；通话里也继续接收任务结果。',
      '普通语音对话不逐句同步到飞书。',
    ],
  },
  {
    version:'voice-feishu-login-persistence.20261026.1',date:'2026-10-26',
    title:'外部账号保持登录，可以切换身份',
    items:[
      '通过飞书卡片确认后，重新打开电话保留账号与会话，不再因组织免登失败退回 Public。',
      '首页恢复当前使用方式与连接飞书身份入口；账号设置可切换身份，切到 Public 后也能主动返回原账号。',
      '旧登录需要重新确认一次；之后沿用 30 天有效期，访问会话仍核验当前资格。',
    ],
  },
  {
    version:'voice-legacy-entry.20261026.1',date:'2026-10-26',
    title:'旧群和私聊电话入口修复',
    items:[
      '已登记的旧群、私聊电话链接和历史收藏转到对应会话的新入口。',
      '群里的电脑电话入口在飞书侧边栏打开，私聊电话页签在飞书内打开。',
      '进入时识别当前来电账号；外部联系人沿用原页飞书身份确认，已有 App 绑定和通话记录保留。',
    ],
  },
  {
    version:'voice-feishu-confirm.20261025.1',date:'2026-10-25',
    title:'飞书确认身份，原页接着聊',
    items:[
      '打开电话页面仍是熟悉的拨号按钮；需要确认身份时，V 会提示你回飞书点一下确认。',
      '同一群链接支持内部和外部联系人确认本人身份，确认后仍在原电话页，保留当前群会话。',
      '网页姓名与群会话分开显示；右上角可直接打开 iOS 绑定，确认后的身份和群会话一起带到 App。',
      '访客仍可直接使用 Public；个人工具权限按本人身份核验。',
    ],
  },
  {
    version:'voice-public-testflight.20261025.1',date:'2026-10-25',
    title:'Public 通话与统一入口列表',
    items:[
      'iOS 39 新安装自动准备 Public 访客会话，无需飞书登录或复制链接；启动不会自动拨号。',
      '设置里共用一个入口列表：Public 固定第一，保留已绑定会话与当前选择，可添加、切换或移除本机入口。',
      'Public 可使用网页搜索、记忆搜索和后台任务；通话中收到的完整结果沿用报告卡片。',
      '首次需要系统权限时，操作按钮引导到前台准备；已有绑定和授权继续原通话路径。',
      'iOS 39 通过 TestFlight 验收；实机操作按钮、锁屏和声音体验仍待确认。',
    ],
  },
  {
    version:'voice-location-testflight.20261025.1',date:'2026-10-25',
    title:'按需获取当前位置与 iOS 启动修复',
    items:[
      '已绑定账号的豆包通话支持按需获取当前位置；网页由浏览器授权，iOS 38 由系统授权。',
      '只在你提出位置相关请求时获取一次位置，不持续追踪；首次授权请保持 App 在前台。',
      'iOS 38 移除启动时自动切换图标的操作，避免反复出现系统图标更改提示。',
      'iOS 38 通过 TestFlight 继续验收；锁屏定位、飞书内网页和打车完整流程仍在验证。',
    ],
  },
  {
    version:'voice-ios-bound-identity.20261024.2',date:'2026-10-24',
    title:'修复 iOS 来电身份与日历直查',
    items:[
      '从飞书生成 App 绑定时，同步已验证的账号姓名；切换账号时不再误用旧绑定。',
      '恢复按当前已验证飞书账号直接查询日历，简单查询无需转交后端模型。',
      '修复新通话残留“这份内容已清除”提示，以及旧内容请求晚到时误显示错误。',
      '现有 App 可在空闲前台同步这次界面修复，无需重新安装。',
    ],
  },
  {
    version:'voice-unified-entry.20261024.1',date:'2026-10-24',
    title:'电话入口与 App 绑定统一',
    items:[
      '直接显示电话页面，在页内确认飞书账号，移除独立的账号识别页。',
      '新旧群链接和私聊共用会话映射，保留已有 App 绑定与原通话记录。',
      '访客也可使用 iOS App 入口，继续自己的访客对话；绑定时显示对应会话名称。',
    ],
  },
  {
    version:'voice-entry-speed-status.20261024.1',date:'2026-10-24',
    title:'飞书电话入口提速与 iOS 绑定恢复',
    items:[
      '减少飞书账号识别的重复请求和页面跳转，更快进入可拨号状态。',
      '恢复右上角 iOS 入口，新群也能生成当前 App 可用的绑定链接。',
      '修复新群通话卡片一直停在 00:00、挂断后不更新的问题。',
    ],
  },
  {
    version:'voice-caller-identity.20261024.1',date:'2026-10-24',
    title:'修复群电话来电账号识别',
    items:[
      '新旧群电话入口统一识别当前飞书账号，飞书内打开时自动获取当前账号。',
      'GPT、小何和 Grok 使用本次确认的账号名称，不再从群历史猜测来电者。',
      '账号识别失败时进入临时聊天，避免沿用旧账号；原会话权限保持。',
      '移除右上角的账号名和切换账号，保留原 iOS App 入口；连接飞书账号移至拨号区下方。',
    ],
  },
  {
    version:'voice-feishu-conversations.20261024.1',date:'2026-10-24',
    title:'飞书电话入口与外部联系人通话',
    items:[
      '新群可自动添加输入框下方的「打给 V」菜单，私聊保留顶部电话入口。',
      '连接飞书账号后，电话沿用对应会话及原有权限；未确认身份也可直接开始临时语音聊天。',
      '临时聊天不读取飞书历史或使用个人账号工具，自报姓名只用于本通话称呼。',
      '移除私聊验证码登录；旧版网页登录需重新连接飞书账号，原个人电话和已绑定 App 继续保留。',
    ],
  },
  {version:'voice-call-minutes.20261024.2',date:'2026-10-24',title:'修复私信电话纪要样式',items:[
    '修复真实通话后私信纪要偶尔停留在基础卡片的问题，正确显示淡紫重点版式。',
    '保留按主题整理的摘要、完整对话和 iPhone 安静拨号。',
  ]},
  {version:'voice-call-minutes.20261024.1',date:'2026-10-24',title:'更清爽的电话纪要',items:[
    '挂断后的纪要采用淡紫标题区，按主题分段，完整对话入口更轻巧。',
    '摘要直接提炼值得保留的内容，去掉固定开场和逐项复述；试音只留一句确认。',
    '区分建议与决定，被质疑且未核实的信息不再作为事实复述。',
  ]},
  {
    version:'voice-responsive-interruption.20261024.1',date:'2026-10-24',
    title:'说话更连贯，轻声也能打断',
    items:[
      '改善 iPhone 收音传输，减少播放中被未确认声音触发的短暂停顿。',
      '本地确认人声后，轻声和短句也能及时打断；新回答接着回应你的插话。',
      '保留忽略旁聊后继续播放，并修复挂断时偶发退出。',
    ],
  },
  {
    version: 'voice-shared-terminal-behavior.20261024.1', date: '2026-10-24', title: '各终端共用对话与任务逻辑',
    items: [
      '网页、iPhone、小机器人和音响共用搜索接话、任务进度与结果交付逻辑。',
      '后台任务的阶段进展和结果不再只对电话端启用，普通插话不会取消后台任务。',
      '屏幕展示、麦克风处理、摄像头和舵机继续按设备能力适配。',
    ],
  },

  {
    version: 'voice-ios-quiet-start.20261024.1', date: '2026-10-24', title: 'iPhone 拨号更安静',
    items: [
      '从 iPhone App 或 Action Button 发起通话时，不再发送「V正在电话通话」飞书卡片，避免拨号时弹出通知。',
      '通话状态继续由灵动岛显示，挂断后的通话总结和完整对话照常保留。',
      '网页发起通话仍保留原来的实时计时卡片。',
    ],
  },
  {
    version: 'voice-ios-handoff.20261024.1', date: '2026-10-24', title: '在 iPhone 上接着聊',
    items: [
      'iOS App 弹窗突出即将连接的会话，点击「在 iPhone 上继续」进入 App。',
      '安装说明、复制或重新生成链接、已绑定设备管理收进折叠入口。',
      '仍需在 App 中验证并绑定；完成前保留原来的会话。',
    ],
  },
  {
    date: '2026-10-23', title: '私聊通话计时与挂断状态修复',
    items: [
      '修复私聊通话状态停在 00:00 的问题；计时会随通话更新。',
      '挂断后原状态卡显示已结束及总时长，完整对话和总结继续保留。',
    ],
  },
  {
    date: '2026-10-23', title: '把 V 放到操作按钮上',
    items: [
      'iOS build 29 带来三步引导：获取会话链接、设置操作按钮，最后来到“替代 Siri 的第一步：enjoy”。',
      '右上角设置可保存、切换多个会话；操作按钮跟随当前选择，已有绑定自动保留。',
      '包含 build 28 的单连接拨号加速；切换先验证目标会话，通话中保留当前会话。',
    ],
  },
  {
    date: '2026-10-23', title: 'iPhone 拨号减少等待',
    items: [
      'iOS build 28 在支持的服务上通过一次连接完成豆包和 Grok 拨号，减少查询状态、创建通话与语音连接之间的等待。',
      '工具目录和会话上下文同时准备；接通提示仍等到语音通道真正就绪，实际耗时受网络与模型响应影响。',
      '取消拨号会清理本次连接；已有 App 与 GPT Live 继续使用原有连接方式。',
    ],
  },
  {version:'voice-phone-startup.20261023.2',date:'2026-10-23',title:'减少会话电话拨号等待',items:[
    '群聊和私聊电话改为只查询本次会话，避免每次拨号扫描整个会话库。',
    '仍实时确认会话存在、所属 Agent 与入口一致；不存在或不匹配的会话继续拒绝拨号。',
  ]},
  {
    date: '2026-10-23', title: '操作按钮接通更稳，飞书入口少等一步',
    items: [
      'iOS build 26 调整豆包和 Grok 的启动顺序，在操作按钮触发后及时准备收音，避免联网等待较长时被系统拒绝后台启动麦克风。连接前的声音不会缓存或上传；失败时会释放麦克风。',
      '已登录飞书的电话入口直接显示通话页，减少一次页面跳转；首次使用仍需确认身份。',
    ],
  },
  {
    date: '2026-10-23', title: '修复 App 绑定与通话记录保存',
    items: [
      '修复正式环境无法保存 App 会话绑定、却提示链接失效的问题；重新生成链接并验证绑定后即可切换到目标会话。',
      '修复通话记录的保存目录；若绑定暂时无法保存，会显示服务错误并保留原会话。',
    ],
  },
  {
    date: '2026-10-23', title: '群电话入口与 App 会话切换',
    items: [
      '群电话入口按各群独立配置，通话上下文和纪要返回对应群聊。',
      'iOS 绑定页明确提示在 App 点「验证并绑定」，并核对目标会话名称，避免跳转后仍使用原会话。',
    ],
  },
  {
    date: '2026-10-23', title: '飞书会话电话与通话纪要',
    items: [
      '从私聊顶部电话标签或群内电话入口拨号，继续对应私聊或群聊的上下文；各群使用自己的独立入口。',
      '通话时显示「V正在电话通话」与计时，挂断后在原卡片显示「V电话通话已结束」和总时长。',
      '私聊和群聊统一发送结束纪要，V 以第一人称整理重点；完整对话可随时查看，摘要临时失败会自动重试。',
      '飞书登录可保持 30 天，服务更新后不必重复授权。',
      '网页右上角 iOS App 入口可打开 App 设置并填好绑定链接；已有 build 25 无需重装，重复绑定同一会话可直接继续。',
    ],
  },
  {
    date: '2026-10-23', title: 'iPhone 电话能力统一更新',
    items: [
      'iOS build 24 接入统一电话能力桥，字幕、提示、任务和报告展示由共用服务维护。',
      '网页查询时显示更清楚的“查询网页中”任务提示，已有 build 24 可随服务更新收到。',
      '升级一次后，兼容范围内的接话策略、文案和通话参数可随服务更新，不必反复安装 App。',
      '收音、后台音频、操作按钮和灵动岛仍由原生执行；新增系统能力或底层音频改动继续单独升级。',
    ],
  },
  {
    date: '2026-10-23', title: '查询时自然接话',
    items: [
      '查网页和个人记忆时，V 会根据当前问题简短接话，并在同一轮立即开始查询；结果回来后接着回答。',
      '接话由豆包现场组织，不插播固定提示音；实际查询结果仍以工具返回为准。',
      '网页与 iOS 共用这套电话策略，保留现有插话停声、多人姓名和灵动岛能力。',
    ],
  },
  {
    date: '2026-10-23', title: 'iPhone 灵动岛波形更自然',
    items: [
      'iOS build 23 的中、大卡统一呈现语音波形，跟随真实声音强弱变化，停声后自然收静。',
      '大卡保持简洁，保留表情、静音、挂断和查看完整方案的入口。',
      '包含已验收 build 22 的插话等待修复；网页与 App 内的对话文字照常保留。',
    ],
  },
  {
    date: '2026-10-23', title: '插话后自然接上新回答',
    items: [
      '你插话说完后，等待新回答期间保持停声，不再因计时结束重新播报旧内容。',
      '模型判断是电视或旁聊时仍可继续原回答，保留原生多人和姓名上下文。',
      '网页和 iOS build 22 同步修复，保留字幕、灵动岛与挂断能力。',
    ],
  },
  {
    date: '2026-10-22', title: '新回答及时接上，查询少些打扰',
    items: [
      '豆包确认新回答时先清掉旧播放队列，迟到的旧音频不再混入新回答；网页与 iOS 共用这项修复。',
      '电话查询不再插播固定的“我查一下”和等待提示，界面保留任务状态，实际结果和错误照常反馈。',
      'iOS build 21 保留字幕、灵动岛和多人能力，并拒收已经过期的清空与播放完成通知。',
    ],
  },
  {
    date: '2026-10-22', title: '查询后接话，不再排在旧语音后面',
    items: [
      'iOS build 20 修复小何查询提示音之后，新回答可能排在旧语音后面播放的问题；新回答会替换旧回答剩余的音频。',
      '已确认打断的回答不会因迟到的音频再次播放，保留 build 19 的连贯字幕。',
    ],
  },
  {
    date: '2026-10-22', title: '电话、机器人与音响统一更新',
    items: [
      '网页、iOS 使用的电话服务与机器人、音响使用的服务纳入同一次更新，避免设备服务遗漏新版本。',
      '更新等待通话、连接准备和后台任务结束；切换期间新拨号稍后重试，不中断正在进行的对话。',
      'iOS 网页界面在空闲时同步；原生 App 和设备固件能力仍按各自版本升级。',
    ],
  },
  {
    date: '2026-10-22', title: '通话文字连贯显示',
    items: [
      '修复 GPT Live One 在 iPhone 中把一句话拆成多个短条目的问题，增量文字持续更新在同一条消息里。',
      '小何与 Grok 的 iPhone 字幕会保留前文，完整回答到达后统一校正；网页与 App 的消息顺序在回答完成时保持稳定。',
      '共享网页显示随本次发布更新；原生字幕修复随 iOS build 19 交付。',
    ],
  },
  {
    date: '2026-10-22', title: 'iPhone 灵动岛通话升级',
    items: [
      'iOS build 18 整合小何原生全双工适配与 GPT Live One，保留操作按钮、后台通话、声音波纹和方案入口。',
      '锁屏首次呼叫显示默认 Reaction，后台表情随真实对话变化，回到 App 后由 H5 接管；完整方案仍可点击进入 App 阅读。',
      '修复操作按钮启动提示的旧图标；紫色新图标、锁屏默认头像与对话 Reaction 已通过本人手机验收。',
    ],
  },
  {
    date: '2026-10-22', title: '通话看声音，方案点开看',
    items: [
      'iOS App build 17 的灵动岛大卡与中卡共用声音波纹，通话时保留 Reaction 和通话控制，不再滚动显示对话文字。',
      '完整方案到达后显示点击查看入口，说话期间也可直接打开报告；原有后台提醒和静音、结束操作保留。',
    ],
  },
  {
    date: '2026-10-22', title: '边听边说，插话时更快让位',
    items: [
      '豆包通话使用原生全双工，讲话期间持续听取输入；确认新回答时丢弃旧语音，短暂起声可暂停后继续。',
      '补充两人分别确认姓名与个人信息的对话规则；电视和旁聊仍可能影响判断，持续背景人声继续优化。',
      '修复已接受挂断但没有后续告别语音时，电话一直不结束的问题。',
      '网页刷新后生效；iOS 原生音频适配需更新 App，已有版本保持原有通话路径。',
    ],
  },
  {
    date: '2026-10-22', title: '报告到达，灵动岛给你提示',
    items: [
      'iOS App build 15 改善后台报告到达时的文字卡展示，保留 Reaction、查看全文、静音与结束通话入口。',
      '同一份报告有新内容时重新提醒；相同内容重复同步不会反复打扰，手动收起和通话控制仍立即生效。',
      '这项原生修复需升级 App；灵动岛的实际展开与停留时长仍由 iOS 管理。',
    ],
  },
  {
    date: '2026-10-22', title: 'App 界面跟随网页更新',
    items: [
      '升级新版 App 后，共享的界面、文字、Reaction 与全文阅读可随网页发布更新，日常界面修正不用每次重新安装 App。',
      '通话和全文阅读期间保留当前界面；更新不可用时继续使用已验证的缓存或包内版本。',
      '操作按钮、后台录音与灵动岛继续由原生通话负责；系统能力升级仍通过新版 App 交付。',
    ],
  },
  {
    date: '2026-10-22', title: 'V 来到 iPhone，迈出替代 Siri 的第一步',
    items: [
      'V Voice iOS App 已在本人 iPhone 验证接通和双向对话；配置操作按钮后，可从桌面长按开始与 V 通话。',
      'App 内直接使用熟悉的 H5 界面，保留人类发言、多人 Speaker、Reaction 和完整方案阅读。',
      '新增灵动岛的呼叫提示、音频与文字卡片、真实声音能量波形，以及静音、结束和方案全文入口；接通提醒与新波形的真机体验继续收集反馈。',
      'App 图标换为 V 的紫色背景耳麦形象。',
    ],
  },
  {
    date: '2026-10-21', title: '手机接通更稳，长句接话更快',
    items: [
      '修复手机接通时欢迎语被短暂起声或背景声音过早取消；确认你在提问时，欢迎语仍会让位。',
      '减少长句说完后从句首重新处理造成的等待，保留完整问题再接话。',
      '普通聊天中的评论、感受和任务补充能自然接续；不确定的新声音不再轻易取消正在进行的查询与回答。',
      '改善 iPhone Safari 接通、音频被系统暂停后的恢复和挂断重拨；语音识别准备完成后再进入通话。',
    ],
  },
  {
    date: '2026-10-20', title: '手机通话换新界面，后台进展听得见',
    items: [
      '手机通话改版：V 的头像和表情是主角，状态合成一行，当前这轮对话紧跟在下面，之前的对话淡化；底部按钮浮在对话上方。',
      '电脑网页保持左边头像、右边聊天框，状态行、气泡和任务面板与手机一致。',
      '后台任务进行中，V 会按真实进展说一句（比如“我先拉一下赛程数据”），不会打断别人正在问的问题。',
      '后台任务完成后，结果会说给交代任务的人；如果当时 V 在陪别人聊，结果先放到屏幕上，等他回来再说，不会丢。',
      '后台状态偶尔读取变慢时会自动重试，不再把还在进行的任务当成失败取消掉。',
    ],
  },
  {
    date: '2026-10-20', title: '接通有问候，断线后能重拨',
    items: [
      '手机外放时，V 查资料前的提示、进度播报和告别语漏进麦克风，不再被当成另一个人；说一次拜拜就能挂断。',
      '首次打开时，入口与连接提示会在首页清楚引导，不挤占通话状态栏。',
      '人物、搜索与后台进度合并为简洁的一行状态，异常时优先显示提示。',
      '更正姓名为 Tianyi（天懿），用于称呼、欢迎语和个人工具说明。',
      '恢复豆包自动多人通话的接通欢迎语；你先开口时，问候会让位给你的发言。',
      '修复连接已结束后仍提示“另一台设备正在和 V 通话”的残留占用。',
    ],
  },
  {
    date: '2026-10-20', title: '长时间通话更稳，开着电视也能聊',
    items: [
      '查资料久了，V 会说一声“还在查”；没查成或查到了还没开口，V 会主动说明，不再冷场或直接挂断。',
      '你正在说话、刚插话、或 V 还在等结果时，电话不会被当成没人说话而挂断。',
      'Gateway 重启期间，电话服务会等它恢复，不再反复崩溃重启。',
      '小机器人也能区分家里不同的人，电视里的话不会被当成在跟 V 说话。',
      '多人通话里，V 正在回答、查资料或刚说完时，不再插一句“刚才那句我没听清”；只有你一个人时，也不会因为认不准声音让你重说。',
      '手机外放时，V 刚说的话从喇叭漏进麦克风，不再被当成你说的，接通开头尤其明显。',
    ],
  },
  {
    date: '2026-10-19', title: '豆包可以和大家一起聊了',
    items: [
      '不用预先登记声纹，通话中自动区分说话人，在气泡上显示人物，并通过对话关联名字。',
      '根据当前说话人和对话对象调整表达；旁聊可以只听不答，后台任务进行时也能换人继续聊。',
      '识人和原生语音并行处理，保留实时小帧上传；自然说拜拜后，V 告别播放完成再挂断。',
    ],
  },
  {
    date: '2026-10-16', title: '电话挂断，任务继续',
    items: [
      '后台任务与通话分开管理：已接纳的任务会继续执行；你要求发到飞书时，进展和结果会发到当前电话绑定的会话。',
      'GPT Live 与豆包共用任务修改、补充和追加机制；子任务完成后，后台会继续汇总。',
      '修复 GPT Live 说“再见，下次再聊”后仍停在结束中的问题。',
    ],
  },
  {
    date: '2026-10-13', title: '报告收起后，回到熟悉的位置',
    items: [
      '修复 iPhone Safari 打开、滚动、收起报告后，头像和底部通话条偏移的问题。',
      '完善报告在屏幕上的交付确认，减少说了“已放到屏幕上”却没有展示内容的情况。',
    ],
  },
  {
    date: '2026-10-13', title: '说话、插话、挂断，更顺畅',
    items: [
      '改善 GPT Live 在后台任务完成后的插话体验；你开始说话时，V 会停下旧的回复。',
      '完善忙碌时的语音挂断。快速工具做不了的请求，会继续交给后台处理。',
    ],
  },
  {
    date: '2026-10-11', title: '飞书工具接力，长通话更稳',
    items: [
      '修复语音查询本人飞书日程的工具入口；其他任务可以继续交给后台，写操作遵循你的授权。',
      '改善豆包长时间通话遇到临时断连时的恢复，恢复失败时给出明确提示。',
    ],
  },
  {
    date: '2026-10-10', title: '边聊边看，内容展开就清楚',
    items: [
      '重新整理 Web 和手机布局，突出 V 的头像与对话；手机文字输入可从通话条展开。',
      '完整报告、图片和视频以内容卡片呈现，点开阅读或观看，收起后回到对话。支持通过语音把创作任务交给 Makaron。',
      '默认使用豆包 SeedDuplex；挂断后回到初始拨号页。支持的浏览器会在通话时保持屏幕常亮。',
    ],
  },
  {
    date: '2026-10-09', title: 'V 有了更灵动的反应',
    items: [
      '头像会结合你说的话和 V 的回复做出反应，在倾听、陪伴、思考和回应之间切换。',
      '优化方形头像和轻量图片，让 Web 与手机上的表情更清楚、加载更轻。',
    ],
  },
  {
    date: '2026-10-07', title: '同一个 V，多种声音',
    items: [
      'GPT Live、豆包 SeedDuplex 和 Grok Voice 共用通话界面，可在模型菜单中选择。',
      '后台任务执行时可以继续聊天；长结果先说摘要，再把完整内容留在屏幕上。',
    ],
  },
  {
    date: '2026-10-06', title: '语音也能调用工具、接住任务',
    items: [
      '加入豆包 SeedDuplex 和 Grok Voice，支持快速工具查询与后台任务接力。',
      '任务进行时，头像用不同的动作显示查记忆、查资料和后台处理等状态。',
    ],
  },
  {
    date: '2026-10-04', title: 'GPT Live 加入电话入口',
    items: [
      '接入 GPT Live，拨号后可以自然开聊、收到 V 的招呼，也能把复杂任务交给后台。',
      '区分拨号与通话界面，让手机上的头像、对话和结束通话更清楚。',
    ],
  },
  {
    date: '2026-09-22', title: '第一版：在浏览器里和 V 通话',
    items: [
      '上线独立的“小何”网页语音入口，点击拨号即可与 V 对话。',
      '加入 V 的人物头像、通话文字与任务状态，让语音交流有了可见的陪伴。',
    ],
  },
];

export function mountChangelog(document, view = globalThis) {
  const trigger = document.getElementById('changelogOpen');
  const dialog = document.getElementById('changelogDialog');
  const closeButton = document.getElementById('changelogClose');
  const list = document.getElementById('changelogEntries');
  if (!trigger || !dialog || !closeButton || !list || !dialog.showModal) return;

  // An isolated candidate may show its own notes without changing shipped notes.
  let candidate;try{candidate=JSON.parse(document.getElementById('voiceCandidateRelease')?.textContent??'null');}catch{}
  const entries=candidate&&typeof candidate.date==='string'&&typeof candidate.title==='string'&&Array.isArray(candidate.items)?[candidate,...VOICE_UPDATES]:VOICE_UPDATES;
  if(entries!==VOICE_UPDATES)list.setAttribute?.('aria-label','候选与已发布更新');
  for (const entry of entries) {
    const section = document.createElement('section');
    section.className = 'changelog-entry';
    const date = document.createElement('time');
    date.dateTime = entry.date;
    date.textContent = entry.date.replaceAll('-', '.');
    const title = document.createElement('h3');
    title.textContent = entry.title;
    const items = document.createElement('ul');
    for (const text of entry.items) {
      const item = document.createElement('li');
      item.textContent = text;
      items.append(item);
    }
    section.append(date, title, items);
    list.append(section);
  }

  let closing = false;
  const close = async () => {
    if (!dialog.open || closing) return;
    closing = true;
    if (dialog.animate && !view.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      try {
        await dialog.animate([
          { opacity: 1, transform: 'translateY(0) scale(1)' },
          { opacity: 0, transform: 'translateY(10px) scale(.985)' },
        ], { duration: 150, easing: 'ease-in', fill: 'forwards' }).finished;
      } catch { /* Closing still restores focus if the animation is interrupted. */ }
    }
    dialog.close();
    for (const animation of dialog.getAnimations?.() ?? []) animation.cancel();
    closing = false;
    trigger.setAttribute('aria-expanded', 'false');
    trigger.focus({ preventScroll: true });
  };
  trigger.addEventListener('click', () => {
    if (dialog.open || closing) return;
    dialog.showModal();
    list.scrollTop = 0;
    trigger.setAttribute('aria-expanded', 'true');
  });
  closeButton.addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); void close(); });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) void close();
  });
  return { close };
}
export const LEGACY_ENTRY_CANDIDATE_UPDATE = {
  version:'voice-legacy-entry.20261025.1',date:'2026-10-25',
  title:'旧群与私聊电话入口兼容（Candidate）',status:'candidate-validation',
  items:[
    '已登记的旧群和私聊电话链接转到同一会话的新入口，历史收藏也能继续打开。',
    '进入后识别当前来电者，沿用原页飞书身份确认；不会继承旧链接中的个人身份。',
    '候选验证中，尚未合入或发布；群菜单和私聊页签修复由独立平台变更维护。',
  ],
};

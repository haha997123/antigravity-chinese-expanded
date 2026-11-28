# 跨版本漏译与问题台账

最后整理：2026-11-28。本表记录已修复问题及验证范围。服务端新增文案可能需要后续补译。

| 问题与触发入口 | 原因与处理 | 回归与更新时注意 |
| --- | --- | --- |
| 官方更新后大面积恢复英文 | 2.32.1 自动更新到 2.32.2 替换了 app.asar；适配后从同版本干净备份重新应用 | 检查实际版本及补丁标记；保留同版本备份；不能把重启当重装补丁 |
| 新会话首条和最后一条消息的 `just now`、`2h ago` | 过宽的聊天区排除和过严的样式匹配漏掉真实操作栏；改用明确时间控件结构并观察动态更新 | localization：首次/后续/重渲染；不要翻正文中相同字符串 |
| 左侧会话时间仍英文 | 时间控件与消息操作栏结构不同 | localization：侧栏、历史列表、工具栏时间及变化值；未来结构变化需重查 |
| 会话标题、系统通知中的英文摘要 | 模型自动生成的内容不是固定 UI；普通词典不能保证改为中文 | 可选标题服务只处理启用后新主会话，首次基线保留历史；服务/额度失败可保留英文 |
| 右下角完成通知修过仍有英文 | 旧实现仅翻 `Agent finished:` 前缀，摘要保持英文且通知可能早于中文标题完成 | v1.0.7 标准完成通知改为固定“智能体已完成任务，点击查看结果。”；notifications 验证本机/远程归属、点击及参数保持 |
| 提问、终端和打开 URL 的系统通知 | 原生 Electron 通知不经过页面 DOM；需要在 notification:send 处理器翻固定标题 | notifications：仅已确认来源和类型，问题、命令、URL 保持原文；未知通知不猜译 |
| 固定窗口标题变化后恢复英文 | 文档 title 替换或延迟创建与初始设置不同 | window-title：创建/替换/动态变更；用户会话及终端标题不套普通词典 |
| Plan、Notice、Unavailable、Low/Medium 和感叹号浮层 | 多个订阅和模型分支，浮层延迟挂载；模型名称与等级需区分 | localization：提示、不可用、档位及 aria 标签；保留实际模型名 |
| 新模型公告和下架日期漏译 | 服务端动态模型版本及日期，静态截图词条无法覆盖未来值 | 完整句式捕获模型与日期，测试不同年月和版本；未知句式须另补 |
| Plus、Pro、Ultra 的用量说明不同 | 不同方案含每周额度、数值小时限额及独立模型分组 | localization：每周和 5-hour 等数值小时恢复倒计时，动态单位和名称；未实际开通分支注明模拟验证 |
| AI 积分、升级与资格错误漏译 | 高等级、耗尽和不符合资格时才出现 | 已有固定词条与动态规则；检查日期刷新、积分数量、升级方案和按钮 |
| `No automations yet` 变为中英混合 | 多个 DOM 文本节点被分别翻译 | 已确认空状态结构内组合翻译；不能用全局替换 No / yet |
| 更多插件的七项、技能介绍和展开详情 | 名称保护与介绍范围混在一起，折叠内容未在初始树出现 | 保留名称、翻介绍和示例请求；展开、搜索、详情弹层都检查，插件更新可能再添文案 |
| 高级权限、快捷键和通知偏好漏译 | 展开项、title、aria-label、placeholder 与正文不同 | localization：固定提示和属性；不修改权限值或输入值 |
| Swarm 项目说明夹杂英文 | 名称及全局权限链接与连接词拆分在多个节点中 | 组合结构翻译，保留 strong 名称、链接与点击行为；project-delete 等测试包含同名陷阱 |
| 永久删除项目 `including` 仍英文 | 项目名、进行中/已归档数量与连接词分节点 | project-delete：原结构、数量、混合状态与名称保持；不能全局替换 including |
| `6 files changed`、工具状态和加载提示 | 固定系统控件在聊天排除区中 | 窄范围结构匹配；不翻工具输出、命令或“思考链”正文。任意模型生成的任务说明不保证全中文 |
| 权限框 `Allow search...`、列表文件和替代操作提示 | 系统 Ask Question 组件与模型自由提问复用 | 仅明确权限卡片和固定句式；保留目标资源、命令、作用域、表单选择及正文 |
| Chrome DevTools、Context7 等技能介绍 | 第三方或新增说明未入词典 | 翻说明、名称保持；真实技能定义与执行提示不改 |
| MCP 配置缺失、认证、多个服务器启动失败 | 只有错误分支和账号未登录时出现 | v1.0.7 补固定说明和动态数量/账号/插件名句式；诊断后缀保留，localization 有边界测试 |
| 自动化凭据到期和应用搜索无结果 | 动态时长及搜索词未覆盖 | v1.0.7 补数字 d/h/m/s 时长和空结果；保留搜索词，未知时长格式不猜译 |
| 项目排序、同项目分组、无分享路径、未命名主题 | 低频菜单或异常入口未触发 | v1.0.7 补固定文案；未知服务器等仅固定回退标签，保留真实名称 |
| Best of N 固定评选问卷 | 产品固定问卷位于 agent 区，通用聊天排除使其漏译 | v1.0.7 在 battle-winner-survey 内只处理九个固定标签/属性；输入答案、代码和一般提问不变 |
| 智能体设置更新失败提示 | 动态错误被整体作为未知字符串跳过 | v1.0.7 只翻固定前缀，保留诊断内容；不把原始错误当正文翻译 |
| Agent execution terminated / 地区不支持 / 终端沙盒不可用 | 翻译不能修复账号、网络地区、服务状态或主机能力 | 先诊断实际错误与环境，不用更改权限、模型协议或强翻标识来“修复” |
| 会话、项目、分组、消息、链接、标签页与内置浏览器右键菜单仍显示英文（如 `Rename`、`Pin`、`Mark Unread`、`Copy`、`Split`、`Archive`、`Delete` 及子菜单） | v1.0.8：客户端 2.32.2 / 2.32.1 桌面端通过前端 `window.electronNative.showContextMenu` 经 IPC `window:show-context-menu` 调用主进程 `dist/ipcHandlers.js` 的 `Menu.buildFromTemplate` 弹出原生菜单，不经过页面 DOM `MutationObserver`，且 `dist/main.js` 的 `ANTIGRAVITY_MENU_I18N_PATCH` 原先仅含 10 项窗口菜单词条；同时 `Move to Group`、`Copy`、`Fork`、`Split`、`Sort By`、项目及链接子菜单存在遗漏词条。在 `dictionary.json` 新增 18 项固定词条（总计 4,415 条），在 `patch.js` 中对 `dist/preload.js` 的 `showContextMenu` 注入 `_agTranslateContextMenuItems`、扩展 `dist/main.js` 的 `ANTIGRAVITY_MENU_I18N_PATCH` 全量词典与递归子菜单拦截、处理 `message-timestamp` 相对时间与内置浏览器 `id: 'forward'` -> `'前进'`，并保护 `Move to Group` 用户自定义分组名、`conversation-group-header` 分组标题与 WSL 发行版名 | localization：已通过原生 `showContextMenu`、DOM `context-menu-popup`、自定义分组保留、消息/代码/输入框防误翻及 `transformFiles` 对 `preload.js`/`main.js` 注入与 `Menu.buildFromTemplate` 的全部回归测试，以及真实 2.32.2 原版 `app.asar.bak` 隔离构建/还原验证；实机视觉界面尚待退出 Antigravity 并重装 v1.0.8 后复核 |
| Antigravity 2.33.0 更新后恢复英文，文件变更卡片上的 `Review` 仍为英文 | 这次本地适配从 2.33.0 原版 ASAR 建立同版本备份。变更卡片位于会话正文区域，通用翻译跳过；仅在 `changed-files-card-header` 内定位 `changed-files-card-review` 按钮，将其标签译为「查看变更」 | 核对真实 2.33.0 前端的按钮结构。localization 覆盖初始与重渲染，保留图标、文件名、用户和模型正文、代码及输入值。发布保留策略适用于现有 GitHub 安装包 |
| 右下角 Gemini 4 Neon 公告正文仍是英文，模型列表信息图标显示英文提示 | 2.33.0 正文通过 `nux-card` 的 Markdown 渲染，模型提示来自模型配置的 `tagDescription`。补上 Neon 公告及 Neon、Argon、Hydrogen 当前固定说明，现有 Orchestrator 句式识别 Neon | localization 覆盖公告 Markdown、模型说明和正文保护；服务端修改文案时需要核对新原文 |
| 会话中的 `Worked for …` 仍是英文 | 系统折叠控件位于聊天保护区，仅在 `worked-for-collapsible` 和 `progress-updates-collapsible` 按钮内翻译固定时长及更新数量 | localization 验证秒、分、小时、天、动态更新、无障碍标签和正文保护 |
| Windows 2.34.0 更新后界面恢复英文 | 更新器用原版替换 `app.asar`。本机词典恢复了项目及 SSH 搜索、免费版与 Plus 配额说明、终端全选、旁支提问和快捷键提示的八条译文 | 2.34.0 七个修改模块均通过校验，377 个外置资源逐文件一致。隔离重复安装生成相同字节，还原等于官方原版 |
| Windows 2.34.0 同版本出现更多英文控件 | 本机程序和 ASAR 仍为 2.34.0。根据实际嵌入的前端补入编排器、浏览器设置、沙盒权限、快捷键、侧栏和插件提示等 86 条固定文案 | 4,513 条词条；回归保护正文、代码和输入。真实原版隔离应用、七个模块语法解析、377 个外置资源和精确还原验证通过。补丁已在本机重新应用 |
| 2.34.0 模型下拉菜单中 Thinking effort 和 Extra High 为英文 | 前端的 model-selector-effort-header 和 model-selector-effort-option 显示固定标题或模型配置提供的档位。新增「推理强度」「极高」两条词条 | 界面回归覆盖标题、档位、提示及无障碍标签，保留实际档位值和会话正文 |
| 快捷键菜单在「重新打开关闭的标签页」旁显示 restore_page | 原始菜单定义中的 restore_page 是图标标识，Reopen Closed Tab 才是菜单文字 | 使用菜单范围内的恢复符号替代可见的图标标识，保留命令行为、原有键位和菜单文字 |
| 模型选择器的新增标签悬浮提示 Offloads routine steps to a faster executor. Same quality, fewer tokens used. 为英文 | 固定说明来自模型配置的 tagDescription，已补完整词条 | 验证本机提示可译，聊天正文和外部页面保留原文 |
| 2.34.0 模型菜单显示 Leaving Soon，说明末尾为 Leaving on Nov 30. | 服务端模型徽标标题、说明包含下线日期。补入「即将下线」和带实际月份、日期及可选年份的完整说明句式 | 测试缩写月份、含年份日期、无效日期、模型名及用户正文保护 |
| 2.34.0 命令菜单出现「打开 Project Picker」 | openWorkspaceSelector 的显示标签是 Open Project Picker，原有通用 Open 句式只译前半段。补入「打开项目选择器」完整词条 | 测试命令 ID、外部页面和聊天正文保持原样 |
| 2.34.0 模型菜单中 Use Hydrogen for better quality with lower quota usage. Leaving on Nov 30. 及 For your hardest, long-horizon tasks 仍为英文 | 模型悬浮说明使用单独的服务端文案。补入两条译文，已收录的说明可复用下线日期句式 | 测试两个不同日期、模型名称、未收录说明、外部页面和用户正文。真实 Windows 2.34.0 原版隔离安装及还原通过，七个修改模块可解析、377 个外置资源哈希一致，核对后已应用到本机 |
| Windows 2.35.1 更新后恢复英文 | 客户端更新替换了 `app.asar`。v1.2.2 从实际 2.35.1 原版建立同版本备份。新版 Electron 归档中的 `main.js`、`preload.js` 和 `ipcHandlers.js` 有改动，重新核对右键菜单和系统通知的注入位置。语言服务内嵌前端的 `main.js` 也有变化 | 原版 `app.asar` SHA-256 为 `9f0aad7274795d7fbde04931d96b348dcfc5f3d81d7373e6b70aeb09307442df`。两次隔离安装结果一致，七个修改模块通过语法检查，377 个外置资源及原生程序的哈希保持一致，还原后逐字节等于原版 |
| 2.35.1 设置、模型和收件箱新增英文文案 | 从内嵌前端定位 `Markdown artifact width`、`Dictation languages`、`Browsing data`、`Plugin permissions`、`Default (Gemini Pro)`、`Inbox Mode` 等界面标签和提示。实机外观页还出现了大小写不同的 `Font size`。合并 2.34.0 待发布的下线提示及项目选择器译文 | v1.2.2 共 4,590 条固定词条。回归覆盖模型选择的可见标签和无障碍标签、收件箱模式和前次补译。按功能开关或权限出现的分支以打包资源和模拟验证为准 |
| 页面内查找的结果计数 `2 of 8` 为英文 | `find-bar-match-count` 通过单独的文本节点显示当前匹配项、数量及超出上限的 `+`。在该控件内翻为「第 2 项，共 8 项」 | `localization` 验证首次显示、上限数字、动态刷新及重复观察。保留正文、代码、输入值和外部页面中的同样文本 |
| 2.35.1 的「设置 → 外观」中，`Default Light`、`Default Dark` 等内置预设和 `Strong` 为英文，`Background`、`Foreground` 及 `… color picker` 使用了通用译法 | v1.2.3 使用内置前端中的 `theme-preset-label-` 识别已选预设，通过对应列表的 `div.truncate` 翻译展开选项。按浅色、深色各自的内置列表翻译显示名，颜色行和取色器按外观分组翻译。`Strong` 译为「增强」，`System UI` 译为「系统界面字体」 | 本机确认浅色 7 项、深色 12 项预设、已选预设、六个取色器和色值栏标签，打开色板显示正常。模拟回归覆盖选项值、插件名称、十六进制色值、代码预览、正文及重渲染。真实 2.35.1 原版双安装一致，还原逐字节一致，七个修改模块和 377 个外置资源通过校验 |
| Windows 2.35.2 更新后汉化被覆盖，模型选择器在当前轮运行时出现 `Applies to /btw and messages sent after this turn` 或 `Applies to messages sent after this turn` | 2.35.2 的 Electron 原版归档与 2.35.1 相比仅 `package.json` 内容变化，1,167 项文件清单一致。语言服务的内嵌 `main.js` 有变化，词法比较确认上述两条新增界面文案。v1.2.6 增加提示及无障碍标签译文、适配 2.35.2 | localization 检查两条提示，保留模型名、`/btw` 及相同正文、代码、输入值和外部页面内容。适配以本机真实 2.35.2 原版验证，原版 ASAR SHA-256 为 `e057115571cf5085406d20f2427a5afac272b712ec84332c7157da0113d4b2d0` |

| Windows 2.36.0 官方更新覆盖 2.35.2 补丁后界面恢复英文 | 本机实际版本为 2.36.0，官方原版 `app.asar` SHA-256 为 `d2bc25eab00f2ff6f14395e45f13347eef605af5a63f28db7edbfd2ab42a7571`。与 2.35.2 的 1,167 个归档文件比较，仅 `package.json` 变化，七个汉化注入模块逐字节相同，377 个 `app.asar.unpacked` 文件哈希也一致。v1.2.7 将 2.36.0 加入精确版本适配列表，未修改语言服务原生文件或词典。 | 真实 2.36.0 原版 ASAR 隔离安装两次结果一致，七个修改模块语法检查通过，还原后 ASAR 精确匹配原版，外置资源和原生程序哈希未变化。2026-11-28 用户正常退出后，由离线 ZIP 的 `install.cmd` 应用到本机；备份元数据和 SHA-256 对应 2.36.0 官方原版，当前补丁 ASAR SHA-256 为 `b904fe059462c55320f061f7b0a2ea8af0e93526e73066e85842c339c38d8aba`。重启实机确认主页、版本与菜单项、设置外观页为中文；浅色 7 项和深色 12 项预设、已选名称、六个取色器标签及色值均正常，打开色板正常且未改变设置。v1.2.7 按用户授权发布到 [GitHub 2.36.0 发行页](https://github.com/haha997123/antigravity-chinese-expanded/releases/tag/v1.2.7-ag2.36.0)；公开附件重新下载后与本机包及校验文件的 SHA-256 均为 `cc0679a51369c5d85c26f5a122c39d5bb4a0e50e20bc6ba0e6bf7059d32eb986`；包内 `sourceCommit` 为 `670b205f3a93ff0333268cc3c5422656a9df8119`，与 `v1.2.7-ag2.36.0` 标签提交一致。

## 验证边界与剩余限制

- v1.2.5 为 Windows 2.34.0、2.33.0、2.32.2、2.32.1 单独打包离线 ZIP。每个 ZIP 从对应 Google 原版安装器提取的资源上验证 `install.cmd`、重复安装、`restore.cmd`、同版本备份及原生文件完整性。包内清单指定客户端版本，选错离线包时在写入前停止。实机架构验证范围为 Windows x64。
- v1.2.4 将 `install.cmd`、`restore.cmd` 和中文标题开关改为使用包内 Node.js 与锁定依赖，消除了必须预装 Node.js 或现场下载依赖的问题。发行验证覆盖 Windows x64 上从完整 ZIP 解包、移除系统 Node.js/npm 的 PATH 后实际安装、重复安装及逐字节还原，并核对原生程序和 377 个外置资源。ARM64 核对官方二进制、架构和批处理选择分支，实机运行仍待 ARM64 设备验证。
- Windows 2.35.1 本机启动后，实测主窗口、菜单和应用设置中的「防止休眠」。页面内查找的上限计数及插件权限提示来自打包资源和模拟验证。
- v1.0.9 在 Windows 2.33.0 实际会话中核对「查看变更」和「工作时长」，并实测右下角 Gemini 4 Neon 公告正文和 Neon、Argon、Hydrogen、Orchestrator (Neon) 的模型悬浮提示。进度更新数量与无障碍标签由回归用例检查。
- 2.33.0 原版 ASAR 的隔离安装和还原均通过。还原字节与原版一致，377 个外置资源的哈希保持一致。
- 2.32.2 本机主页、设置和模型配额页的中文已观察；MCP 错误、凭据到期及评选等无法自然触发的分支依据当前打包资源及模拟 DOM 检查。
- v1.0.8 右键菜单汉化与 `.cmd` Node 自动探测已完成全套 `npm test` 回归（含 `localization.cjs` 新增用例）及真实 2.32.2 原版 `app.asar.bak`（SHA-256 `056ba838faf9b75c1382a6a0ae003c4b051a3c3e50060a9e5b34987313492d77`）与 `app.asar.unpacked` 的隔离构建（SHA-256 `ce42372c1f1e98607d25b438606cf200c64202d9975b6ec7cea0033be7d2c532`）、模块语法与精确还原校验；因在 Antigravity 客户端内工作时运行中的客户端进程锁定 `app.asar`（`--no-kill` 下 `rename` 返回 `EPERM`）且不可在宿主内强杀进程，需在退出 Antigravity 后运行 `install.cmd` 完成本机覆盖并重启核对实际显示。
- 固定完成通知通过真实处理器的转换夹具验证；重新安装前已经生成的系统通知不会追溯改变。不要为演示通知擅自创建或执行用户任务。
- 普通翻译不联网追译所有未知文本。服务端新公告、新插件介绍、新模型和新句式仍可能需要补丁更新；不得承诺今后没有遗漏。
- 自动中文标题通过内部接口实现，版本升级可能失效。关闭开关不回滚已经保存的中文标题；历史英文标题不会自动批量重命名。
- 新项目随机临时目录名、技术标识和文件名保留原文；中文项目说明及规则偏好可使用 examples 中的通用示例，不上传用户实际全局规则。

## 后续记录格式

每次新增问题记录：客户端版本和补丁版本、触发步骤、英文原文、源码/控件定位、根因、修改文件、测试及实际显示验证、仍未覆盖的条件。版本变化须重新核对这些条件，不能把旧报告改个版本号当新验证。

# Antigravity 中文界面补丁 · 扩展版

这是 Windows 版 Google Antigravity 的非官方汉化工具。下载一份通用安装包，之后从桌面「Antigravity 中文」启动，启动器会在兼容的客户端上应用现有词典。

## 下载与安装

1. 安装 Windows 版 Antigravity 和 Node.js 18 或更高版本。
2. 从 [GitHub Releases](https://github.com/haha997123/antigravity-chinese-expanded/releases/latest) 下载 `antigravity-chinese-expanded-1.1.0.zip`（或后续通用版本），解压后双击 `install.cmd`。
3. 保存工作并正常退出 Antigravity，再通过桌面「Antigravity 中文」启动。补丁保存在 `%LOCALAPPDATA%\AntigravityChinesePatch`，解压目录可以清理。

## 联网更新和兼容范围

- 已验证的 Windows 2.32.2、2.33.0、2.34.0 原版归档可使用完整汉化。后续 2.x 稳定版通过结构检查时可应用界面汉化；未通过时打开原版并提示。
- 启动时定期检查本仓库稳定 Release 的词典附件，校验 SHA-256 后使用新数据。离线时使用上次验证过的词典或安装包内置词典。下载内容是词典和已验证的兼容记录。启动器代码有变动时，通过新的通用安装包升级。
- 界面文案按完整词条或已有的明确句式翻译。未收录的文案保留原文。项目名称、代码、输入和聊天正文保留原文。
- 如需个人译法，可在补丁目录创建 `local-dictionary.json`，内容为原文到译文的 JSON 对象。个人译法优先于在线词典。
- Google 更新器可能直接重启官方客户端。若更新后先显示英文，正常退出再从「Antigravity 中文」打开。
- 如果要还原英文，正常退出客户端，在已安装的补丁目录双击 `restore.cmd`，再用原有的官方入口启动。

仍在使用 Windows Antigravity 2.32.1 时，请下载已验证的专版。通用启动器尚未收录该版本的原版文件指纹。[2.32.1 安装包 v1.0.6](https://github.com/haha997123/antigravity-chinese-expanded/releases/tag/v1.0.6)

## 手动应用补丁

客户端安装在非默认位置时，可关闭客户端，在解压后的目录中运行以下命令，再自行启动客户端。使用前请确认同版本原版归档已经验证。

```powershell
npm ci --ignore-scripts
$env:ANTIGRAVITY_INSTALL_DIR = (Resolve-Path .\Antigravity).Path
node .\patch.js --no-kill
```

脚本会核对原版归档并保留同版本备份。只有桌面中文启动器会自动获取在线词典。

## 自动中文会话标题（可选）

此功能默认关闭。它通过当前 Antigravity 账号的模型服务翻译新会话自动生成的短标题，会额外使用模型请求或额度；每个待处理新标题最多请求两次。只发送标题文本，不发送聊天正文，不需要额外插件、独立后台进程或另外配置 API 密钥。

首次启用时已存在的会话会加入保留名单，不会回溯重命名。之后的新主会话在自动标题稳定后处理，通常需要十几秒至数十秒。完成自动处理后不再反复改写同一会话名称。子会话、已有中文标题及部分特殊会话会跳过。服务失败时可能保留英文；本功能不是对后台原生命名器的语言保证。

启用：保存工作并退出 Antigravity，在补丁目录双击 `enable-chinese-titles.cmd`，再运行 `install.cmd`（已经安装本版的用户重新启动 Antigravity 即可）。也可以使用：

```powershell
node .\configure-chinese-titles.cjs --enable
```

关闭：保存工作并退出 Antigravity，双击 `disable-chinese-titles.cmd`，或运行以下命令后重新启动。关闭后已生成的中文标题仍然保留。

```powershell
node .\configure-chinese-titles.cjs --disable
```

上述设置仅在下次启动时读取，不会中断正在执行的任务。脚本只更改 `%APPDATA%\Antigravity\chinese-title-settings.json` 中的启用选项，不清空历史处理名单。处理状态和诊断分别保存在同目录的 `chinese-title-state.json`、`chinese-title-status.json`，不保存标题正文或认证值。模型服务及内部接口只在本地 `127.0.0.1` 连接，已验证客户端 2.32.1 和 2.32.2；未来版本需重新核对接口。

## 新项目和新规则的中文偏好

自动中文标题功能不自动修改你的全局智能体规则。如果希望智能体生成的新项目显示名、规则标题和自然语言正文默认中文，可将 [中文偏好示例](examples/chinese-default-rules.md) 追加到 `%USERPROFILE%\.gemini\GEMINI.md`，保留原有内容；无需每个项目重复添加。项目专属要求和用户当次指定的语言仍应遵循。软件随机生成的临时项目名称未修改，规则文件名、代码、路径和技术名称仍保留原文。

## 还原英文界面

保存工作、退出 Antigravity，并在本仓库目录中执行：

```powershell
node .\patch.js --revert
```

还原依赖安装目录中由脚本创建的 `resources/app.asar.bak` 及 `resources/app.asar.bak.json` 校验记录。请同时保留，不要把旧客户端版本的备份用于新版本。对于上游旧版未带校验记录的备份，脚本会先核对版本、文件结构和补丁标记，再补建记录；已汉化却没有原版备份时会停止。

## 验证

安装依赖后执行 `npm test`，可运行界面翻译、动态窗口标题、系统通知边界、项目删除说明、自动中文标题及其启用设置的回归检查，以及合成 ASAR 的重复安装、还原和版本校验测试。

## 后续维护

在 Antigravity 中打开本项目后，先阅读 [GEMINI.md](GEMINI.md) 和 [AGENTS.md](AGENTS.md)。[维护清单](docs/MAINTENANCE.md) 覆盖更新适配、展开区域、通知与隐藏订阅分支；[问题台账](docs/KNOWN-ISSUES.md) 记录跨版本漏译、根因、修复和剩余限制。

## 反馈漏译

提交 Issue 时，请提供客户端版本、进入该页面的操作步骤，以及漏译的英文原文。截图请先遮挡邮箱、文件路径、会话内容等个人信息。

展开菜单、插件目录或远程动态内容可能发生变化。请以当前页面实际显示为准；欢迎提交词条或定位信息。

## 来源与许可

本项目基于 [Bernardxu123/antigravity-chinese](https://github.com/Bernardxu123/antigravity-chinese) 的固定提交 [`a05845582e7771881fb5d9d8d63f34e9c7a75240`](https://github.com/Bernardxu123/antigravity-chinese/tree/a05845582e7771881fb5d9d8d63f34e9c7a75240) 扩展，继续遵循 [MIT 许可](LICENSE)。来源及依赖说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

本项目与 Google 无隶属或官方合作关系。仓库只分发补丁代码、翻译词典和相关文档，不分发 Antigravity 安装包、可执行文件或 `app.asar`。

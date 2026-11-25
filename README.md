# Antigravity 中文界面补丁 · 扩展版

这是 Windows 版 Google Antigravity 的非官方界面汉化补丁。按客户端版本下载安装包，手动应用后，照常从原有的快捷方式打开 Antigravity。

## 下载与安装

1. 安装对应版本的 Windows Antigravity，从下表打开该版本的发行页，下载附件中的 `antigravity-chinese-expanded-*.zip` 并完整解压。
2. 保存工作并正常退出 Antigravity，双击解压目录中的 `install.cmd`。补丁成功应用后，从原来的快捷方式打开客户端。

v1.2.4 起，离线 ZIP 随附 Windows x64 和 ARM64 的便携 Node.js 及运行依赖。解压后即可离线安装和还原。旧版本的前置条件见各自的发行页。

应用会核对客户端资源并保留同版本原版备份。若要还原英文，先正常退出客户端，再双击 `restore.cmd`。官方更新覆盖补丁后，从下表选择适配当前客户端版本的安装包。

界面文案按固定词条和已有句式翻译。项目名称、代码、输入、聊天正文及未收录的文案保留原文。

## 已验证的版本与下载

| Windows Antigravity 版本 | 最新适配包 |
| --- | --- |
| 2.35.1 | [v1.2.4](https://github.com/haha997123/antigravity-chinese-expanded/releases/tag/v1.2.4) |
| 2.34.0 | [v1.2.1](https://github.com/haha997123/antigravity-chinese-expanded/releases/tag/v1.2.1) |
| 2.33.0 | [v1.0.10](https://github.com/haha997123/antigravity-chinese-expanded/releases/tag/v1.0.10) |
| 2.32.2 | [v1.0.8](https://github.com/haha997123/antigravity-chinese-expanded/releases/tag/v1.0.8) |
| 2.32.1 | [v1.0.6](https://github.com/haha997123/antigravity-chinese-expanded/releases/tag/v1.0.6) |

## 手动应用补丁

客户端安装在自定义位置时，正常退出客户端，在解压目录中指定安装路径并运行离线入口。使用前请确认客户端版本。

```powershell
$env:ANTIGRAVITY_INSTALL_DIR = (Resolve-Path .\Antigravity).Path
.\install.cmd
```

从源码运行时，使用随附 npm 的 Node.js 18 或更新版本。执行 `npm ci --ignore-scripts` 后运行 `node .\patch.js --no-kill`。脚本会核对原版归档并保留同版本备份。

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

# Antigravity 中文界面补丁 · 扩展版

面向 **Windows 版 Google Antigravity 2.32.1** 的非官方界面汉化补丁。插件、技能及相关产品名称保留英文，介绍、按钮、分类、设置说明等界面文字译为中文。

本版在上游补丁基础上补充展开区域的漏译，包括“更多插件”、插件详情、内置技能介绍、高级权限设置、项目说明、反馈表单和模型使用情况及状态提示。词典共 **3,368 条**，其中包含 **227 条插件详情示例请求**。这些数字表示当前收录的词条数量，不代表未来新增或服务端动态内容均已覆盖。

## 适用范围

- 已适配、验证的客户端版本：Windows Antigravity **2.32.1**。
- 插件和技能名称保留英文，界面说明使用中文。
- 补丁修改安装目录中的 `resources/app.asar`，首次应用时创建备份，可使用命令还原。
- 界面翻译仅注入 Antigravity 的本地应用页面；代码编辑区、输入内容、会话正文和技能原始定义不作为界面文案翻译。
- 软件更新可能覆盖补丁。更新后需要重新打补丁；如版本已变化，请先确认该版本的兼容性。

模型公告和配额重置说明按句式翻译，模型名、日期和数值实时取自客户端，不固定为截图中的日期。本补丁不会自动下载 GitHub 更新；新的句式需要维护词典或规则。

其他 Antigravity 版本及 macOS、Linux 未在本分支中验证。

## 安装

1. 安装 Windows 版 Antigravity 2.32.1，以及 Node.js 18 或更高版本。
2. 下载本仓库，在解压后的目录中打开 PowerShell。
3. 保存正在进行的工作并退出 Antigravity，然后执行：

```powershell
npm ci --ignore-scripts
node .\patch.js
```

脚本会备份原始 `app.asar`、应用补丁并重新启动 Antigravity。默认会查找当前用户的 Antigravity 安装目录。

也可以双击 `install.cmd` 安装，双击 `restore.cmd` 还原。脚本会检查客户端版本、备份的 SHA-256 和重新打包后的资源；遇到不匹配时停止。

如果安装在其他位置，可先设置环境变量。例如在当前目录下的 `Antigravity` 文件夹中安装了客户端：

```powershell
$env:ANTIGRAVITY_INSTALL_DIR = (Resolve-Path .\Antigravity).Path
node .\patch.js
```

如果希望自行控制退出和重启，可在完全退出客户端后运行：

```powershell
node .\patch.js --no-kill
```

`--no-kill` 只跳过脚本中的关闭、启动步骤；它不会让运行中的界面立即更新。完成后需自行重新启动 Antigravity。

## 还原英文界面

保存工作、退出 Antigravity，并在本仓库目录中执行：

```powershell
node .\patch.js --revert
```

还原依赖安装目录中由脚本创建的 `resources/app.asar.bak` 及 `resources/app.asar.bak.json` 校验记录。请同时保留，不要把旧客户端版本的备份用于新版本。对于上游旧版未带校验记录的备份，脚本会先核对版本、文件结构和补丁标记，再补建记录；已汉化却没有原版备份时会停止。

## 验证

安装依赖后执行 `npm test`，可运行界面翻译回归检查及合成 ASAR 的重复安装、还原和版本校验测试。

## 反馈漏译

提交 Issue 时，请提供客户端版本、进入该页面的操作步骤，以及漏译的英文原文。截图请先遮挡邮箱、文件路径、会话内容等个人信息。

展开菜单、插件目录或远程动态内容可能发生变化。请以当前页面实际显示为准；欢迎提交词条或定位信息。

## 来源与许可

本项目基于 [Bernardxu123/antigravity-chinese](https://github.com/Bernardxu123/antigravity-chinese) 的固定提交 [`a05845582e7771881fb5d9d8d63f34e9c7a75240`](https://github.com/Bernardxu123/antigravity-chinese/tree/a05845582e7771881fb5d9d8d63f34e9c7a75240) 扩展，继续遵循 [MIT 许可](LICENSE)。来源及依赖说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

本项目与 Google 无隶属或官方合作关系。仓库只分发补丁代码、翻译词典和相关文档，不分发 Antigravity 安装包、可执行文件或 `app.asar`。

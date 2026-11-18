# 本项目的工作入口

这是 Antigravity 中文界面补丁项目。开始工作先阅读仓库根目录的 `AGENTS.md`，再阅读 `docs/MAINTENANCE.md` 和 `docs/KNOWN-ISSUES.md`。

默认用中文沟通并维护这些文档。用户希望未来每次客户端更新时都核对边缘界面和历史漏译；插件、技能、模型和产品名称保持原文，说明与固定界面文案使用中文。命令、代码、参数、聊天正文和用户自定义名称保持原值。

不要只按用户最新截图补一个词条就结束；按维护清单判断是否存在同类动态文案、隐藏分支或首次渲染遗漏。不要自动发布，遵循用户当次的本地修改或发布要求。

## Antigravity 环境适配与工作流

在 Antigravity 客户端内置智能体（而非独立 Codex 终端）中维护本项目时，遵循以下约定：

- **进程树与防自杀规则**：Antigravity 的 `language_server.exe` 作为 `Antigravity.exe` 的子进程运行，且运行中的 `Antigravity.exe` 持有 `resources/app.asar` 文件锁。严禁在客户端会话内不带 `--no-kill` 执行 `node patch.js` 或 `install.cmd`（`taskkill /T /F` 会终止当前会话进程树）；带 `--no-kill` 直接覆盖运行中的 `app.asar` 在 Windows 上会触发 `EPERM`。必须先在临时隔离目录基于原版 `app.asar.bak` 完成构建、语法与还原校验，再请用户退出客户端后双击 `install.cmd` 或运行 `node patch.js`。
- **命令行工具链与脚本调用**：PowerShell 会话若未配置全局 `node`、`git` 或 `gh`，可先按常见安装目录探测（如 `%ProgramFiles%\nodejs`、`%USERPROFILE%\.workbuddy\binaries\node\versions\*`、`%USERPROFILE%\.cache\codex-runtimes\*\dependencies\native\git\cmd`、本机 `gh.exe`）并临时写入当前命令 `$env:PATH`。在 PowerShell 中运行多行 Node 脚本应使用 `@' ... '@ | & $node -` 标准输入形式，避免引号转义问题；不要将 Windows GUI 子系统的 `Antigravity.exe`（`ELECTRON_RUN_AS_NODE=1`）用于需要捕获标准输出的脚本。
- **原生菜单与 ASAR 缓存检查**：除页面 DOM `MutationObserver` 外，右键菜单通过 `window.electronNative.showContextMenu` → IPC `window:show-context-menu` → 主进程 `Menu.buildFromTemplate` 弹出，需同时核对 `dist/preload.js`、`dist/main.js` 和 `dist/ipcHandlers.js`。使用 `@electron/asar` 在同一进程中覆盖或重建同名 ASAR 文件后再读取时，务必先调用 `asar.uncache(archive)` 清除旧偏移缓存。

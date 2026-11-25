# 第三方来源与许可说明

## 上游汉化补丁

- 项目：[Bernardxu123/antigravity-chinese](https://github.com/Bernardxu123/antigravity-chinese)
- 本分支基于固定提交：[`a05845582e7771881fb5d9d8d63f34e9c7a75240`](https://github.com/Bernardxu123/antigravity-chinese/tree/a05845582e7771881fb5d9d8d63f34e9c7a75240)
- 上游许可：MIT
- 上游版权声明：`Copyright (c) 2026 Antigravity Chinese Localization Contributors`

本分支保留上游 MIT 版权与许可文本，见仓库根目录的 [LICENSE](LICENSE)。新增工作包括界面词条、动态组合文案处理、名称保留规则及翻译范围修正。

## 运行依赖

补丁使用 [`@electron/asar`](https://github.com/electron/asar) 读取和重新打包 ASAR。该依赖采用 MIT 许可。离线发行包按 `package-lock.json` 打包运行依赖，各包版权及许可保留在 `node_modules` 的对应包内。

离线发行包随附官方 [Node.js v24.22.3](https://nodejs.org/dist/v24.22.3/) 的 Windows x64 和 ARM64 `node.exe`，并在 `runtime/LICENSE.node.txt` 提供 Node.js 及其内置组件的许可。打包脚本固定版本与 SHA-256。ZIP 中的 `runtime/manifest.json` 记录源码提交和运行文件的 SHA-256。

## Antigravity 及插件目录

Google Antigravity 是其权利人的产品，本项目并非官方发行版。Antigravity、Google、Gemini 及第三方插件的名称、商标、文案和标识归各自权利人所有。插件和技能名称保留原文；词典中的中文用于界面本地化。

本仓库不包含 Antigravity 的安装程序、可执行文件、`app.asar`、原始客户端备份、插件安装包或用户账号及会话数据。MIT 许可适用于本项目的补丁代码和翻译贡献，不表示授予 Google 或其他第三方产品、商标的额外权利。

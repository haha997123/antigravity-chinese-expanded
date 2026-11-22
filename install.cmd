@echo off
chcp 65001 >nul
setlocal EnableExtensions DisableDelayedExpansion
set "AG_ZH_SETUP_NODE="
for /f "delims=" %%N in ('where node.exe 2^>nul') do call :try_node "%%N"
for %%D in ("%ProgramFiles%\nodejs" "%ProgramFiles(x86)%\nodejs" "%LOCALAPPDATA%\Programs\nodejs" "%USERPROFILE%\.volta\bin") do call :try_node "%%~D\node.exe"
for /d %%D in ("%USERPROFILE%\.workbuddy\binaries\node\versions\*" "%APPDATA%\nvm\*") do call :try_node "%%~D\node.exe"
if not defined AG_ZH_SETUP_NODE (
  echo 请先安装 Node.js 18 或更新版本，安装时保留 npm，然后重试。
  pause
  exit /b 1
)
"%AG_ZH_SETUP_NODE%" "%~dp0setup-universal.cjs"
set "AG_ZH_SETUP_CODE=%ERRORLEVEL%"
pause
exit /b %AG_ZH_SETUP_CODE%

:try_node
if defined AG_ZH_SETUP_NODE exit /b 0
if not exist "%~1" exit /b 0
"%~1" -e "const f=require('node:fs'),p=require('node:path'); if (+process.versions.node.split('.')[0] < 18) process.exit(1); process.exit(f.existsSync(p.join(p.dirname(process.execPath),'node_modules','npm','bin','npm-cli.js')) ? 0 : 1)" >nul 2>nul
if not errorlevel 1 set "AG_ZH_SETUP_NODE=%~1"
exit /b 0

@echo off
chcp 65001 >nul
setlocal EnableExtensions DisableDelayedExpansion
set "AG_ZH_MODE="
if /i "%~1"=="--revert" set "AG_ZH_MODE=--revert"
set "AG_ZH_NODE="
set "AG_ZH_NPM="
for /f "delims=" %%N in ('where node.exe 2^>nul') do call :try_node "%%N"
for %%D in ("%ProgramFiles%\nodejs" "%ProgramFiles(x86)%\nodejs" "%LOCALAPPDATA%\Programs\nodejs" "%USERPROFILE%\.volta\bin") do call :try_node "%%~D\node.exe"
for /d %%D in ("%USERPROFILE%\.workbuddy\binaries\node\versions\*" "%APPDATA%\nvm\*") do call :try_node "%%~D\node.exe"
if not defined AG_ZH_NODE (
  echo 请先安装 Node.js 18 或更新版本，安装时保留 npm，然后重试。
  pause
  exit /b 1
)
pushd "%~dp0" || exit /b 1
echo 请先保存工作并正常退出 Antigravity。
"%AG_ZH_NODE%" "%AG_ZH_NPM%" ci --ignore-scripts --no-audit --no-fund
if errorlevel 1 (
  echo 依赖安装失败，请检查网络后重试。
  popd
  pause
  exit /b 1
)
"%AG_ZH_NODE%" patch.js %AG_ZH_MODE% --no-kill
set "AG_ZH_RESULT=%ERRORLEVEL%"
if "%AG_ZH_RESULT%"=="0" echo 现在可以用原来的快捷方式启动 Antigravity。
popd
pause
exit /b %AG_ZH_RESULT%

:try_node
if defined AG_ZH_NODE exit /b 0
if not exist "%~1" exit /b 0
if not exist "%~dp1node_modules\npm\bin\npm-cli.js" exit /b 0
"%~1" -e "if (+process.versions.node.split('.')[0] < 18) process.exit(1)" >nul 2>nul
if errorlevel 1 exit /b 0
set "AG_ZH_NODE=%~1"
set "AG_ZH_NPM=%~dp1node_modules\npm\bin\npm-cli.js"
exit /b 0

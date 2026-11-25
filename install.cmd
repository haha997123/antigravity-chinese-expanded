@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
set "AG_ZH_RESULT=1"
set "AG_ZH_SCRIPT=patch.js"
set "AG_ZH_ARGS=--no-kill"

if not "%~2"=="" goto :usage
if "%~1"=="" goto :start
if /i "%~1"=="--revert" (
  set "AG_ZH_ARGS=--revert --no-kill"
  goto :start
)
if /i "%~1"=="--enable" (
  set "AG_ZH_SCRIPT=configure-chinese-titles.cjs"
  set "AG_ZH_ARGS=--enable"
  goto :start
)
if /i "%~1"=="--disable" (
  set "AG_ZH_SCRIPT=configure-chinese-titles.cjs"
  set "AG_ZH_ARGS=--disable"
  goto :start
)
goto :usage

:start
pushd "%~dp0" || goto :open_failed
set "AG_ZH_ARCH="
if /i "%PROCESSOR_ARCHITECTURE%"=="AMD64" set "AG_ZH_ARCH=win-x64"
if /i "%PROCESSOR_ARCHITEW6432%"=="AMD64" set "AG_ZH_ARCH=win-x64"
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "AG_ZH_ARCH=win-arm64"
if /i "%PROCESSOR_ARCHITEW6432%"=="ARM64" set "AG_ZH_ARCH=win-arm64"
if not defined AG_ZH_ARCH goto :unsupported

set "AG_ZH_NODE=runtime\%AG_ZH_ARCH%\node.exe"
if not exist "%AG_ZH_NODE%" goto :incomplete
if not exist "%AG_ZH_SCRIPT%" goto :incomplete
if "%AG_ZH_SCRIPT%"=="patch.js" (
  if not exist "node_modules\@electron\asar\package.json" goto :incomplete
  echo 请先保存工作并正常退出 Antigravity。
)
"%AG_ZH_NODE%" "%AG_ZH_SCRIPT%" %AG_ZH_ARGS%
set "AG_ZH_RESULT=%ERRORLEVEL%"
if "%AG_ZH_RESULT%"=="0" if "%AG_ZH_SCRIPT%"=="patch.js" echo 现在可以用原来的快捷方式启动 Antigravity。
goto :finish

:usage
echo 用法：install.cmd [--revert ^| --enable ^| --disable]
goto :exit_script

:open_failed
echo 无法打开安装包目录。
goto :exit_script

:unsupported
echo 此安装包需要 x64 或 ARM64 版 Windows。
goto :finish

:incomplete
echo 安装包缺少运行文件，请重新下载并完整解压 ZIP 后再试。

:finish
popd

:exit_script
pause
exit /b %AG_ZH_RESULT%

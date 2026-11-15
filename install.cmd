@echo off
chcp 65001 >nul
setlocal
pushd "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 18 或更新版本，再运行此脚本。
  pause
  exit /b 1
)
call npm ci --ignore-scripts --no-audit --no-fund
if errorlevel 1 (
  echo 依赖安装失败，请检查网络后重试。
  pause
  exit /b 1
)
node patch.js
pause
popd

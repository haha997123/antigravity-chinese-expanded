@echo off
chcp 65001 >nul
setlocal
pushd "%~dp0"
node configure-chinese-titles.cjs --enable
pause
popd

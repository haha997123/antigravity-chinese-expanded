@echo off
chcp 65001 >nul
setlocal
pushd "%~dp0"
node patch.js --revert
pause
popd

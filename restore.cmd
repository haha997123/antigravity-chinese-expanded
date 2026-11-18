@echo off
chcp 65001 >nul
setlocal
pushd "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  for %%D in ("%ProgramFiles%\nodejs" "%ProgramFiles(x86)%\nodejs" "%LOCALAPPDATA%\Programs\nodejs" "%USERPROFILE%\.volta\bin") do (
    if exist "%%~D\node.exe" (
      set "PATH=%%~D;%PATH%"
      goto :found_node
    )
  )
  for /d %%D in ("%USERPROFILE%\.workbuddy\binaries\node\versions\*" "%APPDATA%\nvm\*") do (
    if exist "%%~D\node.exe" (
      set "PATH=%%~D;%PATH%"
      goto :found_node
    )
  )
)
:found_node
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 18 或更新版本，再运行此脚本。
  pause
  popd
  exit /b 1
)
node patch.js --revert
pause
popd

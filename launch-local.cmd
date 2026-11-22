@echo off
rem Old desktop shortcuts use this file. Open the official app directly.
setlocal
set "AG_INSTALL=%LOCALAPPDATA%\Programs\antigravity"
if not exist "%AG_INSTALL%\Antigravity.exe" exit /b 1
start "" /D "%AG_INSTALL%" "%AG_INSTALL%\Antigravity.exe"

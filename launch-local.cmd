@echo off
chcp 65001 >nul
setlocal
set "AG_ZH_NODE="
for %%D in ("%ProgramFiles%\nodejs" "%LOCALAPPDATA%\Programs\nodejs") do (
    if exist "%%~D\node.exe" set "AG_ZH_NODE=%%~D\node.exe"
)
if not defined AG_ZH_NODE (
    for /d %%D in ("%USERPROFILE%\.workbuddy\binaries\node\versions\*") do (
        if exist "%%~D\node.exe" set "AG_ZH_NODE=%%~D\node.exe"
    )
)
if not defined AG_ZH_NODE (
    for /f "delims=" %%P in ('where node.exe 2^>nul') do if not defined AG_ZH_NODE set "AG_ZH_NODE=%%P"
)
if not defined AG_ZH_NODE (
    echo Node.js not found. Starting the original Antigravity client.
    start "" /D "%LOCALAPPDATA%\Programs\antigravity" "%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe"
    timeout /t 5 /nobreak >nul
    exit /b 1
)
"%AG_ZH_NODE%" "%~dp0launch-local.cjs"
set "AG_ZH_RESULT=%ERRORLEVEL%"
if not "%AG_ZH_RESULT%"=="0" timeout /t 5 /nobreak >nul
exit /b %AG_ZH_RESULT%

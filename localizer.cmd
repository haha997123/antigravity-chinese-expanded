@echo off
setlocal EnableExtensions DisableDelayedExpansion
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -STA -File "%~dp0localizer-ui.ps1"
exit /b %ERRORLEVEL%

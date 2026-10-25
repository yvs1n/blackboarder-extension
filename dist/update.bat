@echo off
title Blackboarder updater
rem Updates Blackboarder now and turns on automatic updates. Run it once; your data is kept.
set "SCRIPT_PATH=%~dp0updater\blackboarder-updater.ps1"
if not exist "%SCRIPT_PATH%" set "SCRIPT_PATH=%~dp0blackboarder-updater.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_PATH%" -Install
echo.
pause

@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js was not found.
  echo Install Node.js 20 or newer, then run this file again.
  goto :startup_failed
)

echo Starting DSR Randomizer...
start "DSR Randomizer" /D "%~dp0" cmd.exe /c node src\cli.js ui
if errorlevel 1 goto :startup_failed
exit /b 0

:startup_failed
echo.
echo The randomizer could not be started.
echo Press any key to close this window...
pause >nul
exit /b 1

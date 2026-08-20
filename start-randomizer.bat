@echo off
setlocal
cd /d "%~dp0"

echo Starting DSR Randomizer...
if exist "%~dp0release\DSR-Randomizer.exe" (
  start "" "%~dp0release\DSR-Randomizer.exe"
) else if exist "%~dp0node_modules\electron\dist\electron.exe" (
  start "" /D "%~dp0" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0"
) else (
  echo ERROR: The desktop launcher was not found.
  echo Run npm install and then try again.
  goto :startup_failed
)
if errorlevel 1 goto :startup_failed
exit /b 0

:startup_failed
echo.
echo The randomizer could not be started.
echo Press any key to close this window...
pause >nul
exit /b 1

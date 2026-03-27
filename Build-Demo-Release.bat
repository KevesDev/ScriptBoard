@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title ScriptBoard release build

REM ============================================================================
REM  One pipeline: npm run release:demo
REM  Output: .\Distribution\  (installers + win-unpacked)
REM  Zip/share: .\Distribution\Distribute\  (Setup + Portable + READ-ME-FIRST.txt)
REM
REM  "Build" is NOT used - on Windows, "Build" and "build" are the same folder as
REM  electron-builder's default buildResources, which breaks packaging.
REM ============================================================================

echo.
echo  ============================================
echo   ScriptBoard - demo release build (Windows)
echo  ============================================
echo.
echo  Project folder: %CD%
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found in PATH for this window.
  echo          Install LTS from https://nodejs.org/  then try again.
  echo          Tip: open this .bat from a folder where "node -v" works in cmd.
  pause
  exit /b 1
)

if not exist "package.json" (
  echo [ERROR] package.json not found here. Put Build-Demo-Release.bat in the project root.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo [0/1] npm install ...
  call npm install
  if errorlevel 1 goto :fail
)

echo.
echo  Running: npm run release:demo
echo  (production build + electron-builder + Distribute folder^)
echo.
call npm run release:demo
if errorlevel 1 goto :fail

if not exist "Distribution\" (
  echo [ERROR] Expected folder "Distribution" was not created. See errors above.
  pause
  exit /b 1
)

echo.
echo  ========== SUCCESS ==========
echo.
echo  Full packager output:  %CD%\Distribution
echo  Send to your friend:   %CD%\Distribution\Distribute
echo.
dir /B "%CD%\Distribution\Distribute"
echo.
echo  Opening Distribution\Distribute in Windows File Explorer...
start "" explorer "%CD%\Distribution\Distribute"
echo.
pause
exit /b 0

:fail
echo.
echo  ========== BUILD FAILED ==========
echo  If electron-builder errors mention NSIS or WINE, install build tools per:
echo  https://www.electron.build/multi-platform-build
echo.
pause
exit /b 1

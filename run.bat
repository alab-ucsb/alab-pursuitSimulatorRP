@echo off
setlocal enableextensions
rem Pursuit Simulator RP - run from source. First run sets everything up; later runs just launch.
rem Requires: Node.js 20+ and Python 3.11 (https://nodejs.org, https://www.python.org/downloads/release/python-3119/)

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "BACKEND=%ROOT%\pursuit-simulator-backend\backend"
set "FRONTEND=%ROOT%\pursuit-simulator-frontend"
set "DESKTOP=%ROOT%\pursuit-simulator-desktop"
set "VENV=%ROOT%\.venv"

rem VS Code sets this, and it makes Electron run as plain Node.
set ELECTRON_RUN_AS_NODE=

rem ---- Node ----
where node >nul 2>&1 || if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
where node >nul 2>&1 || (
  echo [!] Node.js was not found. Install Node.js 20+ from https://nodejs.org and run this again.
  goto :fail
)

rem ---- Python venv (3.11 needed: the pinned numpy/pandas have no wheels for 3.13+) ----
if not exist "%VENV%\Scripts\python.exe" (
  echo Creating Python environment...
  py -3.11 -m venv "%VENV%" 2>nul
  if not exist "%VENV%\Scripts\python.exe" (
    python -c "import sys; sys.exit(0 if sys.version_info[:2]==(3,11) else 1)" >nul 2>&1 && python -m venv "%VENV%"
  )
  if not exist "%VENV%\Scripts\python.exe" (
    echo [!] Python 3.11 was not found. Install it from https://www.python.org/downloads/release/python-3119/ and run this again.
    goto :fail
  )
)
if not exist "%VENV%\.deps-ok" (
  echo Installing backend packages ^(first run only, a few minutes^)...
  "%VENV%\Scripts\python.exe" -m pip install -r "%BACKEND%\requirements.txt" || goto :fail
  echo ok> "%VENV%\.deps-ok"
)

rem ---- Frontend build ----
if not exist "%DESKTOP%\frontend-build\index.html" (
  if not exist "%FRONTEND%\build\index.html" (
    echo Building the frontend ^(first run only^)...
    pushd "%FRONTEND%"
    call npm ci || (popd & goto :fail)
    call npm run build || (popd & goto :fail)
    popd
  )
  echo Copying frontend build...
  robocopy "%FRONTEND%\build" "%DESKTOP%\frontend-build" /E /NFL /NDL /NJH /NJS /NP >nul
  if errorlevel 8 goto :fail
)

rem ---- Electron ----
if not exist "%DESKTOP%\node_modules\electron\dist\electron.exe" (
  echo Installing Electron ^(first run only^)...
  pushd "%DESKTOP%"
  call npm install || (popd & goto :fail)
  popd
)

rem ---- Launch ----
set "PURSUIT_PYTHON=%VENV%\Scripts\python.exe"
cd /d "%DESKTOP%"
call npm start
exit /b %errorlevel%

:fail
echo.
echo Setup failed. See the messages above.
pause
exit /b 1

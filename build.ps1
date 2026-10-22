# Builds the Pursuit Simulator desktop installer.
# Requirements: Python 3.11 (py -3.11), Node.js 20+ with npm.
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$backend = Join-Path $root "pursuit-simulator-backend\backend"
$frontend = Join-Path $root "pursuit-simulator-frontend"
$desktop = Join-Path $root "pursuit-simulator-desktop"
$venv = Join-Path $root ".build-venv"

# 1. Backend -> PyInstaller onedir
if (-not (Test-Path $venv)) { py -3.11 -m venv $venv }
$py = Join-Path $venv "Scripts\python.exe"
& $py -m pip install --upgrade pip
& $py -m pip install -r (Join-Path $backend "requirements.txt") pyinstaller
Push-Location $backend
& $py -m PyInstaller --noconfirm --clean --onedir --name run_server `
    --distpath (Join-Path $desktop "backend-dist") `
    --workpath (Join-Path $root ".build-work") `
    --specpath (Join-Path $root ".build-work") `
    --collect-submodules scipy --collect-submodules pandas `
    --hidden-import uvicorn.logging --hidden-import uvicorn.loops.auto `
    --hidden-import uvicorn.protocols.http.auto --hidden-import uvicorn.protocols.websockets.auto `
    --hidden-import uvicorn.lifespan.on --hidden-import multipart `
    run_server.py
Pop-Location

# 2. Frontend -> static build
Push-Location $frontend
npm ci
npm run build
Pop-Location
$fbuild = Join-Path $desktop "frontend-build"
if (Test-Path $fbuild) { Remove-Item $fbuild -Recurse -Force }
Copy-Item (Join-Path $frontend "build") $fbuild -Recurse

# 3. Electron installer
Push-Location $desktop
npm install
npm run dist
Pop-Location

Write-Host "Done. Installer is in $desktop\dist"

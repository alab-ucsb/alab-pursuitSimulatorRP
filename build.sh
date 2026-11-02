#!/usr/bin/env bash
# Builds the Pursuit Simulator desktop installer (.dmg) for the Mac you run it on (Apple Silicon or Intel).
# Mac counterpart of build.ps1. Requirements: Python 3.11 (python3.11), Node.js 20+ with npm.
# Output: pursuit-simulator-desktop/dist/Pursuit-Simulator-RP-x.y.z-mac-<arm64|x64>.dmg
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/pursuit-simulator-backend/backend"
FRONTEND="$ROOT/pursuit-simulator-frontend"
DESKTOP="$ROOT/pursuit-simulator-desktop"
VENV="$ROOT/.build-venv"

# VS Code sets this, and it makes Electron run as plain Node.
unset ELECTRON_RUN_AS_NODE

# The PyInstaller backend is built for this machine's CPU, so the installer must match it.
case "$(uname -m)" in
  arm64)  ARCH=arm64 ;;
  x86_64) ARCH=x64 ;;
  *) echo "Unsupported CPU: $(uname -m)"; exit 1 ;;
esac

PY="${PYTHON:-python3.11}"
command -v "$PY" >/dev/null 2>&1 || { echo "Python 3.11 is needed to build (set PYTHON=/path/to/python3.11)."; exit 1; }
"$PY" -c 'import sys; sys.exit(0 if sys.version_info[:2]==(3,11) else 1)' || { echo "$PY is not Python 3.11."; exit 1; }

# 1. Backend -> PyInstaller onedir
[ -d "$VENV" ] || "$PY" -m venv "$VENV"
"$VENV/bin/python" -m pip install --upgrade pip
"$VENV/bin/python" -m pip install -r "$BACKEND/requirements.txt" pyinstaller
rm -rf "$DESKTOP/backend-dist"
(
  cd "$BACKEND"
  "$VENV/bin/python" -m PyInstaller --noconfirm --clean --onedir --name run_server \
    --distpath "$DESKTOP/backend-dist" \
    --workpath "$ROOT/.build-work" \
    --specpath "$ROOT/.build-work" \
    --collect-submodules scipy --collect-submodules pandas \
    --hidden-import uvicorn.logging --hidden-import uvicorn.loops.auto \
    --hidden-import uvicorn.protocols.http.auto --hidden-import uvicorn.protocols.websockets.auto \
    --hidden-import uvicorn.lifespan.on --hidden-import multipart \
    run_server.py
)

# 2. Frontend -> static build
(cd "$FRONTEND" && npm ci && npm run build)
rm -rf "$DESKTOP/frontend-build"
cp -R "$FRONTEND/build" "$DESKTOP/frontend-build"

# 3. Electron installer
(cd "$DESKTOP" && npm ci && npm run dist:mac -- "--$ARCH")

echo "Done. Installer is in $DESKTOP/dist"

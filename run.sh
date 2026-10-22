#!/usr/bin/env bash
# Pursuit Simulator RP - run from source (macOS/Linux). First run sets everything up; later runs just launch.
# Requires: Node.js 20+ and Python 3.11 (https://nodejs.org, https://www.python.org/downloads/release/python-3119/)
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/pursuit-simulator-backend/backend"
FRONTEND="$ROOT/pursuit-simulator-frontend"
DESKTOP="$ROOT/pursuit-simulator-desktop"
VENV="$ROOT/.venv"

fail() { echo; echo "[!] $1"; exit 1; }

# VS Code sets this, and it makes Electron run as plain Node.
unset ELECTRON_RUN_AS_NODE

# Homebrew locations aren't always on PATH for scripts.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# ---- Node ----
command -v node >/dev/null 2>&1 || fail "Node.js was not found. Install Node.js 20+ from https://nodejs.org and run this again."

# ---- Python venv (3.11 needed: the pinned numpy/pandas have no wheels for 3.13+) ----
if [ ! -x "$VENV/bin/python" ]; then
  PY=""
  for c in python3.11 python3 python; do
    if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(0 if sys.version_info[:2]==(3,11) else 1)' 2>/dev/null; then
      PY="$c"; break
    fi
  done
  [ -n "$PY" ] || fail "Python 3.11 was not found. Install it from https://www.python.org/downloads/release/python-3119/ (or 'brew install python@3.11') and run this again."
  echo "Creating Python environment..."
  "$PY" -m venv "$VENV"
fi
if [ ! -f "$VENV/.deps-ok" ]; then
  echo "Installing backend packages (first run only, a few minutes)..."
  "$VENV/bin/python" -m pip install -r "$BACKEND/requirements.txt"
  echo ok > "$VENV/.deps-ok"
fi

# ---- Frontend build ----
if [ ! -f "$DESKTOP/frontend-build/index.html" ]; then
  if [ ! -f "$FRONTEND/build/index.html" ]; then
    echo "Building the frontend (first run only)..."
    (cd "$FRONTEND" && npm ci && npm run build)
  fi
  echo "Copying frontend build..."
  rm -rf "$DESKTOP/frontend-build"
  cp -R "$FRONTEND/build" "$DESKTOP/frontend-build"
fi

# ---- Electron ----
if [ ! -d "$DESKTOP/node_modules/electron/dist" ]; then
  echo "Installing Electron (first run only)..."
  (cd "$DESKTOP" && npm install)
fi

# ---- Launch ----
export PURSUIT_PYTHON="$VENV/bin/python"
cd "$DESKTOP"
npm start

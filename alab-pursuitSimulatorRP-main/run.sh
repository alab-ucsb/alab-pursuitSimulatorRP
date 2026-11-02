#!/usr/bin/env bash
# Pursuit Simulator RP - run from source (macOS/Linux). First run sets everything up; later runs just launch.
# Requires: Node.js 20+ and Python 3.10-3.12 (https://nodejs.org, https://www.python.org/downloads/release/python-3119/)
# Most people should use the installer from the GitHub Releases page instead; this script is for running from source.
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

# ---- Python venv (3.10-3.12: the pinned numpy/pandas/scipy have no prebuilt wheels for 3.13+) ----
if [ ! -x "$VENV/bin/python" ]; then
  PY=""
  for c in python3.11 python3.12 python3.10 python3 python; do
    p="$(command -v "$c" 2>/dev/null)" || continue
    # Without the Xcode command line tools, /usr/bin/python3 is a stub that pops up an installer dialog.
    if [ "$p" = /usr/bin/python3 ] && ! xcode-select -p >/dev/null 2>&1; then continue; fi
    if "$p" -c 'import sys; sys.exit(0 if (3,10) <= sys.version_info[:2] <= (3,12) else 1)' 2>/dev/null; then
      PY="$p"; break
    fi
  done
  [ -n "$PY" ] || fail "Python 3.10, 3.11 or 3.12 was not found (3.13+ does not work). Install Python 3.11 from https://www.python.org/downloads/release/python-3119/ and run this again."
  echo "Creating Python environment..."
  "$PY" -m venv "$VENV"
fi
# Also reinstalls when requirements.txt is edited (a package added or changed).
if [ ! -f "$VENV/.deps-ok" ] || [ "$BACKEND/requirements.txt" -nt "$VENV/.deps-ok" ]; then
  echo "Installing backend packages (a few minutes the first time)..."
  "$VENV/bin/python" -m pip install -r "$BACKEND/requirements.txt"
  echo ok > "$VENV/.deps-ok"
fi

# ---- Frontend build ----
# The repo ships a prebuilt frontend, so a fresh download needs no build. After that, rebuild whenever the
# frontend source changes. A hash is used (not file dates) because a fresh git clone leaves the dates arbitrary.
frontend_hash() {
  (cd "$FRONTEND" && find src public package.json package-lock.json -type f ! -name .DS_Store -print0 \
    | LC_ALL=C sort -z | xargs -0 cksum | cksum)
}
FRONTEND_HASH_FILE="$VENV/.frontend-hash"
FRONTEND_HASH="$(frontend_hash)"
if [ ! -f "$DESKTOP/frontend-build/index.html" ] \
   || { [ -f "$FRONTEND_HASH_FILE" ] && [ "$(cat "$FRONTEND_HASH_FILE")" != "$FRONTEND_HASH" ]; }; then
  echo "Building the frontend..."
  # npm ci only when packages are missing or package-lock.json changed
  (cd "$FRONTEND" && { { [ -d node_modules ] && [ ! package-lock.json -nt node_modules/.package-lock.json ]; } || npm ci; } && npm run build)
  echo "Copying frontend build..."
  rm -rf "$DESKTOP/frontend-build"
  cp -R "$FRONTEND/build" "$DESKTOP/frontend-build"
fi
echo "$FRONTEND_HASH" > "$FRONTEND_HASH_FILE"

# ---- Electron ----
# path.txt is written only once Electron's binary has downloaded and unpacked, so it catches half-finished installs.
if [ ! -f "$DESKTOP/node_modules/electron/path.txt" ]; then
  echo "Installing Electron (first run only)..."
  (cd "$DESKTOP" && rm -rf node_modules/electron && npm install)
  # npm setups with ignore-scripts skip Electron's download step; run it directly.
  [ -f "$DESKTOP/node_modules/electron/path.txt" ] || (cd "$DESKTOP" && node node_modules/electron/install.js)
  [ -f "$DESKTOP/node_modules/electron/path.txt" ] || fail "Electron did not download. Check your internet connection (it comes from github.com) and run this again."
fi

# ---- Launch ----
export PURSUIT_PYTHON="$VENV/bin/python"
cd "$DESKTOP"
npm start

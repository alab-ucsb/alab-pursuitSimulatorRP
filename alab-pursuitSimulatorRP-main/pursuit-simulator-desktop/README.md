# Pursuit Simulator RP — local desktop app (Randomized only)

Electron shell around the Randomized (RP) generator: React frontend + FastAPI backend, nothing stored on a server. The Characterized (CP/CPP) and Mixed modes are not part of this build.

## Where things go
- **Data folder** (chosen on first launch, changeable from the top bar): exported RPs are also kept in `randomized/` inside it.
- **Exports**: Export CSV opens a Save As dialog for the copy you pick, and a copy is also written to `randomized/` in the data folder.
- App config and `backend.log`: Electron's userData folder, separate from the full app's. Windows: `%APPDATA%\pursuit-simulator-rp-desktop`. Mac: `~/Library/Application Support/pursuit-simulator-rp-desktop`.

## Build the installer
Needs Python 3.11 and Node.js 20+. GitHub Actions builds all three installers on a version tag (see the top-level README); to build one locally:

**Windows** (needs `py -3.11`):

    powershell -ExecutionPolicy Bypass -File ..\build.ps1

Output: `dist\Pursuit-Simulator-RP-Setup-x.y.z.exe`.

**Mac** (builds for the chip you are on; set `PYTHON=/path/to/python3.11` if `python3.11` is not on your PATH):

    bash ../build.sh

Output: `dist/Pursuit-Simulator-RP-x.y.z-mac-arm64.dmg` (or `-x64` on an Intel Mac). The app is ad-hoc signed by `adhoc-sign.js`, not notarized; see the top-level README for the first-launch steps.

## Run from source (dev)
1. `cd ..\pursuit-simulator-frontend && npm ci && npm run build`, then copy `build\` to `pursuit-simulator-desktop\frontend-build`.
2. `cd pursuit-simulator-desktop && npm install`
3. Point at a Python with the backend requirements installed, then start:

        $env:PURSUIT_PYTHON = "C:\path\to\python.exe"
        npm start

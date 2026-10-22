# Pursuit Simulator RP — local desktop app (Randomized only)

Electron shell around the Randomized (RP) generator: React frontend + FastAPI backend, nothing stored on a server. The Characterized (CP/CPP) and Mixed modes are not part of this build.

## Where things go
- **Data folder** (chosen on first launch, changeable from the top bar): exported RPs are also kept in `randomized/` inside it.
- **Exports**: Export CSV opens a Save As dialog for the copy you pick, and a copy is also written to `randomized/` in the data folder.
- App config and `backend.log`: Electron's userData folder (`%APPDATA%\pursuit-simulator-rp-desktop`), separate from the full app's.

## Build the installer (Windows)
Needs Python 3.11 (`py -3.11`) and Node.js 20+.

    powershell -ExecutionPolicy Bypass -File ..\build.ps1

Output: `dist\Pursuit Simulator RP Setup x.y.z.exe`.

## Run from source (dev)
1. `cd ..\pursuit-simulator-frontend && npm ci && npm run build`, then copy `build\` to `pursuit-simulator-desktop\frontend-build`.
2. `cd pursuit-simulator-desktop && npm install`
3. Point at a Python with the backend requirements installed, then start:

        $env:PURSUIT_PYTHON = "C:\path\to\python.exe"
        npm start

# Pursuit Simulator RP

Desktop app for generating Randomized Pursuit (RP) sessions. Runs locally; nothing is stored on a server.

## Quick start (Windows)

1. Install, once:
   - [Node.js 20+](https://nodejs.org)
   - [Python 3.11](https://www.python.org/downloads/release/python-3119/) (must be 3.11, newer versions break the backend packages)
2. Download or clone this repo.
3. Double-click **`run.bat`** in the top folder.
4. The first run takes about 5-10 minutes while it installs everything. Later runs start in seconds.
5. When the app opens, choose a folder for your saved data.

If setup fails, the window stays open with the error message.

## Where things go

- **Data folder**: chosen on first launch and changeable from the top bar. Exported RPs are kept in `randomized/` inside it.
- **Exports**: Export CSV opens a Save As dialog, and a copy is also written to the data folder.
- **Logs and config**: `%APPDATA%\pursuit-simulator-rp-desktop` (includes `backend.log`, useful if something goes wrong).

## Other ways to run

- **Installer for people without Node/Python**: run `powershell -ExecutionPolicy Bypass -File build.ps1` to build `pursuit-simulator-desktop\dist\Pursuit Simulator RP Setup x.y.z.exe`. The installer is unsigned, so Windows SmartScreen will warn; choose "More info" then "Run anyway".
- **Manual dev run**: see [pursuit-simulator-desktop/README.md](pursuit-simulator-desktop/README.md).

## Project layout

- `pursuit-simulator-backend/` - FastAPI backend (Python)
- `pursuit-simulator-frontend/` - React frontend
- `pursuit-simulator-desktop/` - Electron shell that runs both

# Pursuit Simulator RP

Desktop app for generating Randomized Pursuit (RP) sessions. Runs locally; nothing is stored on a server.

## Install 

Download the installer for your computer:

| Computer | File |
|---|---|
| Windows | `Pursuit-Simulator-RP-Setup-x.y.z.exe` |
| Mac with Apple silicon (M1, M2, M3, M4...) | `Pursuit-Simulator-RP-x.y.z-mac-arm64.dmg` |
| Mac with an Intel chip | `Pursuit-Simulator-RP-x.y.z-mac-x64.dmg` |

When the app opens, choose a folder for your saved data.

## Where things go

- **Data folder**: chosen on first launch and changeable from the top bar. Exported RPs are kept in `randomized/` inside it.
- **Exports**: Export CSV opens a Save As dialog, and a copy is also written to the data folder.
- **Logs and config** (`backend.log` is useful if something goes wrong):
  - Windows: `%APPDATA%\pursuit-simulator-rp-desktop`
  - Mac: `~/Library/Application Support/pursuit-simulator-rp-desktop`

## Run from source (developers)

1. Install [Node.js 20+](https://nodejs.org) and [Python 3.11](https://www.python.org/downloads/release/python-3119/). (`run.sh` also accepts Python 3.10 or 3.12; 3.13 and newer do not work with the pinned backend packages.)
2. Download or clone this repo.
3. Start it:
   - **Windows:** double-click **`run.bat`** in the top folder.
   - **macOS / Linux:** open Terminal in the top folder and run `bash run.sh`.
4. The first run takes about 5-10 minutes while it installs everything. Later runs start in seconds.
5. To change the app, edit the code and run `run.sh` again. It reinstalls the Python packages if `requirements.txt` changed and rebuilds the frontend if anything in `pursuit-simulator-frontend/` changed (`run.bat` does neither yet). Backend and `main.js` edits are picked up on the next launch. If you edited the frontend before ever running `run.sh`, delete the `pursuit-simulator-desktop/frontend-build` folder once to force a rebuild.

If setup fails, the error is printed (on Windows the window stays open so you can read it). For a manual dev run see [pursuit-simulator-desktop/README.md](pursuit-simulator-desktop/README.md).

## Building the installers

GitHub builds all three installers for you (`.github/workflows/release.yml`):

1. Set `version` in `pursuit-simulator-desktop/package.json`.
2. Push a tag: `git tag v0.1.1 && git push origin v0.1.1`. The installers appear on the Releases page when the run finishes (about 15 minutes).
3. To test a build without releasing, open the repo's **Actions** tab, choose **Build installers**, and click **Run workflow**. The installers are attached to the run as downloads.

To build one on your own computer instead, you need Python 3.11 and Node.js 20+ (only the person making the installer needs them, not the people who install it):

- **Windows:** `powershell -ExecutionPolicy Bypass -File build.ps1` produces `pursuit-simulator-desktop\dist\Pursuit-Simulator-RP-Setup-x.y.z.exe`.
- **Mac:** `bash build.sh` produces a `.dmg` for the chip in the Mac you run it on, in `pursuit-simulator-desktop/dist/`.

## Project layout

- `pursuit-simulator-backend/` - FastAPI backend (Python)
- `pursuit-simulator-frontend/` - React frontend
- `pursuit-simulator-desktop/` - Electron shell that runs both

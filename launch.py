"""Start Pursuit Simulator RP and open it in your browser.

    conda activate pursuit-simulator
    python launch.py

Options:
    --data-dir FOLDER   where exported RPs are kept (default: Documents/PursuitSimulator)
    --port N            port to use (default: 3080, or any free port if that one is taken)
    --no-browser        don't open a browser tab
Press Ctrl+C in this window to quit.
"""
import argparse
import os
import socket
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "pursuit-simulator-backend" / "backend"
FRONTEND_BUILDS = [
    ROOT / "pursuit-simulator-frontend" / "build",          # your own `npm run build`, if you changed the frontend
    ROOT / "frontend-build",                                # prebuilt copy that ships with the repo
]


def find_frontend():
    for d in FRONTEND_BUILDS:
        if (d / "index.html").is_file():
            return d
    sys.exit("The built frontend was not found (expected frontend-build/index.html in the repo folder).")


def pick_port(preferred):
    for p in (preferred, 0):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", p))
                return s.getsockname()[1]
            except OSError:
                continue
    sys.exit("Could not find a free port.")


def open_browser_when_ready(port, url):
    deadline = time.time() + 120  # the very first start after creating the environment can be slow
    while time.time() < deadline:
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=1).close()
            webbrowser.open(url)
            return
        except OSError:
            time.sleep(0.3)


def main():
    ap = argparse.ArgumentParser(description="Start Pursuit Simulator RP.")
    ap.add_argument("--data-dir", default=str(Path.home() / "Documents" / "PursuitSimulator"))
    ap.add_argument("--port", type=int, default=3080)
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()
    print("Starting Pursuit Simulator RP (the first start can take up to a minute)...", flush=True)

    data_dir = Path(args.data_dir).expanduser().resolve()
    data_dir.mkdir(parents=True, exist_ok=True)
    os.environ["PURSUIT_DATA_DIR"] = str(data_dir)  # the backend reads this when it is imported

    try:
        import uvicorn
        from fastapi.staticfiles import StaticFiles
        sys.path.insert(0, str(BACKEND))
        import main as backend
    except ModuleNotFoundError as e:
        sys.exit(f"Missing package: {e.name}. Run this inside the conda environment:\n"
                 "    conda activate pursuit-simulator\n    python launch.py\n"
                 "(create it first; the command is in README.md)")

    backend.app.mount("/app", StaticFiles(directory=str(find_frontend()), html=True), name="ui")

    port = pick_port(args.port)
    url = f"http://127.0.0.1:{port}/app/"
    if not args.no_browser:
        threading.Thread(target=open_browser_when_ready, args=(port, url), daemon=True).start()

    if port != args.port:
        print(f"Port {args.port} is in use, so using {port} instead.", flush=True)
    print(f"Pursuit Simulator RP is running at {url}", flush=True)
    print(f"Saved exports go in: {data_dir / 'randomized'}", flush=True)
    print("Press Ctrl+C to quit.", flush=True)
    uvicorn.run(backend.app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()

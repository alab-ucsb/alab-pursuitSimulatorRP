"""
Entry point for the packaged desktop app.
Usage: run_server.exe <port>
Data location is taken from the PURSUIT_DATA_DIR environment variable.
"""

import sys
import uvicorn

from main import app

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 3080
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")

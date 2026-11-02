# Pursuit Simulator RP

App for generating Randomized Pursuit (RP) sessions. It runs entirely on your own computer, in your web browser. There is no server and nothing is uploaded.

## Run it

You need [Miniconda](https://docs.conda.io/en/latest/miniconda.html) (or Anaconda). That is the only thing to install: the environment below brings its own Python and every package, so there is no separate Python or Node to install and no version to match.

1. Install Miniconda, if you don't have conda already.
2. Download this repo (green **Code** button, then **Download ZIP**) and unzip it.
3. Open a terminal. On a Mac use Terminal. On Windows use **Anaconda Prompt** (it is in the Start menu after installing conda).
4. Run this in the terminal, using the path to the folder you unzipped:

       cd path/to/downloadedRepo

5. Set up once (a few minutes):

       conda create -n pursuit-simulator --override-channels -c conda-forge --file conda-packages.txt -y

   The `--override-channels -c conda-forge` part keeps conda on the free conda-forge channel, so it won't stop to ask you to accept Anaconda's Terms of Service.

6. Start the app (every time):

       conda activate pursuit-simulator
       python launch.py
* Might need to copy full path to the "launch.py"
  
Your browser opens the app. Press Ctrl+C in the terminal to quit.

## Where things go

- **Export CSV** downloads the file through your browser, to its usual Downloads folder. Nothing else is saved on your computer.
- Options: `--port 3080` (used automatically if free, otherwise another port is picked) and `--no-browser`.

## If something goes wrong

- **"Missing package"**: you skipped `conda activate pursuit-simulator`. Run it and try again.
- **"conda: command not found"**: close and reopen the terminal after installing Miniconda (on Windows, use Anaconda Prompt).
- **The very first start is slow** (up to a minute). Later starts take a couple of seconds.
- **"Terms of Service have not been accepted"**: conda was run without the `--override-channels -c conda-forge` part of the setup command. Run the full command from step 5.
- **After downloading a newer version of the repo**, run this once, then start as usual:

      conda install -n pursuit-simulator --override-channels -c conda-forge --file conda-packages.txt -y

- **Windows on an ARM laptop (Snapdragon)** is not supported: the pinned packages have no ARM builds. Install the regular 64-bit Miniconda instead, which runs under Windows' emulation (not tested).

## Changing the code

The conda environment also includes Node.js, so you can edit everything without installing anything else.

- **Backend** (`pursuit-simulator-backend/backend/`): edit, then quit with Ctrl+C and run `python launch.py` again.
- **Frontend** (`pursuit-simulator-frontend/src/`): build it, then start the app again:

      cd pursuit-simulator-frontend
      npm ci
      npm run build
      cd ..
      python launch.py

  `launch.py` uses your fresh `pursuit-simulator-frontend/build` when it exists. To share the change, copy that `build` folder over `frontend-build`, which is the prebuilt copy that ships with the repo.
- For live reload while developing, run the backend with `python -m uvicorn main:app --reload --port 3080` from the backend folder, and `npm start` in the frontend folder.

## Project layout

- `launch.py` - starts the backend and opens the app in your browser
- `conda-packages.txt` - what goes into the conda environment (Python 3.11, numpy, pandas, scipy, FastAPI, Node.js)
- `pursuit-simulator-backend/` - FastAPI backend (Python)
- `pursuit-simulator-frontend/` - React frontend (source)
- `frontend-build/` - the prebuilt frontend that `launch.py` serves, so Node is not needed to run the app

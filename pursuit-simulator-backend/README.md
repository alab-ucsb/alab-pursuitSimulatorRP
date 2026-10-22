# Pursuit Trajectory Simulator

A full-stack scientific simulation tool for generating and visualizing pursuit trajectories with configurable angular and linear velocity distributions.

## Project Structure

```
pursuit-simulator/
├── backend/              # Python (FastAPI) — simulation engine
│   ├── main.py           # Core logic + API endpoints
│   └── requirements.txt  # Python dependencies
├── frontend/             # React — visualization interface
│   └── (created via create-react-app)
└── README.md
```

## Quick Start

### Backend (Python)

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

The API will be available at `http://localhost:3080`. You can test it by visiting `http://localhost:3080/docs` — FastAPI auto-generates interactive API documentation.

### Frontend (React)

```bash
cd frontend
npm install
npm start
```

Opens at `http://localhost:3000`.

## API Endpoints

| Method | Endpoint             | Description                          |
|--------|----------------------|--------------------------------------|
| POST   | `/run`               | Run full simulation                  |
| POST   | `/regenerate`        | Regenerate a single trial            |
| POST   | `/flip`              | Flip trial on X or Y axis            |
| POST   | `/export`            | Download trajectories as CSV         |
| POST   | `/upload-durations`  | Upload per-trial durations CSV       |
| GET    | `/`                  | Health check                         |

## Core Simulation

The trajectory generator supports three distribution types for both angular and linear velocity:

- **Gaussian** — Wrapped normal distribution
- **Wrapped** — Von Mises distribution (circular analog of normal)
- **Skewed** — Gamma distribution with peak shifting

Each trial generates a trajectory by:
1. Starting at the origin
2. Sampling angular velocity changes at random intervals (30–60 frames)
3. Applying constant linear velocity of 1 per frame
4. Normalizing to [-scaleX, scaleX] × [-scaleY, scaleY] with uniform scaling
5. Retrying until the start position falls within the specified range

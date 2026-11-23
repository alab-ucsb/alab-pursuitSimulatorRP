"""
Pursuit Trajectory Simulator — API Layer
==========================================
Thin FastAPI wrapper around the simulation engine.
No math lives here — just request/response handling.

Run with:
    uvicorn main:app --reload --port 3080

Interactive docs available at:
    http://localhost:3080/docs
"""

from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import Optional, List
import math
import numpy as np
import pandas as pd
import io

from simulation import (
    build_distributions, run_trial_bounded, compute_histogram,
    smooth_trajectory, reinterpolate_trajectory
)

app = FastAPI(title="Pursuit Trajectory Simulator")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# REQUEST MODELS
# ============================================================

class SimulationParams(BaseModel):
    """Parameters for running a full simulation."""

    balanced_speed: bool = True

    arena_width: float = 60.0   # cm
    arena_height: float = 60.0  # cm

    speed_min: float = 10.0    # cm/s
    speed_max: float = 35.0    # cm/s
    speed_peak: float = 25.0   # cm/s

    t_mod_min: int = 30
    t_mod_max: int = 60

    # Distribution types
    a_dist: str = "Wrapped"
    l_dist: str = "Skewed"

    # Angular range
    angular_min: float = 0
    angular_max: float = 60

    # Linear range (used by Gaussian, Wrapped, Skewed)
    linear_min: float = 0
    linear_max: float = 100

    # Distribution parameters
    kappa: float = 1.0
    peak: float = 1
    a_shape: float = 3.0
    a_scale: float = 1.0
    l_shape: float = 5.0
    l_scale: float = 3.0

    # Trajectory
    hz: int = Field(default=30, gt=0)
    trials: int = Field(default=12, gt=0)
    duration: float = Field(default=20, gt=0)

    # Normalized mode: scale and start range
    scale_x: float = 0.8
    scale_y: float = 0.8
    start_min_x: float = -0.8
    start_max_x: float = 0.8
    start_min_y: float = -0.8
    start_max_y: float = 0.8

    # Wall avoidance parameters
    wall_threshold: float = 2.0
    wall_nudge: float = 0.3
    wall_nudge_max: float = 30.0

    # Optional per-trial durations from CSV
    durations: Optional[List[float]] = None

    smoothing: int = 1

    start_grid: int = 3
    disabled_cells: Optional[List[str]] = None

    # Gap occlusion
    occlusion_gaps_enabled: bool = False
    occlusion_gaps: Optional[List[dict]] = None
    occlusion_vary_percent: str = "Fixed"
    occlusion_min_percent: float = 10.0
    occlusion_max_percent: float = 75.0
    occlusion_trial_start: int = 1
    occlusion_trial_end: int = 30
    # Obstacle occlusion
    occlusion_obstacles_enabled: bool = False
    occlusion_obstacles: Optional[List[dict]] = None
    occlusion_total_percent: float = 25.0

    reinterpolate: bool = False

    name: Optional[str] = None




class RegenParams(BaseModel):
    """Parameters for regenerating a single trial."""
    trial_index: int
    params: SimulationParams
    start_cell: Optional[List[int]] = None


class FlipParams(BaseModel):
    """Parameters for flipping a trial axis."""
    trial_index: int
    axis: str
    trajectory: dict


# ============================================================
# HELPERS
# ============================================================

def get_trial_duration(p: SimulationParams, trial_index: int) -> int:
    """Get duration in frames for a given trial, falling back to default if needed."""
    if p.durations and trial_index - 1 < len(p.durations) and p.durations[trial_index - 1] > 0:
        return int(p.durations[trial_index - 1] * p.hz)
    return int(p.duration * p.hz)


def run_single_trial(p: SimulationParams, d: int, a, l, start_x=None, start_y=None, trial_num=1):
    half_w = p.arena_width / 2
    half_h = p.arena_height / 2
    grid = p.start_grid
    cell_w = p.arena_width / grid
    cell_h = p.arena_height / grid
    
    for attempt in range(50):
        # Jitter start position on retries
        if attempt > 0 and start_x is not None:
            jitter = (attempt / 50) * half_w * 0.5  # up to 25% of arena
            retry_x = start_x + np.random.uniform(-jitter, jitter)
            retry_y = start_y + np.random.uniform(-jitter, jitter)
            retry_x = max(-half_w * 0.8, min(half_w * 0.8, retry_x))
            retry_y = max(-half_h * 0.8, min(half_h * 0.8, retry_y))
        else:
            retry_x = start_x
            retry_y = start_y

        #print(f"[DEBUG] Start position: ({retry_x:.2f}, {retry_y:.2f})")

        shape_frames = d * 3 if p.reinterpolate else d

        result = run_trial_bounded(
            shape_frames, a, l,
            arena_x=(-half_w, half_w),
            arena_y=(-half_h, half_h),
            display_x=(-p.scale_x, p.scale_x),
            display_y=(-p.scale_y, p.scale_y),
            wall_threshold=p.wall_threshold,
            t_mod_min=p.t_mod_min,
            t_mod_max=p.t_mod_max,
            wall_nudge=p.wall_nudge,
            wall_nudge_max=p.wall_nudge_max,
            smoothing=p.smoothing,
            start_x=retry_x,
            start_y=retry_y,
            balanced_speed=p.balanced_speed,
        )

        if p.reinterpolate:
            shape_x = list(result["x"])
            shape_y = list(result["y"])
            reinterp = reinterpolate_trajectory(
                shape_x, shape_y, l, p.hz,
                t_mod_min=p.t_mod_min, t_mod_max=p.t_mod_max,
                target_frames=d,
                arena_x=(-half_w, half_w),
                arena_y=(-half_h, half_h),
                display_x=(-p.scale_x, p.scale_x),
                display_y=(-p.scale_y, p.scale_y),
                balanced_speed=p.balanced_speed,
                scale_x=p.scale_x, scale_y=p.scale_y,
                speed_min=p.linear_min / p.hz, speed_max=p.linear_max / p.hz,
            )
            if reinterp is not None:
                reinterp["shapeX"] = shape_x
                reinterp["shapeY"] = shape_y
                result = reinterp
        
        # Check bounds
        buffer = 0.01
        if not (min(result["normX"]) > -p.scale_x + buffer and max(result["normX"]) < p.scale_x - buffer and \
                min(result["normY"]) > -p.scale_y + buffer and max(result["normY"]) < p.scale_y - buffer):
            print(f"  Out of bounds on attempt {attempt + 1}, regenerating...")
            continue

        # Check first 25% doesn't enter disabled cells
        if p.disabled_cells and grid > 0:
            quarter = len(result["x"]) // 4
            entered_disabled = False
            for i in range(quarter):
                x = result["x"][i]
                y = result["y"][i]
                col = int((x + half_w) / cell_w)
                row = int((half_h - y) / cell_h)
                col = min(col, grid - 1)
                row = min(row, grid - 1)
                key = f"{row}-{col}"
                if key in p.disabled_cells:
                    entered_disabled = True
                    break
            if entered_disabled:
                print(f"  Entered disabled cell on attempt {attempt + 1}, regenerating...")
                continue
        
        # Apply occlusion
        n_frames = len(result["normX"])
        visible = [True] * n_frames
        
        if p.occlusion_trial_start <= trial_num <= p.occlusion_trial_end:
            progress = 0
            total_trials = p.occlusion_trial_end - p.occlusion_trial_start
            if total_trials > 0:
                progress = (trial_num - p.occlusion_trial_start) / total_trials
            
            # Gap occlusion
            if p.occlusion_gaps_enabled and p.occlusion_gaps:
                placed_gaps = []
                buffer = int(n_frames * 0.05)
                
                gap_indices = list(range(len(p.occlusion_gaps)))
                np.random.shuffle(gap_indices)

                for gap_idx in gap_indices:
                    gap = p.occlusion_gaps[gap_idx]
                    gap_start = gap.get("start", 0.3)
                    gap_size = gap.get("size", 25)
                    randomize = gap.get("randomize", False)
                    direction = gap.get("direction", "both")
                    gap_vary = gap.get("vary", "global")
                    gap_vary_min = gap.get("vary_min", p.occlusion_min_percent)
                    gap_vary_max = gap.get("vary_max", p.occlusion_max_percent)
                    
                    if gap_vary == "global":
                        vary_mode = p.occlusion_vary_percent
                        v_min = p.occlusion_min_percent
                        v_max = p.occlusion_max_percent
                    else:
                        vary_mode = gap_vary
                        v_min = gap_vary_min
                        v_max = gap_vary_max
                    
                    if vary_mode == "Fixed":
                        effective_size = gap_size
                    elif vary_mode == "Random":
                        effective_size = np.random.uniform(v_min, v_max)
                    elif vary_mode == "Gradual":
                        effective_size = v_min + progress * (v_max - v_min)
                    else:
                        effective_size = gap_size
                    
                    hidden_frames = int(n_frames * effective_size / 100)
                    
                    if randomize:
                        min_center = buffer + hidden_frames // 2
                        max_center = max(min_center, n_frames - hidden_frames // 2 - buffer)
                        
                        placed = False
                        for _attempt in range(100):
                            center = np.random.randint(min_center, max(min_center + 1, max_center))
                            candidate = max(0, min(center - hidden_frames // 2, n_frames - hidden_frames))
                            candidate_end = candidate + hidden_frames
                            
                            overlap = False
                            for existing_start, existing_end in placed_gaps:
                                if candidate < existing_end + buffer and candidate_end > existing_start - buffer:
                                    overlap = True
                                    break
                            
                            if not overlap:
                                start_frame = candidate
                                placed = True
                                break
                        
                        if not placed:
                            center = np.random.randint(min_center, max(min_center + 1, max_center))
                            start_frame = max(0, min(center - hidden_frames // 2, n_frames - hidden_frames))
                    else:
                        start_frame = int(n_frames * gap_start)
                    
                    if direction.lower() == "forward":
                        for i in range(start_frame, min(start_frame + hidden_frames, n_frames)):
                            visible[i] = False
                        placed_gaps.append((start_frame, start_frame + hidden_frames))
                    elif direction.lower() == "backward":
                        end_frame = start_frame
                        begin_frame = max(0, end_frame - hidden_frames)
                        for i in range(begin_frame, end_frame):
                            visible[i] = False
                        placed_gaps.append((begin_frame, end_frame))
                    elif direction.lower() == "both":
                        half = hidden_frames // 2
                        begin_frame = max(0, start_frame - half)
                        end_frame = min(n_frames, start_frame + hidden_frames - half)
                        for i in range(begin_frame, end_frame):
                            visible[i] = False
                        placed_gaps.append((begin_frame, end_frame))
            
            # Obstacle occlusion
            if p.occlusion_obstacles_enabled and p.occlusion_obstacles:
                half_w_obs = p.arena_width / 2
                half_h_obs = p.arena_height / 2
                for i in range(n_frames):
                    x = result["normX"][i] * half_w_obs
                    y = result["normY"][i] * half_h_obs
                    for obs in p.occlusion_obstacles:
                        rot = math.radians(obs.get("rotation", 0))
                        dx = x - obs["x"]
                        dy = y - obs["y"]
                        rx = dx * math.cos(rot) + dy * math.sin(rot)
                        ry = -dx * math.sin(rot) + dy * math.cos(rot)
                        if abs(rx) <= obs["width"] / 2 and abs(ry) <= obs["height"] / 2:
                            visible[i] = False
                            break
        
        result["visible"] = visible
        return result

    
    print("Warning: could not generate valid trial after 50 attempts")
    return result

# ============================================================
# ENDPOINTS
# ============================================================

@app.get("/")
def health_check():
    return {"status": "ok", "name": "Pursuit Trajectory Simulator"}


class ReinterpolateParams(BaseModel):
    """Parameters for re-interpolating stored shape paths at a new scale."""
    shapes: dict  # trial_num -> {shapeX, shapeY}
    params: SimulationParams


@app.post("/reinterpolate")
def reinterpolate_all(req: ReinterpolateParams):
    p = req.params
    half_w = p.arena_width / 2
    half_h = p.arena_height / 2

    a, l = build_distributions(
        a_dist=p.a_dist, l_dist=p.l_dist,
        angular_min=p.angular_min, angular_max=p.angular_max,
        linear_min=p.linear_min, linear_max=p.linear_max,
        kappa=p.kappa, peak=p.peak,
        a_shape=p.a_shape, a_scale=p.a_scale,
        l_shape=p.l_shape, l_scale=p.l_scale,
        hz=p.hz, speed_min=p.speed_min, speed_max=p.speed_max,
        speed_peak=p.speed_peak,
    )

    trajectories = {}
    for trial_str, shape in req.shapes.items():
        d = get_trial_duration(p, int(trial_str))
        result = reinterpolate_trajectory(
            shape["shapeX"], shape["shapeY"], l, p.hz,
            t_mod_min=p.t_mod_min, t_mod_max=p.t_mod_max,
            target_frames=d,
            arena_x=(-half_w, half_w),
            arena_y=(-half_h, half_h),
            display_x=(-p.scale_x, p.scale_x),
            display_y=(-p.scale_y, p.scale_y),
            balanced_speed=p.balanced_speed,
            scale_x=p.scale_x, scale_y=p.scale_y,
            speed_min=p.linear_min / p.hz, speed_max=p.linear_max / p.hz,
        )
        if result is not None:
            result["shapeX"] = shape["shapeX"]
            result["shapeY"] = shape["shapeY"]
            trajectories[trial_str] = result

    return {"trajectories": trajectories}


@app.post("/run")
def run_simulation(p: SimulationParams):
    """Run a full simulation and return all trajectories + distribution data."""
    try:
        a, l = build_distributions(
            a_dist=p.a_dist, l_dist=p.l_dist,
            angular_min=p.angular_min, angular_max=p.angular_max,
            linear_min=p.linear_min, linear_max=p.linear_max,
            kappa=p.kappa, peak=p.peak,
            a_shape=p.a_shape, a_scale=p.a_scale,
            l_shape=p.l_shape, l_scale=p.l_scale,
            hz=p.hz, speed_min=p.speed_min, speed_max=p.speed_max,
            speed_peak=p.speed_peak,
        )

        trajectories = {}
        grid = p.start_grid
        all_cells = [(r, c) for r in range(grid) for c in range(grid)
                     if p.disabled_cells is None or f"{r}-{c}" not in p.disabled_cells]
        
        if not all_cells:
            all_cells = [(r, c) for r in range(grid) for c in range(grid)]
        
        # Stratified: shuffle all cells per round, repeat for total trials
        cell_assignments = []
        while len(cell_assignments) < p.trials:
            round_cells = all_cells.copy()
            np.random.shuffle(round_cells)
            cell_assignments.extend(round_cells)
        cell_assignments = cell_assignments[:p.trials]
        
        half_w = p.arena_width / 2
        half_h = p.arena_height / 2
        cell_w = p.arena_width / grid
        cell_h = p.arena_height / grid
        
        for trial in range(1, p.trials + 1):
            d = get_trial_duration(p, trial)
            cell = cell_assignments[trial - 1]

            start_x = -half_w + cell[1] * cell_w + np.random.uniform(0, cell_w)
            start_y = half_h - (cell[0] + 1) * cell_h + np.random.uniform(0, cell_h)

            result = run_single_trial(p, d, a, l, start_x, start_y, trial_num=trial)
            result["startCell"] = [cell[0], cell[1]]
            trajectories[str(trial)] = result

        linear_hist = compute_histogram(l)
        # Scale histogram x-axis from cm/frame back to cm/s for display
        linear_hist["x"] = [v * p.hz for v in linear_hist["x"]]

        return {
            "trajectories": trajectories,
            "angular_hist": compute_histogram(a),
            "linear_hist": linear_hist,
        }
    except Exception as e:
        print(f"[ERROR] {e}")
        import traceback
        traceback.print_exc()
        raise

@app.post("/regenerate")
def regenerate_trial(rp: RegenParams):
    """Regenerate a single trial with the current parameters."""
    p = rp.params
    a, l = build_distributions(
        a_dist=p.a_dist, l_dist=p.l_dist,
        angular_min=p.angular_min, angular_max=p.angular_max,
        linear_min=p.linear_min, linear_max=p.linear_max,
        kappa=p.kappa, peak=p.peak,
        a_shape=p.a_shape, a_scale=p.a_scale,
        l_shape=p.l_shape, l_scale=p.l_scale,
        hz=p.hz, speed_min=p.speed_min, speed_max=p.speed_max,
        speed_peak=p.speed_peak,
    )

    d = get_trial_duration(p, rp.trial_index)
    start_x, start_y = None, None
    if rp.start_cell is not None:
        half_w = p.arena_width / 2
        half_h = p.arena_height / 2
        cell_w = p.arena_width / p.start_grid
        cell_h = p.arena_height / p.start_grid
        row, col = rp.start_cell
        start_x = -half_w + col * cell_w + np.random.uniform(0, cell_w)
        start_y = half_h - (row + 1) * cell_h + np.random.uniform(0, cell_h)

    trajectory = run_single_trial(p, d, a, l, start_x, start_y, trial_num=rp.trial_index)
    if rp.start_cell is not None:
        trajectory["startCell"] = rp.start_cell
    return {"trajectory": trajectory}


@app.post("/flip")
def flip_trial(fp: FlipParams):
    """Flip a trial's trajectory on the specified axis."""
    traj = fp.trajectory
    if fp.axis == "x":
        traj["x"] = [-v for v in traj["x"]]
        traj["normX"] = [-v for v in traj["normX"]]
    elif fp.axis == "y":
        traj["y"] = [-v for v in traj["y"]]
        traj["normY"] = [-v for v in traj["normY"]]
    return {"trajectory": traj}


@app.post("/export")
def export_csv(p: SimulationParams):
    """Run a simulation and return results as a downloadable CSV."""
    a, l = build_distributions(
        a_dist=p.a_dist, l_dist=p.l_dist,
        angular_min=p.angular_min, angular_max=p.angular_max,
        linear_min=p.linear_min, linear_max=p.linear_max,
        kappa=p.kappa, peak=p.peak,
        a_shape=p.a_shape, a_scale=p.a_scale,
        l_shape=p.l_shape, l_scale=p.l_scale,
    )

    rows = []
    for trial in range(1, p.trials + 1):
        d = get_trial_duration(p, trial)
        result = run_single_trial(p, d, a, l, trial_num=trial)
        duration_s = len(result["x"]) / p.hz

        for i in range(len(result["x"])):
            visible = result.get("visible", [True] * len(result["x"]))[i]
            vel = 0
            if i > 0:
                dx = result["x"][i] - result["x"][i-1]
                dy = result["y"][i] - result["y"][i-1]
                vel = math.sqrt(dx*dx + dy*dy) * p.hz
            
            rows.append({
                "X": result["x"][i] if visible else float("nan"),
                "Y": result["y"][i] if visible else float("nan"),
                "Normalized X": result["normX"][i] if visible else float("nan"),
                "Normalized Y": result["normY"][i] if visible else float("nan"),
                "Trial": trial,
                "HZ": p.hz,
                "Duration": duration_s,
                "Cue Type": 0,
                "Trial Type": 0,
                "Velocity": vel,
            })

    df = pd.DataFrame(rows)
    csv_content = df.to_csv(index=False)

    # Nothing is saved on disk: the browser downloads the CSV.
    name = p.name or "trajectories"

    return StreamingResponse(
        iter([csv_content]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={name}.csv"},
    )


@app.post("/upload-durations")
async def upload_durations(file: UploadFile = File(...)):
    """Upload a CSV file containing per-trial durations."""
    contents = await file.read()
    df = pd.read_csv(io.StringIO(contents.decode("utf-8")), header=0)
    durations = df.iloc[:, 0].tolist()
    return {"durations": durations, "count": len(durations)}

@app.post("/smooth")
def smooth_trial(data: dict):
    """Apply heading-based smoothing to a trial."""
    smoothed = smooth_trajectory(data["trajectory"], data["smoothing"])
    return {"trajectory": smoothed}

@app.post("/apply-occlusion")
def apply_occlusion(data: dict):
    """Apply gap and/or obstacle occlusion to an existing trajectory."""
    traj = data["trajectory"]
    n_frames = len(traj["normX"])
    visible = [True] * n_frames
    
    trial_num = data.get("trial_num", 1)
    trial_start = data.get("trial_start", 1)
    trial_end = data.get("trial_end", 30)
    global_vary = data.get("vary_percent", "Fixed")
    global_min = data.get("min_percent", 10)
    global_max = data.get("max_percent", 75)
    
    # Skip if outside trial range
    if trial_num < trial_start or trial_num > trial_end:
        traj["visible"] = visible
        return {"trajectory": traj}
    
    progress = 0
    total_trials = trial_end - trial_start
    if total_trials > 0:
        progress = (trial_num - trial_start) / total_trials
    
    # Apply gap occlusion
    gaps = data.get("occlusion_gaps", [])
    if data.get("gaps_enabled", False) and gaps:
        placed_gaps = []
        buffer = int(n_frames * 0.05)

        # Shuffle gap processing order for more even distribution
        gap_indices = list(range(len(gaps)))
        np.random.shuffle(gap_indices)
        
        for gap_idx in gap_indices:
            gap = gaps[gap_idx]
            gap_start = gap.get("start", 0.3)
            gap_size = gap.get("size", 25)
            randomize = gap.get("randomize", False)
            direction = gap.get("direction", "both")
            gap_vary = gap.get("vary", "global")
            gap_vary_min = gap.get("vary_min", global_min)
            gap_vary_max = gap.get("vary_max", global_max)
            
            if gap_vary == "global":
                vary_mode = global_vary
                v_min = global_min
                v_max = global_max
            else:
                vary_mode = gap_vary
                v_min = gap_vary_min
                v_max = gap_vary_max
            
            if vary_mode == "Fixed":
                effective_size = gap_size
            elif vary_mode == "Random":
                effective_size = np.random.uniform(v_min, v_max)
            elif vary_mode == "Gradual":
                effective_size = v_min + progress * (v_max - v_min)
            else:
                effective_size = gap_size
            
            hidden_frames = int(n_frames * effective_size / 100)
            
            if randomize:
                min_start = buffer
                max_start = max(min_start, n_frames - hidden_frames - buffer)
                
                placed = False
                for _attempt in range(100):
                    candidate = np.random.randint(min_start, max(min_start + 1, max_start))
                    candidate_end = candidate + hidden_frames
                    
                    overlap = False
                    for existing_start, existing_end in placed_gaps:
                        if candidate < existing_end + buffer and candidate_end > existing_start - buffer:
                            overlap = True
                            break
                    
                    if not overlap:
                        start_frame = candidate
                        placed = True
                        break
                
                if not placed:
                    center = np.random.randint(min_center, max(min_center + 1, max_center))
                    start_frame = max(0, min(center - hidden_frames // 2, n_frames - hidden_frames))
            else:
                start_frame = int(n_frames * gap_start)
            
            if direction.lower() == "forward":
                for i in range(start_frame, min(start_frame + hidden_frames, n_frames)):
                    visible[i] = False
                placed_gaps.append((start_frame, start_frame + hidden_frames))
            elif direction.lower() == "backward":
                end_frame = start_frame
                begin_frame = max(0, end_frame - hidden_frames)
                for i in range(begin_frame, end_frame):
                    visible[i] = False
                placed_gaps.append((begin_frame, end_frame))
            elif direction.lower() == "both":
                half = hidden_frames // 2
                begin_frame = max(0, start_frame - half)
                end_frame = min(n_frames, start_frame + hidden_frames - half)
                for i in range(begin_frame, end_frame):
                    visible[i] = False
                placed_gaps.append((begin_frame, end_frame))
    
    # Apply obstacle occlusion
    if data.get("obstacles_enabled", False) and data.get("occlusion_obstacles"):
        half_w = data.get("arena_width", 60) / 2
        half_h = data.get("arena_height", 60) / 2
        for i in range(n_frames):
            x = traj["normX"][i] * half_w
            y = traj["normY"][i] * half_h
            for obs in data["occlusion_obstacles"]:
                rot = math.radians(obs.get("rotation", 0))
                dx = x - obs["x"]
                dy = y - obs["y"]
                rx = dx * math.cos(rot) + dy * math.sin(rot)
                ry = -dx * math.sin(rot) + dy * math.cos(rot)
                if abs(rx) <= obs["width"] / 2 and abs(ry) <= obs["height"] / 2:
                    visible[i] = False
                    break
    
    traj["visible"] = visible
    return {"trajectory": traj}

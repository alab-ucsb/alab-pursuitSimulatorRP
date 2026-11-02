"""
Pursuit Trajectory Simulator — Core Simulation Engine
======================================================
Generates pursuit trajectories using configurable angular and linear
velocity distributions. This module is framework-agnostic and can be
used standalone, in notebooks, or behind an API.

Distributions supported:
    - Gaussian (wrapped normal)
    - Wrapped (Von Mises-based, circular analog of normal)
    - Skewed (Gamma-based)
    - Log-Normal (naturally positive, right-skewed)

Trajectory modes:
    - Normalized (original): free movement, post-hoc normalization
    - Bounded (wall avoidance): real-time boundary enforcement with
      angular repulsion, preserving true linear velocity

Example usage:
    >>> from simulation import build_distributions, run_trial, run_trial_bounded
    >>> a, l = build_distributions("Wrapped", "LogNormal")
    >>> trial = run_trial_bounded(d=600, a=a, l=l,
    ...     arena_x=(-0.8, 0.8), arena_y=(-0.8, 0.8))
    >>> print(len(trial["normX"]))  # 600 frames
"""

import numpy as np
import pandas as pd
import math
from scipy.stats import vonmises


# ============================================================
# DISTRIBUTION GENERATORS
# ============================================================

def gen_angular(kappa, angular_min, angular_max, angular_peak_shift, size=100000):
    """
    Generate angular velocity distribution using Von Mises distribution.

    The Von Mises distribution is the circular analog of the normal
    distribution, making it natural for angular/directional data.
    Samples are rescaled and wrapped to fit within [angular_min, angular_max].

    Args:
        kappa: Concentration parameter (higher = more peaked)
        angular_min: Minimum angle in degrees
        angular_max: Maximum angle in degrees
        angular_peak_shift: Peak shift in radians
        size: Number of samples to generate

    Returns:
        numpy array of angular values in degrees
    """
    # Convert deg to rad
    angular_min_rad = np.radians(angular_min)
    angular_max_rad = np.radians(angular_max)

    # Generate samples from Von Mises distribution
    angular_samples = vonmises.rvs(kappa, size=size)

    # Calculate the range width
    angular_range_width = angular_max_rad - angular_min_rad

    # Rescale Von Mises samples to fit within [0, range_width]
    samples_rescaled = (angular_samples + np.pi) * (angular_range_width / (2 * np.pi))

    # Shift samples to the desired range [angular_min, angular_max]
    samples_shifted = samples_rescaled - angular_peak_shift + angular_min_rad

    # Wrap around to fit within [angular_min, angular_max]
    angular_dist = (samples_shifted - angular_min_rad) % angular_range_width + angular_min_rad

    return np.degrees(angular_dist)


def gen_linear(mu, sigma, linear_min, linear_max, size=100000):
    """
    Generate linear velocity distribution using a wrapped Gaussian.

    Samples from a normal distribution are wrapped (via modulo) to fit
    within [linear_min, linear_max], creating a periodic distribution.

    Args:
        mu: Mean of the Gaussian
        sigma: Standard deviation of the Gaussian
        linear_min: Minimum linear value
        linear_max: Maximum linear value
        size: Number of samples to generate

    Returns:
        numpy array of linear velocity values
    """
    # Generate samples from a Gaussian distribution
    linear_samples = np.random.normal(mu, sigma, size)

    # Calculate the range width
    linear_range_width = linear_max - linear_min

    # Wrap samples to fit within [linear_min, linear_max]
    linear_dist = (linear_samples - linear_min) % linear_range_width + linear_min

    return linear_dist


def gen_gamma(shape, scale, peak, min_x, max_x, size=100000):
    """
    Generate a skewed distribution using the Gamma distribution.

    The Gamma distribution is shifted so its peak aligns with the
    desired peak position, then filtered to [min_x, max_x].

    Args:
        shape: Shape parameter (alpha) of the Gamma distribution
        scale: Scale parameter (beta) of the Gamma distribution
        peak: Desired peak position
        min_x: Minimum value (samples outside are discarded)
        max_x: Maximum value (samples outside are discarded)
        size: Number of samples to generate

    Returns:
        numpy array of values within [min_x, max_x]
    """
    # Generate samples from a Gamma distribution
    gamma_samples = np.random.gamma(shape, scale, size)

    # Transform samples to adjust peak position
    mean_sample = shape * scale  # Gamma distribution mean
    shift = peak - mean_sample  # Calculate the shift required
    samples_shifted = gamma_samples + shift

    # Filter out samples that are outside the range [min_x, max_x]
    gamma_dist = samples_shifted[(samples_shifted >= min_x) & (samples_shifted <= max_x)]

    return gamma_dist

def smooth_trajectory(trajectory, smoothing):
    """Smooth a trajectory's headings while preserving speed."""
    if smoothing <= 1:
        return trajectory
    
    col_x = trajectory["x"]
    col_y = trajectory["y"]
    norm_x = trajectory["normX"]
    norm_y = trajectory["normY"]
    half = smoothing // 2
    
    # Smooth normalized coordinates via heading
    headings = []
    for i in range(1, len(norm_x)):
        h = math.atan2(norm_y[i] - norm_y[i-1], norm_x[i] - norm_x[i-1])
        headings.append(h)
    
    smooth_headings = []
    for i in range(len(headings)):
        start = max(0, i - half)
        end = min(len(headings), i + half + 1)
        avg_sin = sum(math.sin(headings[j]) for j in range(start, end)) / (end - start)
        avg_cos = sum(math.cos(headings[j]) for j in range(start, end)) / (end - start)
        smooth_headings.append(math.atan2(avg_sin, avg_cos))
    
    new_nx, new_ny = [norm_x[0]], [norm_y[0]]
    for i in range(len(smooth_headings)):
        dx = norm_x[i+1] - norm_x[i]
        dy = norm_y[i+1] - norm_y[i]
        speed = math.sqrt(dx*dx + dy*dy)
        new_nx.append(new_nx[-1] + math.cos(smooth_headings[i]) * speed)
        new_ny.append(new_ny[-1] + math.sin(smooth_headings[i]) * speed)
    
    return {"x": col_x, "y": col_y, "normX": new_nx, "normY": new_ny}

# ============================================================
# TRAJECTORY GENERATION
# ============================================================

def run_trial_bounded(d, a, l, arena_x, arena_y, display_x, display_y,
                      wall_threshold=5.0, t_mod_min=15, t_mod_max=20,
                      start_margin=0.2, wall_nudge=0.02, wall_nudge_max=30,
                      smoothing=1, start_x=None, start_y=None, balanced_speed=True):
    
    if d <= 0:
        raise ValueError(f"Duration must be positive, got {d} frames")
    
    x_min, x_max = arena_x
    y_min, y_max = arena_y
    arena_radius = min(x_max - x_min, y_max - y_min) / 2
    
    if start_x is not None and start_y is not None:
        x_pos = start_x
        y_pos = start_y
    else:
        x_pos = np.random.uniform(x_min * (1 - start_margin), x_max * (1 - start_margin))
        y_pos = np.random.uniform(y_min * (1 - start_margin), y_max * (1 - start_margin))
    
    col_x, col_y = [], []
    heading = np.random.uniform(0, 360)
    linear_velocity = 0.0
    delta_x, delta_y = 0.0, 0.0
    t_mod = t_mod_min
    
    # Pre-generate balanced speeds if enabled
    if balanced_speed:
        avg_interval = (t_mod_min + t_mod_max) / 2
        n_resamples = int(d / avg_interval) + 2
        balanced_speeds = _generate_balanced_speeds(l, n_resamples)
        speed_idx = 0
    
    for t in range(d):
        if t == 0:
            pass
        elif t == 1 or t % t_mod == 0:
            heading += np.random.choice(a)
            if balanced_speed and speed_idx < len(balanced_speeds):
                linear_velocity = balanced_speeds[speed_idx]
                speed_idx += 1
            else:
                linear_velocity = np.random.choice(l)
            t_mod = t + np.random.randint(t_mod_min, t_mod_max)
        
        # Exponential center pull — weak in middle, strong near edges
        dist_from_center = math.sqrt(x_pos**2 + y_pos**2)
        ratio = dist_from_center / arena_radius
        if ratio > 0.3:
            center_angle = math.degrees(math.atan2(-y_pos, -x_pos))
            diff = ((center_angle - heading) + 180) % 360 - 180
            pull = diff * wall_nudge * (ratio ** 3)
            pull = np.clip(pull, -wall_nudge_max, wall_nudge_max)
            heading += pull
        
        delta_x = math.cos(math.radians(heading)) * linear_velocity
        delta_y = math.sin(math.radians(heading)) * linear_velocity

        x_pos += delta_x
        y_pos += delta_y

        # Hard clamp as absolute safety net
        x_pos = max(x_min, min(x_max, x_pos))
        y_pos = max(y_min, min(y_max, y_pos))

        col_x.append(x_pos)
        col_y.append(y_pos)
    
    # Optional post-hoc heading smoothing
    if smoothing > 1:
        # Extract headings from positions
        headings = []
        for i in range(1, len(col_x)):
            h = math.atan2(col_y[i] - col_y[i-1], col_x[i] - col_x[i-1])
            headings.append(h)
        
        # Smooth headings with moving average
        smooth_headings = []
        half = smoothing // 2
        for i in range(len(headings)):
            start = max(0, i - half)
            end = min(len(headings), i + half + 1)
            # Average angles properly using sin/cos
            avg_sin = sum(math.sin(headings[j]) for j in range(start, end)) / (end - start)
            avg_cos = sum(math.cos(headings[j]) for j in range(start, end)) / (end - start)
            smooth_headings.append(math.atan2(avg_sin, avg_cos))
        
        # Rebuild positions from smoothed headings with original speeds
        new_x, new_y = [col_x[0]], [col_y[0]]
        for i in range(len(smooth_headings)):
            dx = col_x[i+1] - col_x[i]
            dy = col_y[i+1] - col_y[i]
            speed = math.sqrt(dx*dx + dy*dy)
            new_x.append(new_x[-1] + math.cos(smooth_headings[i]) * speed)
            new_y.append(new_y[-1] + math.sin(smooth_headings[i]) * speed)
        col_x = new_x
        col_y = new_y

    # Normalize
    dx_min, dx_max = display_x
    dy_min, dy_max = display_y
    norm_x = [dx_min + (x - x_min) / (x_max - x_min) * (dx_max - dx_min) for x in col_x]
    norm_y = [dy_min + (y - y_min) / (y_max - y_min) * (dy_max - dy_min) for y in col_y]
    return {"x": col_x, "y": col_y, "normX": norm_x, "normY": norm_y, "visible": [True] * len(col_x)}

def run_trial_periodic(d, a, l, arena_x, arena_y, display_x, display_y,
                       t_mod_min=15, t_mod_max=20, start_margin=0.2, balanced_speed=True):
    """
    Periodic mode: dot wraps to opposite wall when crossing a boundary.
    No wall avoidance — the dot teleports to the other side.
    """
    if d <= 0:
        raise ValueError(f"Duration must be positive, got {d} frames")
    
    x_min, x_max = arena_x
    y_min, y_max = arena_y
    x_range = x_max - x_min
    y_range = y_max - y_min
    
    x_pos = np.random.uniform(x_min * (1 - start_margin), x_max * (1 - start_margin))
    y_pos = np.random.uniform(y_min * (1 - start_margin), y_max * (1 - start_margin))
    
    col_x, col_y = [], []
    heading = np.random.uniform(0, 360)
    linear_velocity = 0.0
    delta_x, delta_y = 0.0, 0.0
    t_mod = t_mod_min
    
    if balanced_speed:
        avg_interval = (t_mod_min + t_mod_max) / 2
        n_resamples = int(d / avg_interval) + 2
        balanced_speeds = _generate_balanced_speeds(l, n_resamples)
        speed_idx = 0
    
    for t in range(d):
        if t == 0:
            pass
        elif t == 1 or t % t_mod == 0:
            heading += np.random.choice(a)
            if balanced_speed and speed_idx < len(balanced_speeds):
                linear_velocity = balanced_speeds[speed_idx]
                speed_idx += 1
            else:
                linear_velocity = np.random.choice(l)
            delta_x = math.cos(math.radians(heading)) * linear_velocity
            delta_y = math.sin(math.radians(heading)) * linear_velocity
            t_mod = t + np.random.randint(t_mod_min, t_mod_max)
        
        x_pos += delta_x
        y_pos += delta_y
        
        # Wrap around
        if x_pos > x_max:
            x_pos = x_min + (x_pos - x_max)
        elif x_pos < x_min:
            x_pos = x_max - (x_min - x_pos)
        if y_pos > y_max:
            y_pos = y_min + (y_pos - y_max)
        elif y_pos < y_min:
            y_pos = y_max - (y_min - y_pos)
        
        col_x.append(x_pos)
        col_y.append(y_pos)
    
    # Normalize
    dx_min, dx_max = display_x
    dy_min, dy_max = display_y
    norm_x = [dx_min + (x - x_min) / (x_max - x_min) * (dx_max - dx_min) for x in col_x]
    norm_y = [dy_min + (y - y_min) / (y_max - y_min) * (dy_max - dy_min) for y in col_y]
    return {"x": col_x, "y": col_y, "normX": norm_x, "normY": norm_y, "visible": [True] * len(col_x)}

def run_trial_ricochet(d, a, l, arena_x, arena_y, display_x, display_y,
                       t_mod_min=15, t_mod_max=20, start_margin=0.2, balanced_speed=True):
    """
    Ricochet mode: dot reflects off walls at the angle of incidence.
    Linear velocity is still freely sampled, not affected by bouncing.
    """
    if d <= 0:
        raise ValueError(f"Duration must be positive, got {d} frames")
    
    x_min, x_max = arena_x
    y_min, y_max = arena_y
    
    x_pos = np.random.uniform(x_min * (1 - start_margin), x_max * (1 - start_margin))
    y_pos = np.random.uniform(y_min * (1 - start_margin), y_max * (1 - start_margin))
    
    col_x, col_y = [], []
    heading = np.random.uniform(0, 360)
    linear_velocity = 0.0
    delta_x, delta_y = 0.0, 0.0
    t_mod = t_mod_min
    
    if balanced_speed:
        avg_interval = (t_mod_min + t_mod_max) / 2
        n_resamples = int(d / avg_interval) + 2
        balanced_speeds = _generate_balanced_speeds(l, n_resamples)
        speed_idx = 0
    
    for t in range(d):
        if t == 0:
            pass
        elif t == 1 or t % t_mod == 0:
            heading += np.random.choice(a)
            if balanced_speed and speed_idx < len(balanced_speeds):
                linear_velocity = balanced_speeds[speed_idx]
                speed_idx += 1
            else:
                linear_velocity = np.random.choice(l)
            delta_x = math.cos(math.radians(heading)) * linear_velocity
            delta_y = math.sin(math.radians(heading)) * linear_velocity
            t_mod = t + np.random.randint(t_mod_min, t_mod_max)
        
        new_x = x_pos + delta_x
        new_y = y_pos + delta_y
        
        # Reflect off walls
        if new_x > x_max or new_x < x_min:
            delta_x = -delta_x
            heading = 180 - heading  # Reflect horizontal component
            new_x = x_pos + delta_x
        if new_y > y_max or new_y < y_min:
            delta_y = -delta_y
            heading = -heading  # Reflect vertical component
            new_y = y_pos + delta_y
        
        # Safety clamp
        new_x = max(x_min, min(x_max, new_x))
        new_y = max(y_min, min(y_max, new_y))
        
        x_pos = new_x
        y_pos = new_y
        col_x.append(x_pos)
        col_y.append(y_pos)
    
    # Normalize
    dx_min, dx_max = display_x
    dy_min, dy_max = display_y
    norm_x = [dx_min + (x - x_min) / (x_max - x_min) * (dx_max - dx_min) for x in col_x]
    norm_y = [dy_min + (y - y_min) / (y_max - y_min) * (dy_max - dy_min) for y in col_y]
    return {"x": col_x, "y": col_y, "normX": norm_x, "normY": norm_y, "visible": [True] * len(col_x)}

# ============================================================
# HELPERS
# ============================================================

def build_distributions(
    mode="Bounded",
    a_dist="Wrapped",
    l_dist="LogNormal",
    angular_min=0,
    angular_max=60,
    linear_min=0,
    linear_max=100,
    kappa=1.0,
    peak=1,
    a_shape=3.0,
    a_scale=1.0,
    l_shape=5.0,
    l_scale=3.0,
    hz=30,
    speed_min=10.0,
    speed_max=35.0,
    speed_peak=25.0,
):
    """
    Build angular and linear distributions from parameters.

    This is the glue between the parameter space and the raw
    distribution generators. Handles the distribution-type routing
    and the derived values (sigma, peak_shift, etc.).

    Returns:
        tuple of (angular_dist, linear_dist) as numpy arrays
    """
    angular_range = angular_max + angular_min
    linear_range = linear_max + linear_min
    sigma = (linear_max - linear_min) * 0.215

    # Angular distribution
    if a_dist == "Gaussian":
        a = gen_angular(kappa, angular_min, angular_max, 0)
    elif a_dist == "Wrapped":
        angular_peak_shift = angular_max - (angular_range / 2)
        a = gen_angular(kappa, angular_min, angular_max, np.radians(angular_peak_shift))
    elif a_dist == "Skewed":
        a = gen_gamma(a_shape, a_scale, peak, angular_min, angular_max)
    else:
        raise ValueError(f"Unknown angular distribution: {a_dist}")

    # Linear distribution (all in cm/frame)
    frame_min = linear_min / hz
    frame_max = linear_max / hz
    frame_range = frame_max + frame_min
    frame_sigma = (frame_max - frame_min) * 0.215
    if l_dist == "Gaussian":
        l = gen_linear(frame_range / 2, frame_sigma, frame_min, frame_max)
    elif l_dist == "Wrapped":
        l = gen_linear(frame_max, frame_sigma, frame_min, frame_max)
    elif l_dist == "Skewed":
        frame_peak = peak / hz
        gamma_scale = frame_peak / max(l_shape - 1, 0.1)
        l = gen_gamma(l_shape, gamma_scale, frame_peak, frame_min, frame_max)

    return a, l


def compute_histogram(data, bins=80):
    """Compute histogram data for distribution visualization."""
    hist, edges = np.histogram(data, bins=bins, density=True)
    centers = ((edges[:-1] + edges[1:]) / 2).tolist()
    densities = hist.tolist()
    return {"x": centers, "y": densities}

    # Add this helper near the top of simulation.py, after the imports:

def _generate_balanced_speeds(l, n_resamples):
    """Generate evenly-distributed speeds across the range with jitter.
    Like Spotify's balanced shuffle — ensures full range coverage."""
    speed_min = float(np.min(l))
    speed_max = float(np.max(l))
    if n_resamples <= 1:
        return [np.random.uniform(speed_min, speed_max)]
    bins = np.linspace(speed_min, speed_max, n_resamples + 1)
    speeds = [np.random.uniform(bins[i], bins[i + 1]) for i in range(n_resamples)]
    np.random.shuffle(speeds)
    return speeds


def reinterpolate_trajectory(path_x, path_y, l, hz, t_mod_min, t_mod_max,
                              target_frames, arena_x, arena_y, display_x, display_y,
                              balanced_speed=True, scale_x=0.8, scale_y=0.8,
                              speed_min=None, speed_max=None):
    """
    Re-walk an existing path at speeds sampled from the linear distribution.
    Scales the path to display space first so that velocities measured in
    display coordinates match the distribution, then un-scales the result
    back to arena cm.
    """
    scaled_x = [x * scale_x for x in path_x]
    scaled_y = [y * scale_y for y in path_y]

    cum_dist = [0.0]
    for i in range(1, len(scaled_x)):
        dx = scaled_x[i] - scaled_x[i-1]
        dy = scaled_y[i] - scaled_y[i-1]
        cum_dist.append(cum_dist[-1] + math.sqrt(dx*dx + dy*dy))

    total_dist = cum_dist[-1]
    if total_dist == 0:
        return None

    cum_dist_arr = np.array(cum_dist)

    if balanced_speed:
        avg_interval = (t_mod_min + t_mod_max) / 2
        n_resamples = int(target_frames / avg_interval) + 2
        balanced_speeds = _generate_balanced_speeds(l, n_resamples)
        speed_idx = 0

    col_x, col_y = [], []
    current_dist = 0.0
    speed = 0.0
    t_mod = t_mod_min

    for frame in range(target_frames):
        if frame == 0:
            col_x.append(path_x[0])
            col_y.append(path_y[0])
            continue

        if frame == 1 or frame % t_mod == 0:
            if balanced_speed and speed_idx < len(balanced_speeds):
                speed = balanced_speeds[speed_idx]
                speed_idx += 1
            else:
                speed = np.random.choice(l)
            if speed_min is not None:
                speed = max(speed, speed_min)
            if speed_max is not None:
                speed = min(speed, speed_max)
            t_mod = frame + np.random.randint(t_mod_min, t_mod_max)

        current_dist += speed

        if current_dist >= total_dist:
            col_x.append(path_x[-1])
            col_y.append(path_y[-1])
            remaining = target_frames - frame - 1
            col_x.extend([path_x[-1]] * remaining)
            col_y.extend([path_y[-1]] * remaining)
            break

        j = int(np.searchsorted(cum_dist_arr, current_dist, side='right')) - 1
        j = max(0, min(j, len(cum_dist) - 2))

        seg_start = cum_dist[j]
        seg_len = cum_dist[j + 1] - seg_start

        if seg_len > 0:
            t = (current_dist - seg_start) / seg_len
            x = scaled_x[j] + t * (scaled_x[j+1] - scaled_x[j])
            y = scaled_y[j] + t * (scaled_y[j+1] - scaled_y[j])
        else:
            x = scaled_x[j]
            y = scaled_y[j]

        col_x.append(x / scale_x)
        col_y.append(y / scale_y)

    x_min, x_max = arena_x
    y_min, y_max = arena_y
    dx_min, dx_max = display_x
    dy_min, dy_max = display_y
    norm_x = [dx_min + (x - x_min) / (x_max - x_min) * (dx_max - dx_min) for x in col_x]
    norm_y = [dy_min + (y - y_min) / (y_max - y_min) * (dy_max - dy_min) for y in col_y]

    return {"x": col_x, "y": col_y, "normX": norm_x, "normY": norm_y, "visible": [True] * len(col_x)}
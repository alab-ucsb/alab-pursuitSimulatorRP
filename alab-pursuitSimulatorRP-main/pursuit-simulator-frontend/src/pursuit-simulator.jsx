import { useState, useCallback, useRef, useEffect } from "react";
import { API, desktop, saveBlobAs } from "./api";
import DataFolderControl from "./DataFolderControl";

// ============================================================
// API CALLS
// ============================================================

async function apiRun(params) {
  const res = await fetch(`${API}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`Server error: ${res.status}`);
  return res.json();
}

async function apiRegenerate(trialIndex, params, startCell) {
  const body = { trial_index: trialIndex, params };
  if (startCell) body.start_cell = startCell;
  const res = await fetch(`${API}/regenerate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Server error: ${res.status}`);
  return res.json();
}

async function apiFlip(trialIndex, axis, trajectory) {
  const res = await fetch(`${API}/flip`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trial_index: trialIndex, axis, trajectory }),
  });
  if (!res.ok) throw new Error(`Server error: ${res.status}`);
  return res.json();
}

async function apiUploadDurations(file) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API}/upload-durations`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error(`Server error: ${res.status}`);
  return res.json();
}

async function apiExport(params) {
  const res = await fetch(`${API}/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`Server error: ${res.status}`);
  const blob = await res.blob();
  await saveBlobAs(blob, `${params.name || "trajectories_" + new Date().toISOString().slice(0, 10)}.csv`);
}

async function apiSmooth(trialIndex, trajectory, smoothing) {
  const res = await fetch(`${API}/smooth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trajectory, smoothing }),
  });
  if (!res.ok) throw new Error(`Server error: ${res.status}`);
  return res.json();
}

// ============================================================
// MAIN APP
// ============================================================

export default function PursuitSimulator() {
  const [params, setParams] = useState({
    mode: "Bounded",
    a_dist: "Wrapped", l_dist: "Skewed",
    angular_min: -30, angular_max: 60,
    linear_min: 10, linear_max: 35,
    kappa: 1.0, peak: 30,
    a_shape: 3.0, a_scale: 1.0,
    l_shape: 20.0, l_scale: 3.0,
    hz: 30, trials: 30, duration: 11,
    scale_x: 0.88, scale_y: 0.88,
    wall_threshold: 1,
    durations: null,
    arena_width: 60, 
    arena_height: 60,
    t_mod_min: 15, t_mod_max: 20,
    wall_nudge: 0.06, wall_nudge_max: 30,
    smoothing: 9,
    balanced_speed: true,
    reinterpolate: true,
    start_grid: 3,
    disabled_cells: null,
    occlusion_gaps_enabled: false,
    occlusion_gaps: [],
    occlusion_vary_percent: "Fixed",
    occlusion_min_percent: 10,
    occlusion_max_percent: 75,
    occlusion_trial_start: 1,
    occlusion_trial_end: 30,
    occlusion_obstacles_enabled: false,
    occlusion_obstacles: null,
    occlusion_total_percent: 25,
  });

  const [trajectories, setTrajectories] = useState({});
  const [angularHist, setAngularHist] = useState({ x: [], y: [] });
  const [linearHist, setLinearHist] = useState({ x: [], y: [] });
  const [currentTrial, setCurrentTrial] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackFrame, setPlaybackFrame] = useState(-1);
  const [editorSmoothing, setEditorSmoothing] = useState(5);
  const [selectedObstacle, setSelectedObstacle] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [gridEditing, setGridEditing] = useState(false);
  const smoothTrial = async () => {
    if (!currentData) return;
    try {
      if (!preSmoothData[currentTrial]) {
        setPreSmoothData(prev => ({ ...prev, [currentTrial]: currentData }));
      }
      const data = await apiSmooth(currentTrial, currentData, editorSmoothing);
      setTrajectories(prev => ({ ...prev, [String(currentTrial)]: data.trajectory }));
    } catch (e) { setError(e.message); }
  };

  const undoSmooth = () => {
    if (preSmoothData[currentTrial]) {
      setTrajectories(prev => ({ ...prev, [String(currentTrial)]: preSmoothData[currentTrial] }));
      setPreSmoothData(prev => {
        const next = { ...prev };
        delete next[currentTrial];
        return next;
      });
    }
  };
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("trajectory");
  const [randomizedName, setRandomizedName] = useState("");
  const [serverUp, setServerUp] = useState(null);
  const animRef = useRef(null);
  const coordScrollRef = useRef(null);

  const trialCount = Object.keys(trajectories).length;
  const currentData = trajectories[String(currentTrial)];
  const [preSmoothData, setPreSmoothData] = useState({});
  const [paramTab, setParamTab] = useState("simulation");
  const [disabledCells, setDisabledCells] = useState(["2-1"]);

  const [obstacles, setObstacles] = useState([]);

  const [coordTab, setCoordTab] = useState("raw");

  const [trialDurations, setTrialDurations] = useState({});

  const updateTrialDuration = (trial, value) => {
    const newDurations = { ...trialDurations, [trial]: value };
    setTrialDurations(newDurations);
    // Convert to array for the API
    const durArray = [];
    for (let i = 1; i <= params.trials; i++) {
      durArray.push(newDurations[i] || params.duration);
    }
    updateParam("durations", durArray);
  };

  const updateParam = useCallback((key, val) => {
    setParams(prev => ({ ...prev, [key]: val }));
  }, []);

  useEffect(() => {
    updateParam("disabled_cells", disabledCells.length > 0 ? disabledCells : null);
  }, [disabledCells]);

  // Check server on mount
  useEffect(() => {
    fetch(`${API}/`)
      .then(r => r.ok ? setServerUp(true) : setServerUp(false))
      .catch(() => setServerUp(false));
  }, []);

  useEffect(() => {
    if (playbackFrame >= 0 && coordScrollRef.current) {
      const row = coordScrollRef.current.children[playbackFrame];
      if (row) {
        row.scrollIntoView({ block: "nearest" });
      }
    }
  }, [playbackFrame]);

  useEffect(() => {
    updateParam("occlusion_obstacles", obstacles.length > 0 ? obstacles : null);
  }, [obstacles]);

  useEffect(() => {
    if (!params.reinterpolate) return;
    const shapes = {};
    for (const [k, v] of Object.entries(trajectories)) {
      if (v.shapeX && v.shapeY) shapes[k] = { shapeX: v.shapeX, shapeY: v.shapeY };
    }
    if (Object.keys(shapes).length === 0) return;
    (async () => {
      try {
        const res = await fetch(`${API}/reinterpolate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shapes, params }),
        });
        if (!res.ok) return;
        const data = await res.json();
        setTrajectories(prev => ({ ...prev, ...data.trajectories }));
      } catch {}
    })();
  }, [params.scale_x, params.scale_y]);

  useEffect(() => {
    const handleKey = (e) => {
      if (selectedObstacle === null) return;
      const step = 1;  // 1cm per press
      const rotStep = 5;  // 5° per press
      
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (e.shiftKey) updateObstacle(selectedObstacle, "rotation", obstacles[selectedObstacle].rotation + rotStep);
        else updateObstacle(selectedObstacle, "x", obstacles[selectedObstacle].x - step);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (e.shiftKey) updateObstacle(selectedObstacle, "rotation", obstacles[selectedObstacle].rotation - rotStep);
        else updateObstacle(selectedObstacle, "x", obstacles[selectedObstacle].x + step);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (e.shiftKey) {
          // Flip vertical: negate height effect by rotating 180 if not already
          updateObstacle(selectedObstacle, "y", obstacles[selectedObstacle].y + step);
        }
        else updateObstacle(selectedObstacle, "y", obstacles[selectedObstacle].y + step);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        updateObstacle(selectedObstacle, "y", obstacles[selectedObstacle].y - step);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeObstacle(selectedObstacle);
        setSelectedObstacle(null);
      } else if (e.key === "Escape") {
        setSelectedObstacle(null);
      }
    };
    
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [selectedObstacle, obstacles]);

  // Run simulation
const runSimulation = useCallback(async () => {
    console.log("RUN TRIGGERED");
    setLoading(true);
    setError(null);
    setIsPlaying(false);
    try {
      console.log("BEFORE API CALL");
      const data = await apiRun({
        ...params,
        disabled_cells: disabledCells.length > 0 ? disabledCells : null,
      });
      console.log("AFTER API CALL", data);
      setTrajectories(data.trajectories);
      setAngularHist(data.angular_hist);
      setLinearHist(data.linear_hist);
      setCurrentTrial(1);
      setPlaybackFrame(-1);
    } catch (e) {
      setError(e.message);
    } finally {
      console.log("FINALLY - setting loading false");
      setLoading(false);
    }
  }, [params, disabledCells]);

  // Auto-run on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (serverUp === true && trialCount === 0) runSimulation();
  }, [serverUp]);

  // Playback
  useEffect(() => {
    if (!isPlaying || !currentData) return;
    const interval = 1000 / params.hz;
    let frame = 0;
    setPlaybackFrame(0);
    const step = () => {
      frame++;
      if (frame >= currentData.normX.length) {
        setIsPlaying(false);
        setPlaybackFrame(-1);
        return;
      }
      setPlaybackFrame(frame);
      animRef.current = setTimeout(step, interval);
    };
    animRef.current = setTimeout(step, interval);
    return () => clearTimeout(animRef.current);
  }, [isPlaying, currentTrial, currentData, params.hz]);

  const regenTrial = async () => {
    setLoading(true);
    try {
      const startCell = currentData?.startCell || null;
      const data = await apiRegenerate(currentTrial, params, startCell);
      setTrajectories(prev => ({ ...prev, [String(currentTrial)]: data.trajectory }));
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  const flipAxis = async (axis) => {
    if (!currentData) return;
    try {
      const data = await apiFlip(currentTrial, axis, currentData);
      setTrajectories(prev => ({ ...prev, [String(currentTrial)]: data.trajectory }));
    } catch (e) { setError(e.message); }
  };

  const handleDurationsUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = await apiUploadDurations(file);
      updateParam("durations", data.durations);
    } catch (err) { setError(err.message); }
  };

  const toggleCell = (row, col) => {
    const key = `${row}-${col}`;
    setDisabledCells(prev => 
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const addObstacle = () => {
    setObstacles(prev => [...prev, { x: 0, y: 0, width: 5, height: 5, rotation: 0 }]);
  };

  const updateObstacle = (idx, key, val) => {
    setObstacles(prev => prev.map((o, i) => i === idx ? { ...o, [key]: val } : o));
  };

  const removeObstacle = (idx) => {
    setObstacles(prev => prev.filter((_, i) => i !== idx));
  };

  // ─── Server status screens ───
  if (serverUp === false) {
    return (
      <div style={{
        height: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        background: "#080a0f", fontFamily: "'JetBrains Mono', monospace",
      }}>
        <style>{FONT_IMPORT}</style>
        <div style={{ textAlign: "center", color: "#5a6478" }}>
          <div style={{ fontSize: 40, marginBottom: 16, opacity: 0.25 }}>⚠</div>
          <div style={{ fontSize: 13, color: "#e4e9f2", marginBottom: 8 }}>{desktop ? "Backend failed to start" : "Backend not running"}</div>
          <div style={{ fontSize: 11, maxWidth: 360, lineHeight: 1.7 }}>
            {desktop ? (
              <>The simulation engine did not start. Restart the app; if it keeps happening, check <code style={{ color: "#3d8bfd" }}>backend.log</code> in the app's data directory.</>
            ) : (
              <>
                Start the Python server first:<br/>
                <code style={{ color: "#3d8bfd", background: "#0f1218", padding: "3px 10px", borderRadius: 3, display: "inline-block", marginTop: 8 }}>
                  py -3.11 -m uvicorn main:app --reload --port 3080
                </code>
              </>
            )}
          </div>
          <button onClick={() => window.location.reload()} style={{
            marginTop: 24, padding: "8px 28px", background: "#171c25", border: "1px solid #1e2433",
            borderRadius: 4, color: "#b0b8c8", cursor: "pointer", fontFamily: "inherit", fontSize: 11,
          }}>Retry</button>
        </div>
      </div>
    );
  }

  if (serverUp === null) {
    return (
      <div style={{
        height: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        background: "#080a0f", fontFamily: "'JetBrains Mono', monospace", color: "#5a6478", fontSize: 12,
      }}>
        <style>{FONT_IMPORT}</style>
        Connecting...
      </div>
    );
  }

  // ─── Main layout ───
  return (
    <>
      <style>{FONT_IMPORT}{GLOBAL_CSS}</style>
      <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--bg)" }}>
        <div className="tab-bar mode-tab-bar" style={{ flexShrink: 0, borderBottom: "1px solid var(--border)" }}>
          <DataFolderControl />
        </div>
        <div style={{ flex: 1, overflow: "hidden" }}>
          <div style={{ height: "100%" }}>
            <div className="app-grid" style={{ height: "100%" }}>

        {/* ═══ LEFT: Parameters ═══ */}
        <div className="panel panel-left">
          <div className="panel-header">
            <StatusDot loading={loading} error={error} />
            <h1 className="app-title">Randomized</h1>
          </div>
          <div className="params-scroll">
            <div className="tab-bar" style={{ margin: "-12px -14px 12px", position: "sticky", top: -12, zIndex: 1 }}>
              <button className={`tab ${paramTab === "simulation" ? "tab-active" : ""}`}
                style={{ padding: "11px 12px", fontSize: 12 }}
                onClick={() => setParamTab("simulation")}>Simulation</button>
              <button className={`tab ${paramTab === "arena" ? "tab-active" : ""}`}
                style={{ padding: "11px 12px", fontSize: 12 }}
                onClick={() => setParamTab("arena")}>Arena</button>
              <button className={`tab ${paramTab === "durations" ? "tab-active" : ""}`}
                style={{ padding: "11px 12px", fontSize: 12 }}
                onClick={() => setParamTab("durations")}>Durations</button>
            </div>

            {paramTab === "simulation" && <>
              <Section title="Distributions">
                <SelectRow label="Angular" value={params.a_dist} options={["Gaussian","Wrapped","Skewed"]} onChange={v => updateParam("a_dist", v)} />
                <SelectRow label="Linear" value={params.l_dist} options={["Gaussian","Wrapped","Skewed"]} onChange={v => updateParam("l_dist", v)} />
              </Section>
              <Section title="Angular Range">
                <InputRow label="Min" value={params.angular_min} step={5} onChange={v => updateParam("angular_min", v)} />
                <InputRow label="Max" value={params.angular_max} step={5} onChange={v => updateParam("angular_max", v)} />
              </Section>
              <Section title="Linear Range">
                <InputRow label="Min" value={params.linear_min} onChange={v => updateParam("linear_min", v)} />
                <InputRow label="Max" value={params.linear_max} onChange={v => updateParam("linear_max", v)} />
              </Section>
              <Section title="Distribution Params">
                <InputRow label="Kappa" value={params.kappa} step={0.1} onChange={v => updateParam("kappa", v)} />
                <InputRow label="Peak" value={params.peak} step={0.1} onChange={v => updateParam("peak", v)} />
                <InputRow label="Ang Shape" value={params.a_shape} step={0.1} onChange={v => updateParam("a_shape", v)} />
                <InputRow label="Ang Scale" value={params.a_scale} step={0.1} onChange={v => updateParam("a_scale", v)} />
                <InputRow label="Lin Shape" value={params.l_shape} step={0.1} onChange={v => updateParam("l_shape", v)} />
                <InputRow label="Lin Scale" value={params.l_scale} step={0.1} onChange={v => updateParam("l_scale", v)} />
              </Section>
              <Section title="Trajectory">
                <InputRow label="Hz" value={params.hz} step={1} onChange={v => updateParam("hz", v)} />
                <InputRow label="Duration (s)" value={params.duration} step={1} onChange={v => updateParam("duration", v)} />
                <InputRow label="Trials" value={params.trials} step={1} onChange={v => updateParam("trials", v)} />
                <InputRow label="Turn Min" value={params.t_mod_min} step={1} onChange={v => updateParam("t_mod_min", v)} />
                <InputRow label="Turn Max" value={params.t_mod_max} step={1} onChange={v => updateParam("t_mod_max", v)} />
                <InputRow label="Smoothing" value={params.smoothing} step={1} onChange={v => updateParam("smoothing", v)} />
                <div className="input-row">
                  <span className="input-label">Balanced Speed</span>
                  <input type="checkbox" checked={params.balanced_speed !== false}
                    onChange={e => updateParam("balanced_speed", e.target.checked)}
                    style={{ accentColor: "var(--accent)" }} />
                </div>
                <div className="input-row">
                  <span className="input-label">Reinterpolate</span>
                  <input type="checkbox" checked={params.reinterpolate === true}
                    onChange={e => updateParam("reinterpolate", e.target.checked)}
                    style={{ accentColor: "var(--accent)" }} />
                </div>
              </Section>
            </>}

            {paramTab === "arena" && <>
              <Section title="Mode">
                <SelectRow label="Mode" value={params.mode} options={["Bounded","Periodic","Ricochet"]} onChange={v => updateParam("mode", v)} />
              </Section>
              <Section title="Arena Size">
                <InputRow label="Width (cm)" value={params.arena_width} step={1} onChange={v => updateParam("arena_width", v)} />
                <InputRow label="Height (cm)" value={params.arena_height} step={1} onChange={v => updateParam("arena_height", v)} />
                <InputRow label="Scale X" value={params.scale_x} step={0.1} onChange={v => updateParam("scale_x", v)} />
                <InputRow label="Scale Y" value={params.scale_y} step={0.1} onChange={v => updateParam("scale_y", v)} />
              </Section>
              <Section title="Wall Avoidance">
                <InputRow label="Wall Buffer (cm)" value={params.wall_threshold} step={1} onChange={v => updateParam("wall_threshold", v)} />
                <InputRow label="Wall Nudge" value={params.wall_nudge} step={0.01} onChange={v => updateParam("wall_nudge", v)} />
                <InputRow label="Nudge Max (°)" value={params.wall_nudge_max} step={5} onChange={v => updateParam("wall_nudge_max", v)} />
              </Section>
              <Section title="Starting Position">
                <InputRow label="Start Grid" value={params.start_grid} step={1} onChange={v => updateParam("start_grid", v)} />
                <div className="input-row">
                  <span className="input-label">Edit Grid</span>
                  <input type="checkbox" checked={gridEditing}
                    onChange={e => setGridEditing(e.target.checked)}
                    style={{ accentColor: "var(--accent)" }} />
                </div>
              </Section>
              <Section title="Occlusion">
                {/* Gaps */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "2px 0" }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--text-dim)" }}>Gaps</span>
                  <input type="checkbox" checked={params.occlusion_gaps_enabled}
                    onChange={e => updateParam("occlusion_gaps_enabled", e.target.checked)}
                    style={{ accentColor: "var(--accent)" }} />
                </div>
                {params.occlusion_gaps_enabled && <>
                  <InputRow label="Total %" value={params.occlusion_total_percent} step={5} onChange={v => {
                    updateParam("occlusion_total_percent", v);
                    // Redistribute existing gaps
                    const gaps = params.occlusion_gaps || [];
                    if (gaps.length > 0) {
                      const sizeEach = Math.round(v / gaps.length);
                      updateParam("occlusion_gaps", gaps.map(g => ({ ...g, size: sizeEach })));
                    }
                  }} />
                  <SelectRow label="Vary %" value={params.occlusion_vary_percent}
                    options={["Fixed","Random","Gradual"]}
                    onChange={v => updateParam("occlusion_vary_percent", v)} />
                  {params.occlusion_vary_percent !== "Fixed" && <>
                    <InputRow label="Min %" value={params.occlusion_min_percent} step={5} onChange={v => updateParam("occlusion_min_percent", v)} />
                    <InputRow label="Max %" value={params.occlusion_max_percent} step={5} onChange={v => updateParam("occlusion_max_percent", v)} />
                  </>}
                  <InputRow label="Start Trial" value={params.occlusion_trial_start} step={1} onChange={v => updateParam("occlusion_trial_start", v)} />
                  <InputRow label="End Trial" value={params.occlusion_trial_end} step={1} onChange={v => updateParam("occlusion_trial_end", v)} />
                  <button className="btn btn-secondary btn-full" style={{ marginTop: 4 }}
                    onClick={() => {
                      const existing = params.occlusion_gaps || [];
                      const nextStart = Math.min(0.9, 0.1 + existing.length * 0.1);
                      const newCount = existing.length + 1;
                      const sizeEach = Math.round(params.occlusion_total_percent / newCount);
                      
                      const updated = existing.map(g => ({ ...g, size: sizeEach }));
                      
                      if (existing.length === 1) {
                        updated[0] = { ...updated[0], direction: "Both" };
                      }
                      
                      const dir = existing.length === 0 ? "Forward" : "Both";
                      updateParam("occlusion_gaps", [...updated, { start: nextStart, size: sizeEach, randomize: false, direction: dir, vary: "global", vary_min: 10, vary_max: 50 }]);
                    }}>
                    Add Gap
                  </button>
                  {(params.occlusion_gaps || []).map((gap, idx) => (
                    <div key={idx} style={{ border: "1px solid var(--border)", borderRadius: 3, padding: 6, marginTop: 6 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-dim)" }}>Gap {idx + 1}</span>
                        <button onClick={() => {
                          const remaining = params.occlusion_gaps.filter((_, j) => j !== idx);
                          if (remaining.length > 0) {
                            const sizeEach = Math.round(params.occlusion_total_percent / remaining.length);
                            const redistributed = remaining.map(g => ({ ...g, size: sizeEach }));
                            updateParam("occlusion_gaps", redistributed);
                          } else {
                            updateParam("occlusion_gaps", []);
                          }
                        }}
                          style={{ background: "none", border: "none", color: "var(--red)", cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 10 }}>✕</button>
                      </div>
                      <InputRow label="Start" value={gap.start} step={0.05} onChange={v => {
                        const g = [...params.occlusion_gaps]; g[idx] = { ...g[idx], start: v }; updateParam("occlusion_gaps", g);
                      }} />
                      <InputRow label="Size %" value={gap.size} step={5} onChange={v => {
                        const g = [...params.occlusion_gaps]; g[idx] = { ...g[idx], size: v }; updateParam("occlusion_gaps", g);
                      }} />
                      <SelectRow label="Direction" value={gap.direction} options={["Forward","Backward","Both"]}
                        onChange={v => {
                          const g = [...params.occlusion_gaps]; g[idx] = { ...g[idx], direction: v.toLowerCase() }; updateParam("occlusion_gaps", g);
                        }} />
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "2px 0" }}>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--text-dim)" }}>Randomize</span>
                        <input type="checkbox" checked={gap.randomize}
                          onChange={e => {
                            const g = [...params.occlusion_gaps]; g[idx] = { ...g[idx], randomize: e.target.checked }; updateParam("occlusion_gaps", g);
                          }}
                          style={{ accentColor: "var(--accent)" }} />
                      </div>
                      <SelectRow label="Vary" value={gap.vary === "global" ? "Global" : gap.vary}
                        options={["Global","Fixed","Random","Gradual"]}
                        onChange={v => {
                          const g = [...params.occlusion_gaps]; g[idx] = { ...g[idx], vary: v === "Global" ? "global" : v }; updateParam("occlusion_gaps", g);
                        }} />
                      {gap.vary !== "global" && gap.vary !== "Fixed" && <>
                        <InputRow label="Min %" value={gap.vary_min} step={5} onChange={v => {
                          const g = [...params.occlusion_gaps]; g[idx] = { ...g[idx], vary_min: v }; updateParam("occlusion_gaps", g);
                        }} />
                        <InputRow label="Max %" value={gap.vary_max} step={5} onChange={v => {
                          const g = [...params.occlusion_gaps]; g[idx] = { ...g[idx], vary_max: v }; updateParam("occlusion_gaps", g);
                        }} />
                      </>}
                    </div>
                  ))}
                </>}
                
                {/* Obstacles */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "2px 0", marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--text-dim)" }}>Obstacles</span>
                  <input type="checkbox" checked={params.occlusion_obstacles_enabled}
                    onChange={e => updateParam("occlusion_obstacles_enabled", e.target.checked)}
                    style={{ accentColor: "var(--accent)" }} />
                </div>
                {params.occlusion_obstacles_enabled && <>
                  <button className="btn btn-secondary btn-full" style={{ marginTop: 4 }}
                    onClick={addObstacle}>Add Obstacle</button>
                  {obstacles.map((obs, idx) => (
                    <div key={idx} style={{ border: "1px solid var(--border)", borderRadius: 3, padding: 6, marginTop: 6 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-dim)" }}>Obstacle {idx + 1}</span>
                        <button onClick={() => removeObstacle(idx)}
                          style={{ background: "none", border: "none", color: "var(--red)", cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 10 }}>✕</button>
                      </div>
                      <InputRow label="X (cm)" value={obs.x} step={1} onChange={v => updateObstacle(idx, "x", v)} />
                      <InputRow label="Y (cm)" value={obs.y} step={1} onChange={v => updateObstacle(idx, "y", v)} />
                      <InputRow label="Width" value={obs.width} step={1} onChange={v => updateObstacle(idx, "width", v)} />
                      <InputRow label="Height" value={obs.height} step={1} onChange={v => updateObstacle(idx, "height", v)} />
                      <InputRow label="Rotation" value={obs.rotation} step={5} onChange={v => updateObstacle(idx, "rotation", v)} />
                    </div>
                  ))}
                </>}
              </Section>
            </>}
            {paramTab === "durations" && <>
              <Section title="Trial Durations">
                <div style={{ marginBottom: 8, fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-dim)" }}>
                  Default: {params.duration}s — adjust individual trials below
                </div>
                <div style={{ maxHeight: 500, overflowY: "auto", scrollbarWidth: "none" }}>
                  {Array.from({ length: params.trials }, (_, i) => {
                    const trial = i + 1;
                    const dur = trialDurations[trial] || params.duration;
                    return (
                      <div key={trial} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0" }}>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-dim)", width: 24, flexShrink: 0 }}>{trial}</span>
                        <input
                          type="range"
                          min={1}
                          max={30}
                          step={1}
                          value={Math.min(dur, 30)}
                          onChange={e => updateTrialDuration(trial, parseFloat(e.target.value))}
                          style={{ maxWidth: 130, accentColor: "var(--accent)", height: 4, cursor: "pointer" }}
                        />
                        <div style={{ display: "flex", alignItems: "center", gap: 0, border: "1px solid var(--border)", borderRadius: 3, overflow: "hidden" }}>
                          <button onClick={() => updateTrialDuration(trial, Math.max(1, dur - 1))}
                            style={{ width: 18, height: 22, background: "var(--surface2)", border: "none", borderRight: "1px solid var(--border)", color: "var(--text-dim)", cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>−</button>
                          <NumInput value={dur} width={30} height={22} fontSize={10} onChange={v => { if (v >= 1) updateTrialDuration(trial, v); }} />
                          <button onClick={() => updateTrialDuration(trial, dur + 1)}
                            style={{ width: 18, height: 22, background: "var(--surface2)", border: "none", borderLeft: "1px solid var(--border)", color: "var(--text-dim)", cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
                        </div>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-dim)" }}>s</span>
                      </div>
                    );
                  })}
                </div>
              </Section>
              <button className="btn btn-secondary btn-full" style={{ marginTop: 8 }}
                onClick={() => {
                  setTrialDurations({});
                  updateParam("durations", null);
                }}>
                Reset All to Default
              </button>
            </>}

            <button className="btn btn-primary btn-full" onClick={runSimulation} disabled={loading}>
              {loading ? "Running..." : "Run Simulation"}
            </button>
          </div>
        </div>

        {/* ═══ CENTER: Plot ═══ */}
        <div className="panel panel-center">
          <div className="tab-bar">
            {["trajectory"].map(tab => (
              <button key={tab} className={`tab ${activeTab === tab ? "tab-active" : ""}`}
                onClick={() => setActiveTab(tab)}>{tab}</button>
            ))}
            {error && <span className="error-badge">{error}</span>}
          </div>
          <div className="plot-area">
            {loading && !currentData && <div className="plot-loading">Generating trajectories...</div>}
            {activeTab === "trajectory" && currentData && (
              <TrajectoryPlot data={currentData} scaleX={params.scale_x} scaleY={params.scale_y}
                playbackFrame={playbackFrame} trialIndex={currentTrial}
                duration={(currentData.normX.length / params.hz).toFixed(2)}
                coordTab={coordTab} arenaWidth={params.arena_width} arenaHeight={params.arena_height}
                paramTab={paramTab} startGrid={params.start_grid}
                disabledCells={disabledCells} onToggleCell={toggleCell}
                obstacles={obstacles} occlusionEnabled={(params.occlusion_gaps_enabled || params.occlusion_obstacles_enabled)}
                selectedObstacle={selectedObstacle} setSelectedObstacle={setSelectedObstacle}
                updateObstacle={updateObstacle} 
                gridEditing={gridEditing} />
            )}
          </div>
          <div className="nav-bar">
            <button className="btn btn-nav" disabled={currentTrial <= 1}
              onClick={() => { setIsPlaying(false); setPlaybackFrame(-1); setCurrentTrial(t => Math.max(1, t - 1)); }}>
              ◀ Prev
            </button>
            <button className="btn btn-play" onClick={() => {
              if (isPlaying) { setIsPlaying(false); clearTimeout(animRef.current); setPlaybackFrame(-1); }
              else { setPlaybackFrame(0); setIsPlaying(true); }
            }}>{isPlaying ? "■ Stop" : "▶ Play"}</button>
            <button className="btn btn-nav" disabled={currentTrial >= trialCount}
              onClick={() => { setIsPlaying(false); setPlaybackFrame(-1); setCurrentTrial(t => Math.min(trialCount, t + 1)); }}>
              Next ▶
            </button>
            <span className="nav-info">
              Trial {currentTrial}/{trialCount}
              {playbackFrame >= 0 && currentData && ` · ${playbackFrame}/${currentData.normX.length}`}
            </span>
          </div>
        </div>

        {/* ═══ RIGHT: Editor & Export ═══ */}
        <div className="panel panel-right">
          <div className="right-section">
            <SectionLabel>Trial Editor</SectionLabel>
            <div className="btn-group">
              <button className="btn btn-action btn-full" onClick={regenTrial} disabled={loading}>Regenerate</button>
              <div className="btn-row">
                <button className="btn btn-secondary" onClick={() => flipAxis("x")}>Flip X</button>
                <button className="btn btn-secondary" onClick={() => flipAxis("y")}>Flip Y</button>
              </div>
              <div className="btn-row">
                <div style={{ display: "flex", alignItems: "center", gap: 0, border: "1px solid var(--border)", borderRadius: 3, overflow: "hidden" }}>
                  <button onClick={() => setEditorSmoothing(Math.max(1, editorSmoothing - 1))}
                    style={{ width: 20, height: 24, background: "var(--surface2)", border: "none", borderRight: "1px solid var(--border)", color: "var(--text-dim)", cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>−</button>
                  <input type="text" value={editorSmoothing}
                    onChange={e => {
                      const v = parseInt(e.target.value);
                      if (!isNaN(v) && v >= 1) setEditorSmoothing(v);
                    }}
                    style={{ width: 35, height: 24, background: "var(--surface2)", border: "none", color: "var(--text-bright)", fontFamily: "var(--font-mono)", fontSize: 10.5, textAlign: "center", outline: "none" }} />
                  <button onClick={() => setEditorSmoothing(editorSmoothing + 1)}
                    style={{ width: 20, height: 24, background: "var(--surface2)", border: "none", borderLeft: "1px solid var(--border)", color: "var(--text-dim)", cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
                </div>
                <button className="btn btn-secondary" onClick={smoothTrial}>Smooth</button>
                <button className="btn btn-secondary" onClick={undoSmooth} 
                  disabled={!preSmoothData[currentTrial]}>Undo</button>
              </div>
              <button className="btn btn-secondary btn-full" style={{ marginTop: 4 }} onClick={async () => {
                  if (!currentData) return;
                  try {
                    const res = await fetch(`${API}/apply-occlusion`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        trajectory: currentData,
                        gaps_enabled: params.occlusion_gaps_enabled,
                        occlusion_gaps: params.occlusion_gaps,
                        obstacles_enabled: params.occlusion_obstacles_enabled,
                        occlusion_obstacles: obstacles.length > 0 ? obstacles : null,
                        arena_width: params.arena_width,
                        arena_height: params.arena_height,
                        trial_num: currentTrial,
                        trial_start: params.occlusion_trial_start,
                        trial_end: params.occlusion_trial_end,
                        vary_percent: params.occlusion_vary_percent,
                        min_percent: params.occlusion_min_percent,
                        max_percent: params.occlusion_max_percent,
                      }),
                    });
                    const occData = await res.json();
                    setTrajectories(prev => ({ ...prev, [String(currentTrial)]: occData.trajectory }));
                  } catch (e) { setError(e.message); }
                }}>Apply Occlusion</button>
            </div>
          </div>
          <div className="right-section right-section-grow">
            <SectionLabel>Coordinates</SectionLabel>
            <div className="tab-bar" style={{ margin: "8px 0 4px" }}>
              <button className={`tab ${coordTab === "raw" ? "tab-active" : ""}`}
                onClick={() => setCoordTab("raw")}>Raw</button>
              <button className={`tab ${coordTab === "normalized" ? "tab-active" : ""}`}
                onClick={() => setCoordTab("normalized")}>Normalized</button>
            </div>
            {currentData && (
              <div className="coord-table">
                <div className="coord-header">
                  <span>#</span>
                  <span>{coordTab === "normalized" ? "Norm X" : "X"}</span>
                  <span>{coordTab === "normalized" ? "Norm Y" : "Y"}</span>
                  <span>Vel</span>
                </div>
                <div className="coord-scroll" ref={coordScrollRef}>
                  {currentData.normX.map((xNorm, i) => {
                    const halfW = params.arena_width / 2;
                    const halfH = params.arena_height / 2;
                    const xVal = coordTab === "raw" ? xNorm * halfW : xNorm;
                    const yVal = coordTab === "raw" ? currentData.normY[i] * halfH : currentData.normY[i];
                    let vel = 0;
                    if (i > 0) {
                      const prevX = coordTab === "raw" ? currentData.normX[i-1] * halfW : currentData.normX[i-1];
                      const prevY = coordTab === "raw" ? currentData.normY[i-1] * halfH : currentData.normY[i-1];
                      const dx = xVal - prevX;
                      const dy = yVal - prevY;
                      vel = Math.sqrt(dx * dx + dy * dy);
                      if (coordTab === "raw") vel = vel * params.hz;
                    }
                    return (
                      <div className={`coord-row ${playbackFrame === i ? "coord-row-active" : ""}`} key={i}>
                        <span className="coord-idx">{i}</span>
                        <span>{coordTab === "raw" ? xVal.toFixed(2) : xVal.toFixed(4)}</span>
                        <span>{coordTab === "raw" ? yVal.toFixed(2) : yVal.toFixed(4)}</span>
                        <span>{vel.toFixed(coordTab === "raw" ? 2 : 4)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <div className="right-section" style={{ minHeight: 200 }}>
            <SectionLabel>Export / Import</SectionLabel>
            <div className="btn-group" style={{ gap: 12, marginTop: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <label style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-dim)", whiteSpace: "nowrap" }}>Name</label>
                <input type="text" value={randomizedName} onChange={e => setRandomizedName(e.target.value)}
                  placeholder="RP#" style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 11, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 3, padding: "4px 8px", color: "var(--text)", outline: "none" }} />
              </div>
              <button className="btn btn-export btn-full" onClick={async () => { if (!randomizedName.trim()) { alert("Please enter a name before exporting."); return; } await apiExport({ ...params, name: randomizedName.trim() }); }}>Export CSV</button>
              <label className="btn btn-secondary btn-full" style={{ textAlign: "center", cursor: "pointer" }}>
                Import Durations
                <input type="file" accept=".csv" onChange={handleDurationsUpload} style={{ display: "none" }} />
              </label>
              {params.durations && (
                <span className="durations-badge">✓ {params.durations.length} durations loaded</span>
              )}
            </div>
          </div>
        </div>

        {/* ═══ BOTTOM: Distributions ═══ */}
        <div className="panel panel-bottom">
                <DistPlot title="Angular Distribution" data={angularHist} color="var(--accent)" />
                <DistPlot title="Linear Distribution" data={linearHist} color="var(--green)" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ============================================================
// PLOT COMPONENTS
// ============================================================

function TrajectoryPlot({ data, scaleX, scaleY, playbackFrame, trialIndex, duration, coordTab, arenaWidth, arenaHeight, paramTab, startGrid, disabledCells, onToggleCell, obstacles, occlusionEnabled, selectedObstacle, setSelectedObstacle, updateObstacle, gridEditing }) {
  const maxSize = 500;
  const aspect = arenaWidth / arenaHeight;
  const W = aspect >= 1 ? maxSize : Math.round(maxSize * aspect);
  const H = aspect >= 1 ? Math.round(maxSize / aspect) : maxSize;
  const pad = { top: 44, right: 32, bottom: 44, left: 54 };
  const pw = W - pad.left - pad.right, ph = H - pad.top - pad.bottom;

  const isRaw = coordTab === "raw";
  const halfW = arenaWidth / 2;
  const halfH = arenaHeight / 2;
  const plotX = isRaw ? data.normX.map(v => v * halfW) : data.normX;
  const plotY = isRaw ? data.normY.map(v => v * halfH) : data.normY;
  const axisX = isRaw ? halfW : 1.0;
  const axisY = isRaw ? halfH : 1.0;
  const boundsX = isRaw ? scaleX * halfW : scaleX;
  const boundsY = isRaw ? scaleY * halfH : scaleY;
  const unit = isRaw ? " cm" : "";

  const toX = v => pad.left + ((v + axisX) / (2 * axisX)) * pw;
  const toY = v => pad.top + ph - ((v + axisY) / (2 * axisY)) * ph;

  const endIdx = playbackFrame >= 0 ? playbackFrame + 1 : plotX.length;
  const lastX = plotX[endIdx - 1], lastY = plotY[endIdx - 1];

  const xTicks = [], yTicks = [];
  for (let v = -axisX; v <= axisX + 0.001; v += axisX / 4) xTicks.push(v);
  for (let v = -axisY; v <= axisY + 0.001; v += axisY / 4) yTicks.push(v);

  const fromX = px => (px - pad.left) / pw * (2 * axisX) - axisX;
  const fromY = py => axisY - (py - pad.top) / ph * (2 * axisY);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="plot-svg" onClick={() => setSelectedObstacle(null)}>
      <defs>
        <linearGradient id="tg" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="1" />
        </linearGradient>
      </defs>
      <text x={pad.left} y={26} className="plot-title">
        Trial {trialIndex} — {duration}s — {plotX.length} frames{isRaw ? " (cm)" : ""}
      </text>
      {xTicks.map((v, i) => (
        <g key={`x${i}`}>
          <line x1={toX(v)} y1={pad.top} x2={toX(v)} y2={pad.top + ph}
            stroke="var(--border)" strokeWidth={Math.abs(v) < 0.001 ? 0.8 : 0.35} strokeDasharray={Math.abs(v) < 0.001 ? "" : "3,6"} />
          <text x={toX(v)} y={H - 12} className="plot-tick" textAnchor="middle">{isRaw ? v.toFixed(0) : v.toFixed(1)}{unit}</text>
        </g>
      ))}
      {yTicks.map((v, i) => (
        <g key={`y${i}`}>
          <line x1={pad.left} y1={toY(v)} x2={pad.left + pw} y2={toY(v)}
            stroke="var(--border)" strokeWidth={Math.abs(v) < 0.001 ? 0.8 : 0.35} strokeDasharray={Math.abs(v) < 0.001 ? "" : "3,6"} />
          <text x={pad.left - 10} y={toY(v) + 3} className="plot-tick" textAnchor="end">{isRaw ? v.toFixed(0) : v.toFixed(1)}{unit}</text>
        </g>
      ))}
      <rect x={pad.left} y={pad.top} width={pw} height={ph} fill="none" stroke="rgba(255,255,255,1)" strokeWidth={1} />
      
      {/* Arena boundary box */}
      <rect 
        x={toX(-boundsX)} y={toY(boundsY)} 
        width={toX(boundsX) - toX(-boundsX)} 
        height={toY(-boundsY) - toY(boundsY)}
        fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth={1.5} strokeDasharray="4,4" opacity={0.8} />
          {/* Starting position grid — only show when Arena tab is selected */}
    {/* Obstacles */}
      {occlusionEnabled && obstacles && obstacles.map((obs, idx) => {
        const ox = isRaw ? obs.x : obs.x / halfW;
        const oy = isRaw ? obs.y : obs.y / halfH;
        const ow = isRaw ? obs.width : obs.width / halfW;
        const oh = isRaw ? obs.height : obs.height / halfH;
        const cx = toX(ox);
        const cy = toY(oy);
        const isSelected = selectedObstacle === idx;
        return (
          <rect key={`obs${idx}`}
            x={toX(ox - ow/2)} y={toY(oy + oh/2)}
            width={toX(ox + ow/2) - toX(ox - ow/2)}
            height={toY(oy - oh/2) - toY(oy + oh/2)}
            fill={isSelected ? "rgba(248,113,113,0.3)" : "rgba(248,113,113,0.15)"}
            stroke={isSelected ? "var(--red)" : "rgba(248,113,113,0.4)"}
            strokeWidth={isSelected ? 2.5 : 1.5}
            strokeDasharray={isSelected ? "" : "4,3"}
            opacity={0.8}
            transform={`rotate(${-obs.rotation}, ${cx}, ${cy})`}
            style={{ cursor: "pointer" }}
            onClick={(e) => { e.stopPropagation(); setSelectedObstacle(idx); }}
          />
        );
      })}
    {gridEditing && startGrid > 0 && (() => {
      const cells = [];
      const cellW = (boundsX * 2) / startGrid;
      const cellH = (boundsY * 2) / startGrid;
      for (let r = 0; r < startGrid; r++) {
        for (let c = 0; c < startGrid; c++) {
          const key = `${r}-${c}`;
          const disabled = disabledCells.includes(key);
          const x1 = toX(-boundsX + c * cellW);
          const y1 = toY(boundsY - r * cellH);
          const x2 = toX(-boundsX + (c + 1) * cellW);
          const y2 = toY(boundsY - (r + 1) * cellH);
          cells.push(
            <rect key={key}
              x={x1} y={y1}
              width={x2 - x1} height={y2 - y1}
              fill={disabled ? "rgba(248,113,113,0.15)" : "rgba(52,211,153,0.1)"}
              stroke={disabled ? "rgba(248,113,113,0.4)" : "rgba(52,211,153,0.3)"}
              strokeWidth={1}
              style={{ cursor: "pointer" }}
              onClick={() => onToggleCell(r, c)}
            />
          );
        }
      }
      return cells;
    })()}
      {(() => {
        const teleportThreshold = (boundsX * 2) * 0.5;
        const segments = [];
        const teleportMarkers = [];
        let current = [];
        let currentOccluded = false;
        
        for (let i = 0; i < endIdx; i++) {
          const isVisible = data.visible ? data.visible[i] : true;
          
          if (i > 0) {
            const dx = Math.abs(plotX[i] - plotX[i-1]);
            const dy = Math.abs(plotY[i] - plotY[i-1]);
            // Break on teleport
            if (dx > teleportThreshold || dy > teleportThreshold) {
              if (current.length > 0) segments.push({ pts: current.join(" "), occluded: currentOccluded });
              teleportMarkers.push({
                exitX: toX(plotX[i-1]), exitY: toY(plotY[i-1]),
                entryX: toX(plotX[i]), entryY: toY(plotY[i]),
              });
              current = [];
            }
            // Break on visibility change
            if (!isVisible !== currentOccluded) {
              if (current.length > 0) segments.push({ pts: current.join(" "), occluded: currentOccluded });
              current = [];
              currentOccluded = !isVisible;
            }
          } else {
            currentOccluded = !isVisible;
          }
          current.push(`${toX(plotX[i])},${toY(plotY[i])}`);
        }
        if (current.length > 0) segments.push({ pts: current.join(" "), occluded: currentOccluded });
        
        return <>
          {segments.map((seg, idx) => (
            <polyline key={idx} points={seg.pts} fill="none"
              stroke={seg.occluded ? "var(--text-dim)" : "url(#tg)"}
              strokeWidth={seg.occluded ? 1 : 1.8}
              strokeDasharray={seg.occluded ? "3,6" : ""}
              strokeLinejoin="round" strokeLinecap="round"
              opacity={seg.occluded ? 0.3 : 1} />
          ))}
          {teleportMarkers.map((m, idx) => {
            const hue = teleportMarkers.length === 1 ? 0 : (idx / teleportMarkers.length) * 360;
            const color = `hsl(${hue}, 80%, 60%)`;
            return (
              <g key={`tp${idx}`}>
                <circle cx={m.exitX} cy={m.exitY} r={4} fill={color} opacity={0.9} />
                <circle cx={m.entryX} cy={m.entryY} r={4} fill={color} opacity={0.9}>
                  <animate attributeName="r" values="4;6;4" dur="0.8s" repeatCount="indefinite" />
                </circle>
              </g>
            );
          })}
        </>;
      })()}
      <circle cx={toX(plotX[0])} cy={toY(plotY[0])} r={4.5} fill="var(--green)" stroke="rgba(255,255,255,1)" strokeWidth={2}>
        <animate attributeName="opacity" values="1;0.5;1" dur="2s" repeatCount="indefinite" />
      </circle>
      <circle cx={toX(lastX)} cy={toY(lastY)} r={5} 
        fill={data.visible && !data.visible[endIdx - 1] ? "var(--text-dim)" : "var(--red)"}
        stroke="rgba(255,255,255,1)" strokeWidth={2}>
      </circle>
      <circle cx={W - 120} cy={pad.top + 14} r={3.5} fill="var(--green)" />
      <text x={W - 113} y={pad.top + 17} className="plot-legend">Start</text>
      <circle cx={W - 70} cy={pad.top + 14} r={3.5} fill="var(--red)" />
      <text x={W - 63} y={pad.top + 17} className="plot-legend">Head</text>
    </svg>
  );
}

function DistPlot({ title, data, color }) {
  if (!data.x.length) return <div className="dist-empty">No data</div>;
  const maxY = Math.max(...data.y) || 1;
  const minX = data.x[0], maxX = data.x[data.x.length - 1];
  const rX = maxX - minX || 1;

  return (
    <div style={{ padding: "8px 12px", height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="plot-subtitle" style={{ color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 10.5, fontWeight: 600, marginBottom: 4 }}>{title}</div>
      <div style={{ flex: 1, display: "flex", alignItems: "flex-end", gap: 1, borderLeft: "1px solid var(--border)", borderBottom: "1px solid var(--border)", padding: "0 0 0 1px", minHeight: 0, position: "relative", marginLeft: 28 }}>
        <span style={{ position: "absolute", top: 0, left: -28, fontFamily: "var(--font-mono)", fontSize: 8, color: "var(--text-dim)" }}>{maxY.toFixed(2)}</span>
        <span style={{ position: "absolute", top: "25%", left: -28, fontFamily: "var(--font-mono)", fontSize: 8, color: "var(--text-dim)" }}>{(maxY * 0.75).toFixed(2)}</span>
        <span style={{ position: "absolute", top: "50%", left: -28, fontFamily: "var(--font-mono)", fontSize: 8, color: "var(--text-dim)" }}>{(maxY * 0.5).toFixed(2)}</span>
        <span style={{ position: "absolute", top: "75%", left: -28, fontFamily: "var(--font-mono)", fontSize: 8, color: "var(--text-dim)" }}>{(maxY * 0.25).toFixed(2)}</span>
        <span style={{ position: "absolute", bottom: 0, left: -28, fontFamily: "var(--font-mono)", fontSize: 8, color: "var(--text-dim)" }}>0</span>
        {data.x.map((x, i) => (
          <div key={i} style={{
            flex: 1,
            height: `${(data.y[i] / maxY) * 100}%`,
            background: color,
            opacity: 0.6,
            minWidth: 0,
          }} />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--font-mono)", fontSize: 8, color: "var(--text-dim)", marginTop: 2, marginLeft: 28 }}>
        <span>{minX.toFixed(1)}</span>
        <span>{(minX + rX * 0.25).toFixed(1)}</span>
        <span>{(minX + rX * 0.5).toFixed(1)}</span>
        <span>{(minX + rX * 0.75).toFixed(1)}</span>
        <span>{maxX.toFixed(1)}</span>
      </div>
    </div>
  );
}

// ============================================================
// UI PRIMITIVES
// ============================================================

function StatusDot({ loading, error }) {
  return <div style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--green)", boxShadow: "0 0 8px var(--green)", flexShrink: 0 }} />;
}
function SectionLabel({ children }) { return <div className="section-label">{children}</div>; }
function Section({ title, children }) {
  return <div className="param-section"><div className="param-section-title">{title}</div>{children}</div>;
}
function InputRow({ label, value, step = 1, onChange }) {
  const [editing, setEditing] = useState(null);
  const commit = () => {
    if (editing === null) return;
    const v = parseFloat(editing);
    if (!isNaN(v)) onChange(v);
    setEditing(null);
  };
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "2px 0" }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--text-dim)" }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 0, border: "1px solid var(--border)", borderRadius: 3, overflow: "hidden" }}>
        <button onClick={() => { const snapped = Math.round(value / step) * step; onChange(parseFloat((snapped - step).toFixed(10))); }}
          style={{ width: 20, height: 24, background: "var(--surface2)", border: "none", borderRight: "1px solid var(--border)", color: "var(--text-dim)", cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>−</button>
        <input type="text" value={editing !== null ? editing : value}
          onChange={e => setEditing(e.target.value)}
          onFocus={e => { setEditing(String(value)); e.target.select(); }}
          onBlur={commit}
          onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }}
          style={{ width: 45, height: 24, background: "var(--surface2)", border: "none", color: "var(--text-bright)", fontFamily: "var(--font-mono)", fontSize: 10.5, textAlign: "center", outline: "none" }} />
        <button onClick={() => { const snapped = Math.round(value / step) * step; onChange(parseFloat((snapped + step).toFixed(10))); }}
          style={{ width: 20, height: 24, background: "var(--surface2)", border: "none", borderLeft: "1px solid var(--border)", color: "var(--text-dim)", cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
      </div>
    </div>
  );
}
function NumInput({ value, width = 45, height = 24, fontSize = 10.5, onChange }) {
  const [editing, setEditing] = useState(null);
  const commit = () => {
    if (editing === null) return;
    const v = parseFloat(editing);
    if (!isNaN(v)) onChange(v);
    setEditing(null);
  };
  return (
    <input type="text" value={editing !== null ? editing : value}
      onChange={e => setEditing(e.target.value)}
      onFocus={e => { setEditing(String(value)); e.target.select(); }}
      onBlur={commit}
      onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }}
      style={{ width, height, background: "var(--surface2)", border: "none", color: "var(--text-bright)", fontFamily: "var(--font-mono)", fontSize, textAlign: "center", outline: "none" }} />
  );
}
function SelectRow({ label, value, options, onChange }) {
  return (
    <div className="input-row">
      <span className="input-label">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)} className="select-field">
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}
function SelectRowSmall({ label, value, options, onChange }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "2px 0" }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--text-dim)" }}>{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)} className="select-field" style={{ width: 82, minWidth: 82 }}>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

// ============================================================
// STYLES
// ============================================================

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Outfit:wght@300;400;500;600;700&display=swap');`;

const GLOBAL_CSS = `
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
  :root {
    --bg: #080a0f;
    --surface: #0f1218;
    --surface2: #171c25;
    --border: #1e2433;
    --border-focus: #3d8bfd;
    --text: #b0b8c8;
    --text-dim: #5a6478;
    --text-bright: #e4e9f2;
    --accent: #3d8bfd;
    --accent-dim: rgba(61,139,253,0.12);
    --green: #34d399;
    --red: #f87171;
    --orange: #fb923c;
    --font-mono: 'JetBrains Mono', monospace;
    --font-sans: 'Outfit', sans-serif;
  }
  body { background: var(--bg); color: var(--text); font-family: var(--font-sans); }

  .app-grid {
    display: grid;
    grid-template-columns: 272px 1fr 216px;
    grid-template-rows: 3fr 1fr;
    width: 100vw; gap: 1px; background: #000; overflow: hidden;
    height: 100%;
  }
  .panel { background: var(--surface); overflow: hidden; }
  .panel-left { grid-column: 1; grid-row: 1/3; border-right: 1px solid var(--border); display: flex; flex-direction: column; }
  .panel-center { grid-column: 2; grid-row: 1; display: flex; flex-direction: column; }
  .panel-right { grid-column: 3; grid-row: 1/3; border-left: 1px solid var(--border); display: flex; flex-direction: column; }
  .panel-bottom { grid-column: 2; grid-row: 2; border-top: 1px solid var(--border); display: grid; grid-template-columns: 1fr 1fr; gap: 1px; overflow: visible; }

  .panel-header { display: flex; align-items: center; gap: 10px; padding: 16px 16px 12px; border-bottom: 1px solid var(--border); }
  .app-title { font-family: var(--font-mono); font-size: 11px; font-weight: 600; color: var(--text-bright); letter-spacing: 2px; text-transform: uppercase; }
  .params-scroll { flex: 1; overflow-y: auto; padding: 12px 14px 20px; scrollbar-width: thin; scrollbar-color: var(--border) transparent; }

  .param-section { margin-bottom: 14px; }
  .param-section-title { font-family: var(--font-mono); font-size: 9px; font-weight: 600; color: var(--text-dim); text-transform: uppercase; letter-spacing: 1.8px; padding-bottom: 5px; margin-bottom: 5px; border-bottom: 1px solid var(--border); }
  .input-row { display: flex; align-items: center; justify-content: space-between; padding: 2px 0; }
  .input-label { font-family: var(--font-mono); font-size: 10.5px; color: var(--text-dim); }
  .input-field, .select-field { width: 82px; padding: 3px 7px; background: var(--surface2); border: 1px solid var(--border); border-radius: 3px; color: var(--text-bright); font-family: var(--font-mono); font-size: 11px; text-align: right; outline: none; transition: border-color 0.15s; }
  .select-field { cursor: pointer; text-align: left; width: 100px; }
  .input-field:focus, .select-field:focus { border-color: var(--border-focus); }

  .btn { padding: 7px 12px; border: 1px solid var(--border); border-radius: 4px; font-family: var(--font-mono); font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; cursor: pointer; transition: all 0.15s; color: var(--text-bright); }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-full { width: 100%; }
  .btn-primary { background: var(--accent); border-color: var(--accent); }
  .btn-primary:hover:not(:disabled) { background: #5a9ffd; }
  .btn-secondary { background: var(--surface2); flex: 1; }
  .btn-secondary:hover { background: var(--border); }
  .btn-action { background: var(--accent-dim); border-color: rgba(61,139,253,0.3); color: var(--accent); }
  .btn-action:hover:not(:disabled) { background: rgba(61,139,253,0.2); }
  .btn-export { background: rgba(52,211,153,0.1); border-color: rgba(52,211,153,0.3); color: var(--green); }
  .btn-export:hover { background: rgba(52,211,153,0.18); }
  .btn-group { display: flex; flex-direction: column; gap: 5px; margin-top: 10px; }
  .btn-row { display: flex; gap: 5px; }
  .btn-nav { background: var(--surface2); padding: 6px 16px; }
  .btn-nav:hover:not(:disabled) { background: var(--border); }
  .btn-play { background: var(--accent-dim); border-color: rgba(61,139,253,0.4); color: var(--accent); padding: 6px 20px; }
  .btn-play:hover { background: rgba(61,139,253,0.2); }

  .tab-bar { display: flex; align-items: center; background: var(--surface); border-bottom: 1px solid var(--border); }
  .tab { padding: 11px 22px; background: none; border: none; border-bottom: 2px solid transparent; font-family: var(--font-mono); font-size: 10.5px; font-weight: 500; text-transform: uppercase; letter-spacing: 1.2px; color: var(--text-dim); cursor: pointer; transition: all 0.15s; }
  .tab:hover { color: var(--text); }
  .tab-active { color: var(--text-bright); border-bottom-color: var(--accent); background: var(--bg); }
  .mode-tab-bar { display: flex; width: 100%; }
  .mode-tab { flex: 1; text-align: center; padding: 13px 22px; font-size: 11.5px; letter-spacing: 1.5px; }
  .error-badge { margin-left: auto; padding: 4px 10px; font-family: var(--font-mono); font-size: 10px; color: var(--red); opacity: 0.8; }

  .plot-area { flex: 1; padding: 12px 16px; background: var(--bg); position: relative; overflow: hidden; }
  .plot-svg { width: 100%; height: 100%; display: block; border-radius: 4px; }
  .plot-loading { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-family: var(--font-mono); font-size: 12px; color: var(--text-dim); }
  .plot-title { fill: var(--text-bright); font-family: var(--font-mono); font-size: 12px; font-weight: 600; }
  .plot-subtitle { fill: var(--text); font-family: var(--font-mono); font-size: 10.5px; font-weight: 600; }
  .plot-tick { fill: var(--text-dim); font-family: var(--font-mono); font-size: 9px; }
  .plot-legend { fill: var(--text-dim); font-family: var(--font-mono); font-size: 9px; }

  .nav-bar { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 10px 16px; background: var(--surface); border-top: 1px solid var(--border); }
  .nav-info { font-family: var(--font-mono); font-size: 10.5px; color: var(--text-dim); margin-left: 12px; }

  .right-section { padding: 14px 12px; border-bottom: 1px solid var(--border); }
  .right-section-grow { flex: 1; overflow: hidden; display: flex; flex-direction: column; border-bottom: none; }
  .section-label { font-family: var(--font-mono); font-size: 9.5px; font-weight: 600; color: var(--text-dim); text-transform: uppercase; letter-spacing: 1.5px; }
  .durations-badge { font-family: var(--font-mono); font-size: 10px; color: var(--green); padding: 2px 0; }

  .coord-table { margin-top: 8px; flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .coord-header { display: grid; grid-template-columns: 28px 1fr 1fr 1fr; gap: 4px; font-family: var(--font-mono); font-size: 9px; font-weight: 600; color: var(--text); padding-bottom: 4px; border-bottom: 1px solid var(--border); }
  .coord-scroll { flex: 1; overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
  

.coord-row { display: grid; grid-template-columns: 28px 1fr 1fr 1fr; gap: 4px; font-family: var(--font-mono); font-size: 9px; color: var(--text-dim); line-height: 1.8; padding: 0 2px; border-radius: 2px; }
  .coord-idx { opacity: 0.5; }
  .coord-more { font-family: var(--font-mono); font-size: 9px; color: var(--text-dim); padding: 4px 0; opacity: 0.5; }

  .dist-plot { padding: 8px 12px; }
  .dist-empty { display: flex; align-items: center; justify-content: center; font-family: var(--font-mono); font-size: 11px; color: var(--text-dim); height: 100%; }
.coord-row-active { background: rgba(61,139,253,0.12); }

.duration-input {
    width: 45px;
    padding: 3px 4px;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: 3px;
    color: var(--text-bright);
    font-family: var(--font-mono);
    font-size: 11px;
    text-align: left;
    outline: none;
  }
  .duration-input:focus { border-color: var(--border-focus); }

  @keyframes exportFill {
    0% { background-position: 200% 0; }
    100% { background-position: -100% 0; }
  }
`;

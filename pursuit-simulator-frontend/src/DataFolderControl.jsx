import { useState, useEffect } from "react";
import { desktop } from "./api";

// Shows the local data folder (desktop app only) with Change / Open buttons.
export default function DataFolderControl() {
  const [dir, setDir] = useState("");

  useEffect(() => {
    if (desktop) desktop.getDataDir().then(setDir).catch(() => {});
  }, []);

  if (!desktop) return null;

  const btn = {
    background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 3,
    color: "var(--text)", cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 10,
    padding: "3px 8px",
  };

  const change = async () => {
    // Main process picks a folder, restarts the backend, then we reload to repopulate lists.
    const next = await desktop.chooseDataDir();
    if (next) window.location.reload();
  };

  return (
    <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, padding: "0 12px", minWidth: 0 }}>
      <span title={dir} style={{
        fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-dim)",
        maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "rtl",
      }}>{dir}</span>
      <button style={btn} onClick={change}>Change data folder…</button>
      <button style={btn} onClick={() => desktop.openDataDir()}>Open</button>
    </div>
  );
}

const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const net = require("net");
const http = require("http");

let mainWindow = null;
let backend = null;
let port = null;
let dataDir = null;
let quitting = false;

const configPath = () => path.join(app.getPath("userData"), "config.json");
const logPath = () => path.join(app.getPath("userData"), "backend.log");

function readConfig() {
  try { return JSON.parse(fs.readFileSync(configPath(), "utf8")); } catch { return {}; }
}
function writeConfig(cfg) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
}

// ─── Data folder ───
async function pickDataDir(title, defaultPath) {
  const res = await dialog.showOpenDialog(mainWindow || undefined, {
    title,
    defaultPath,
    properties: ["openDirectory", "createDirectory"],
  });
  return res.canceled || !res.filePaths.length ? null : res.filePaths[0];
}

async function ensureDataDir() {
  const cfg = readConfig();
  if (cfg.dataDir) {
    fs.mkdirSync(cfg.dataDir, { recursive: true });
    return cfg.dataDir;
  }
  const fallback = path.join(app.getPath("documents"), "PursuitSimulator");
  const chosen = await pickDataDir(
    "Choose a folder to store your saved sessions and exports",
    fallback
  );
  const dir = chosen || fallback;
  fs.mkdirSync(dir, { recursive: true });
  writeConfig({ ...cfg, dataDir: dir });
  return dir;
}

// ─── Backend process ───
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function backendCommand() {
  if (app.isPackaged) {
    const exe = process.platform === "win32" ? "run_server.exe" : "run_server";
    return { cmd: path.join(process.resourcesPath, "backend", "run_server", exe), args: [String(port)], cwd: undefined };
  }
  // Dev: run the Python source directly. Override interpreter with PURSUIT_PYTHON.
  const backendDir = path.join(__dirname, "..", "pursuit-simulator-backend", "backend");
  return {
    cmd: process.env.PURSUIT_PYTHON || "python",
    args: [path.join(backendDir, "run_server.py"), String(port)],
    cwd: backendDir,
  };
}

function startBackend() {
  const { cmd, args, cwd } = backendCommand();
  fs.mkdirSync(path.dirname(logPath()), { recursive: true });
  const log = fs.openSync(logPath(), "a");
  backend = spawn(cmd, args, {
    cwd,
    env: { ...process.env, PURSUIT_DATA_DIR: dataDir },
    stdio: ["ignore", log, log],
    windowsHide: true,
  });
  backend.on("error", (e) => fs.appendFileSync(logPath(), `spawn error: ${e}\n`));
  backend.on("exit", (code) => {
    fs.appendFileSync(logPath(), `backend exited with code ${code}\n`);
    backend = null;
  });
}

function stopBackend() {
  return new Promise((resolve) => {
    if (!backend) return resolve();
    const b = backend;
    b.once("exit", () => resolve());
    if (process.platform === "win32") {
      // Kill the whole process tree (PyInstaller bootloader + child).
      spawn("taskkill", ["/pid", String(b.pid), "/T", "/F"], { windowsHide: true });
    } else {
      b.kill("SIGTERM");
    }
    setTimeout(resolve, 3000);
  });
}

function waitForBackend(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tryOnce = () => {
      if (!backend) return resolve(false);
      const req = http.get({ host: "127.0.0.1", port, path: "/", timeout: 1000 }, (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      });
      req.on("error", () => retry());
      req.on("timeout", () => { req.destroy(); retry(); });
    };
    const retry = () => (Date.now() > deadline ? resolve(false) : setTimeout(tryOnce, 300));
    tryOnce();
  });
}

// ─── Window ───
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 950,
    backgroundColor: "#080a0f",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--pursuit-port=${port}`],
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, "frontend-build", "index.html"));
  mainWindow.on("closed", () => { mainWindow = null; });
}

// ─── IPC ───
ipcMain.handle("get-data-dir", () => dataDir);

ipcMain.handle("open-data-dir", () => shell.openPath(dataDir));

ipcMain.handle("choose-data-dir", async () => {
  const next = await pickDataDir("Choose a new data folder", dataDir);
  if (!next || path.resolve(next) === path.resolve(dataDir)) return null;
  fs.mkdirSync(next, { recursive: true });
  writeConfig({ ...readConfig(), dataDir: next });
  dataDir = next;
  await stopBackend();
  startBackend();
  await waitForBackend();
  return next;
});

ipcMain.handle("save-file", async (_e, defaultName, text) => {
  const res = await dialog.showSaveDialog(mainWindow, {
    title: "Save CSV",
    defaultPath: path.join(readConfig().lastExportDir || app.getPath("documents"), defaultName),
    filters: [{ name: "CSV", extensions: ["csv"] }, { name: "All files", extensions: ["*"] }],
  });
  if (res.canceled || !res.filePath) return null;
  fs.writeFileSync(res.filePath, text, "utf8");
  writeConfig({ ...readConfig(), lastExportDir: path.dirname(res.filePath) });
  return res.filePath;
});

ipcMain.handle("copy-folder", async (_e, src) => {
  // Only copy folders that live inside the data directory.
  const resolved = path.resolve(src);
  const root = path.resolve(dataDir) + path.sep;
  if (!resolved.startsWith(root)) throw new Error("Refusing to copy a folder outside the data directory");

  const dest = await pickDataDir(
    "Choose where to save the exported folder",
    readConfig().lastExportDir || app.getPath("documents")
  );
  if (!dest) return null;
  const target = path.join(dest, path.basename(resolved));
  if (path.resolve(target) === resolved) return target;
  await fs.promises.cp(resolved, target, { recursive: true, force: true });
  writeConfig({ ...readConfig(), lastExportDir: dest });
  return target;
});

// ─── Lifecycle ───
app.whenReady().then(async () => {
  dataDir = await ensureDataDir();
  port = await freePort();
  startBackend();
  await waitForBackend(); // window still opens on failure so the UI can show the error screen
  createWindow();
});

app.on("before-quit", (e) => {
  if (quitting || !backend) return;
  e.preventDefault();
  quitting = true;
  stopBackend().then(() => app.quit());
});

app.on("window-all-closed", () => app.quit());

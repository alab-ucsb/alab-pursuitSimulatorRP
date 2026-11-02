const { contextBridge, ipcRenderer } = require("electron");

const arg = process.argv.find((a) => a.startsWith("--pursuit-port="));
const port = arg ? arg.split("=")[1] : "3080";

contextBridge.exposeInMainWorld("pursuit", {
  apiBase: `http://127.0.0.1:${port}`,
  getDataDir: () => ipcRenderer.invoke("get-data-dir"),
  chooseDataDir: () => ipcRenderer.invoke("choose-data-dir"),
  openDataDir: () => ipcRenderer.invoke("open-data-dir"),
  saveFile: (defaultName, text) => ipcRenderer.invoke("save-file", defaultName, text),
  copyFolder: (src) => ipcRenderer.invoke("copy-folder", src),
});

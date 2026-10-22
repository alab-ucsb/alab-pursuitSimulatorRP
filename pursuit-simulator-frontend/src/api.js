// Shared API base + local-save helpers.
// Inside the Electron app, window.pursuit is injected by preload.js. In a plain
// browser it is undefined and everything falls back to browser downloads.

export const desktop = typeof window !== "undefined" ? window.pursuit : undefined;

export const API =
  (desktop && desktop.apiBase) ||
  process.env.REACT_APP_API ||
  "http://localhost:3080";

// Save a single file. Desktop: native Save As dialog. Browser: normal download.
// Returns the saved path (desktop), or null if cancelled / browser download.
export async function saveBlobAs(blob, filename) {
  if (desktop) {
    const text = await blob.text();
    return desktop.saveFile(filename, text);
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return null;
}

// Copy a folder the backend wrote into the data library to a user-chosen
// location (named after the library folder). Returns the destination path, or
// null if cancelled / not desktop.
export async function exportFolderTo(libraryPath) {
  if (!desktop) return null;
  return desktop.copyFolder(libraryPath);
}

// Message shown after a folder export.
export function exportedMessage(result, destination) {
  const n = result.files.length;
  if (destination) return `Exported ${n} files to ${destination}`;
  if (desktop) return `Exported ${n} files to the data folder (${result.folder}). No copy location was chosen.`;
  return `Exported ${n} files to ${result.folder}`;
}

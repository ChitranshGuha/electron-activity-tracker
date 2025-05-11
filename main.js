// Disabled Squirrel startup and Electron logging if you need:
// if (require('electron-squirrel-startup')) return;
// const { app } = require('electron');
// app.commandLine.appendSwitch('disable-logging');

const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");
const { uIOhook } = require("uiohook-napi");
const activeWin = require("active-win");

// ─── Set up a writable data directory ────────────────────────────────────────
const dataDir     = app.getPath("userData");
const logFilePath = path.join(dataDir, "activity-log.json");
const textLogPath = path.join(dataDir, "activity-log.txt");

// Ensure the data folder exists
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// ─── Mouse throttle settings ─────────────────────────────────────────────────
const MOUSE_MOVE_THROTTLE_MS = 200;
let lastMouseMoveLog = 0;

// ─── Create the Electron window ───────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true
    }
  });
  win.loadFile("index.html");
}

// ─── Unified logger ────────────────────────────────────────────────────────────
function writeLog(entry) {
  // JSON log
  let logs = [];
  if (fs.existsSync(logFilePath)) {
    try { logs = JSON.parse(fs.readFileSync(logFilePath)); }
    catch { logs = []; }
  }
  logs.push(entry);
  fs.writeFileSync(logFilePath, JSON.stringify(logs, null, 2));

  // Plain-text log
  let detail = "";
  switch (entry.type) {
    case "keyboard":
      detail = `Keycode: ${entry.keycode}`; break;
    case "mousedown":
      detail = `Button: ${entry.button}`; break;
    case "mouse-move":
      detail = `X: ${entry.x}, Y: ${entry.y}`; break;
    case "mousewheel":
      detail = `Amount: ${entry.amount}, Rotation: ${entry.rotation}`; break;
    case "active-window":
      detail = `App: ${entry.app}, Title: "${entry.title}"`; break;
  }
  fs.appendFileSync(
    textLogPath,
    `[${entry.timestamp}] ${entry.type.toUpperCase()} ${detail}\n`
  );
}

// ─── Input tracking (keyboard, mouse, scroll) ────────────────────────────────
function startInputTracker() {
  // Keyboard down
  uIOhook.on("keydown", e => {
    writeLog({
      timestamp: new Date().toISOString(),
      type: "keyboard",
      keycode: e.keycode
    });
  });

  // Mouse click
  uIOhook.on("mousedown", e => {
    writeLog({
      timestamp: new Date().toISOString(),
      type: "mousedown",
      button: e.button
    });
  });

  // Throttled mouse move
  uIOhook.on("mousemove", e => {
    const now = Date.now();
    if (now - lastMouseMoveLog < MOUSE_MOVE_THROTTLE_MS) return;
    lastMouseMoveLog = now;
    writeLog({
      timestamp: new Date().toISOString(),
      type: "mouse-move",
      x: e.x,
      y: e.y
    });
  });

  // Mouse wheel (scroll)
  uIOhook.on("mousewheel", e => {
    writeLog({
      timestamp: new Date().toISOString(),
      type: "mousewheel",
      amount: e.amount,
      rotation: e.rotation
    });
  });

  uIOhook.start();
}

// ─── Active-window tracking ───────────────────────────────────────────────────
function startWindowTracker() {
  let previousId = null;
  setInterval(async () => {
    try {
      const info = await activeWin();
      if (info && info.id !== previousId) {
        previousId = info.id;
        writeLog({
          timestamp: new Date().toISOString(),
          type: "active-window",
          app: info.owner.name,
          title: info.title
        });
      }
    } catch (err) {
      console.error("active-win error:", err);
    }
  }, 1000);
}

// ─── App lifecycle ───────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  startInputTracker();
  startWindowTracker();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  uIOhook.stop();
  if (process.platform !== "darwin") app.quit();
});

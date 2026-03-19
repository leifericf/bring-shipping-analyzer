import { app, BrowserWindow, dialog } from 'electron';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Single-instance lock — prevent duplicate app windows
// ---------------------------------------------------------------------------

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Environment setup — must happen before any src/ imports
// ---------------------------------------------------------------------------

// In packaged mode, store the database in the OS app-data folder
// (e.g. ~/Library/Application Support/Bring Shipping Advisor/ on macOS,
//  %APPDATA%/Bring Shipping Advisor/ on Windows).
// In dev mode, use the project's data/ directory as usual.
if (app.isPackaged) {
  process.env.BRING_DATA_DIR = join(app.getPath('userData'), 'data');
}

// Tell server.mjs not to auto-start — we control the lifecycle here.
process.env.ELECTRON_MANAGED = '1';

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

let mainWindow = null;
let serverInstance = null;
let closeDb = null;

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Bring Shipping Advisor',
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(`http://localhost:${port}`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('ready', async () => {
  try {
    // Dynamic import so env vars are set before modules evaluate
    const { startServer } = await import('../src/server.mjs');
    const db = await import('../src/db.mjs');
    closeDb = db.closeDb;

    const { server, port } = await startServer();
    serverInstance = server;

    createWindow(port);
  } catch (err) {
    dialog.showErrorBox(
      'Startup Error',
      `Failed to start Bring Shipping Advisor:\n\n${err.message}\n\n`
      + 'If port 3000 is already in use, close the other application and try again.',
    );
    app.quit();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  if (serverInstance) {
    serverInstance.close();
    serverInstance = null;
  }
  if (closeDb) {
    closeDb();
    closeDb = null;
  }
});

app.on('activate', () => {
  // macOS: re-create window when dock icon is clicked and no windows are open
  if (mainWindow === null && serverInstance) {
    const addr = serverInstance.address();
    if (addr) createWindow(addr.port);
  }
});

app.on('second-instance', () => {
  // Focus the existing window when a second instance is attempted
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

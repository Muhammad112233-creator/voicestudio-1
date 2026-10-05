const { app, BrowserWindow, ipcMain, dialog, shell, globalShortcut, clipboard, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { spawn } = require('node:child_process');

const APP_DIR = __dirname;
let mainWindow;
let widgetWindow;
let widgetShortcutRegistered = false;
let jobCounter = 0;
const jobs = new Map();

function dataRoot() {
  return path.join(app.getPath('userData'), 'VoiceStudio');
}

async function ensureFolders() {
  await fs.mkdir(path.join(dataRoot(), 'imports'), { recursive: true });
  await fs.mkdir(path.join(dataRoot(), 'outputs'), { recursive: true });
  await fs.mkdir(path.join(dataRoot(), 'voices'), { recursive: true });
}

function safeName(name = 'asset') {
  const basename = path.basename(String(name)).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return (basename || 'asset').slice(0, 160);
}

function safeChildPath(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(resolvedRoot + path.sep);
}

function getMainWindow() {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1050,
    minHeight: 680,
    backgroundColor: '#0b0c12',
    title: 'VoiceStudio',
    show: false,
    webPreferences: {
      preload: path.join(APP_DIR, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });
  mainWindow.loadFile(path.join(APP_DIR, 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
}

function showDictationWidget() {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.show();
    widgetWindow.focus();
    return;
  }
  widgetWindow = new BrowserWindow({
    width: 390,
    height: 430,
    minWidth: 350,
    minHeight: 390,
    maxWidth: 520,
    maxHeight: 620,
    title: 'VoiceStudio Mini Dictation',
    backgroundColor: '#10121a',
    alwaysOnTop: true,
    skipTaskbar: true,
    frame: true,
    resizable: true,
    webPreferences: {
      preload: path.join(APP_DIR, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });
  widgetWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  widgetWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });
  widgetWindow.loadFile(path.join(APP_DIR, 'widget.html'));
  widgetWindow.on('closed', () => { widgetWindow = null; });
}

app.whenReady().then(async () => {
  await ensureFolders();
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const localAppWindow = webContents.getURL().startsWith('file://');
    callback(localAppWindow && permission === 'media');
  });
  createWindow();
  try { widgetShortcutRegistered = globalShortcut.register('CommandOrControl+Shift+Space', showDictationWidget); }
  catch (_) { widgetShortcutRegistered = false; }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => globalShortcut.unregisterAll());

app.on('window-all-closed', () => {
  for (const child of jobs.values()) {
    try { child.kill(); } catch (_) { /* already exited */ }
  }
  jobs.clear();
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('app:info', async () => ({
  name: 'VoiceStudio',
  version: app.getVersion(),
  platform: process.platform,
  architecture: os.arch(),
  dataDirectory: dataRoot(),
  widgetShortcut: 'CommandOrControl+Shift+Space',
  widgetShortcutRegistered,
  offlineByDesign: true
}));

ipcMain.handle('widget:open', async () => { showDictationWidget(); return widgetShortcutRegistered; });
ipcMain.handle('widget:close', async () => {
  if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.close();
  return true;
});
ipcMain.handle('widget:copy-text', async (_event, text) => {
  clipboard.writeText(String(text || ''));
  return true;
});

ipcMain.handle('state:load', async () => {
  const stateFile = path.join(dataRoot(), 'state.json');
  try { return JSON.parse(await fs.readFile(stateFile, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') console.warn('Could not read VoiceStudio state:', error.message);
    return null;
  }
});

ipcMain.handle('state:save', async (_event, state) => {
  const stateFile = path.join(dataRoot(), 'state.json');
  await fs.mkdir(dataRoot(), { recursive: true });
  const temporary = `${stateFile}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(state, null, 2), 'utf8');
  await fs.rename(temporary, stateFile);
  return true;
});

ipcMain.handle('asset:save', async (_event, { name, bytes }) => {
  await ensureFolders();
  const base = safeName(name);
  const ext = path.extname(base);
  const stem = path.basename(base, ext);
  const unique = `${stem}-${Date.now()}${ext}`;
  const target = path.join(dataRoot(), 'imports', unique);
  await fs.writeFile(target, Buffer.from(bytes));
  return { path: target, name: unique, size: (await fs.stat(target)).size };
});

ipcMain.handle('asset:read', async (_event, targetPath) => {
  const roots = [path.join(dataRoot(), 'imports'), path.join(dataRoot(), 'outputs'), path.join(dataRoot(), 'voices')];
  const allowed = roots.some(root => safeChildPath(root, targetPath));
  if (!allowed) throw new Error('For safety, VoiceStudio can only preview files in its local workspace.');
  const bytes = await fs.readFile(targetPath);
  return bytes.toString('base64');
});

ipcMain.handle('dialog:choose-path', async (_event, { kind = 'file', title = 'Choose a local file' } = {}) => {
  const properties = kind === 'directory' ? ['openDirectory'] : ['openFile'];
  const { canceled, filePaths } = await dialog.showOpenDialog(getMainWindow(), {
    title,
    properties,
    filters: kind === 'model' ? [
      { name: 'Local model files', extensions: ['onnx', 'pt', 'pth', 'safetensors', 'bin', 'json'] },
      { name: 'All files', extensions: ['*'] }
    ] : [{ name: 'All files', extensions: ['*'] }]
  });
  return canceled ? null : filePaths[0];
});

ipcMain.handle('dialog:save-copy', async (_event, { sourcePath, suggestedName }) => {
  const roots = [path.join(dataRoot(), 'imports'), path.join(dataRoot(), 'outputs'), path.join(dataRoot(), 'voices')];
  if (!roots.some(root => safeChildPath(root, sourcePath))) throw new Error('That file is outside the VoiceStudio workspace.');
  const { canceled, filePath } = await dialog.showSaveDialog(getMainWindow(), {
    title: 'Export from VoiceStudio',
    defaultPath: path.join(app.getPath('downloads'), safeName(suggestedName || path.basename(sourcePath))),
    properties: ['createDirectory', 'showOverwriteConfirmation']
  });
  if (canceled || !filePath) return null;
  await fs.copyFile(sourcePath, filePath);
  return filePath;
});

ipcMain.handle('dialog:save-bytes', async (_event, { name, bytes }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(getMainWindow(), {
    title: 'Save local audio',
    defaultPath: path.join(app.getPath('downloads'), safeName(name || 'VoiceStudio-export.wav')),
    properties: ['createDirectory', 'showOverwriteConfirmation']
  });
  if (canceled || !filePath) return null;
  await fs.writeFile(filePath, Buffer.from(bytes));
  return filePath;
});

ipcMain.handle('engine:run', async (event, request) => {
  await ensureFolders();
  const jobId = String(request.jobId || `job-${++jobCounter}`);
  const python = String(request.settings?.pythonPath || (process.platform === 'win32' ? 'python' : 'python3'));
  const bridge = path.join(APP_DIR, 'runtime', 'engine_bridge.py');
  const outputDir = path.join(dataRoot(), 'outputs');
  const payload = { ...request, outputDir, jobId };
  delete payload.settings; // send settings once, as an explicit bridge field
  payload.settings = request.settings || {};

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(python, [bridge], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      reject(new Error(`Could not start the local Python runtime: ${error.message}`));
      return;
    }
    jobs.set(jobId, child);
    let stdoutBuffer = '';
    let stderr = '';
    let finalResult = null;
    let finished = false;

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const message = JSON.parse(line);
          if (message.type === 'progress') {
            try { event.sender.send('engine:progress', { jobId, ...message }); } catch (_) { /* invoking window may have closed */ }
          } else if (message.type === 'result') {
            finalResult = message;
          }
        } catch (error) {
          console.warn('Ignoring non-JSON output from local engine:', line.slice(0, 240));
        }
      }
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-12000); });
    child.on('error', error => {
      jobs.delete(jobId);
      if (!finished) {
        finished = true;
        reject(new Error(`Could not launch ${python}. Check the Python path in Settings. ${error.message}`));
      }
    });
    child.on('close', code => {
      jobs.delete(jobId);
      if (stdoutBuffer.trim()) {
        try {
          const message = JSON.parse(stdoutBuffer);
          if (message.type === 'result') finalResult = message;
        } catch (_) { /* a partial diagnostic line is not a result */ }
      }
      if (finished) return;
      finished = true;
      if (finalResult) {
        if (code !== 0 && finalResult.ok) finalResult = { ...finalResult, ok: false, error: `Local engine exited with code ${code}.` };
        resolve(finalResult);
      } else {
        const detail = stderr.trim().split('\n').slice(-4).join(' ');
        resolve({ ok: false, error: detail || `Local engine exited with code ${code} without returning a result. Check the selected Python runtime and optional local packages.` });
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
});

ipcMain.handle('engine:cancel', async (_event, jobId) => {
  const child = jobs.get(String(jobId));
  if (!child) return false;
  child.kill();
  jobs.delete(String(jobId));
  return true;
});

ipcMain.handle('engine:probe', async (_event, settings = {}) => {
  const python = String(settings.pythonPath || (process.platform === 'win32' ? 'python' : 'python3'));
  const bridge = path.join(APP_DIR, 'runtime', 'engine_bridge.py');
  return new Promise(resolve => {
    let child;
    try { child = spawn(python, [bridge, '--probe'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (error) { resolve({ ok: false, error: error.message }); return; }
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    child.on('error', error => resolve({ ok: false, error: error.message }));
    child.on('close', code => {
      try { resolve(JSON.parse(stdout.trim())); }
      catch (_) { resolve({ ok: false, error: stderr.trim() || `Python probe exited with code ${code}.` }); }
    });
  });
});

ipcMain.handle('shell:show-data-folder', async () => {
  await ensureFolders();
  await shell.openPath(dataRoot());
  return dataRoot();
});

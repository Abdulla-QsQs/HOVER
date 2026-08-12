const { app, BrowserWindow, ipcMain, Notification, screen, shell } = require('electron');
const fs = require('node:fs/promises');
const { existsSync } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

let mainWindow;
let alarmTimer;
let boundsAnimation;
let boundsAnimationResolve;
let regularBounds;

const FULL_WINDOW = { width: 430, height: 620 };
const ISLAND_WINDOW = { width: 360, height: 82 };
const WINDOWS_APP_ID = 'com.hover.reminders';

const DEFAULT_STATE = {
  reminders: [],
  settings: { alwaysOnTop: true, islandMode: false }
};

function storagePath() {
  return path.join(app.getPath('userData'), 'reminders.json');
}

function appIconPath() {
  const candidate = path.join(__dirname, 'assets', 'hover.ico');
  return existsSync(candidate) ? candidate : undefined;
}

async function loadState() {
  try {
    const raw = await fs.readFile(storagePath(), 'utf8');
    const parsed = JSON.parse(raw);
    return {
      reminders: Array.isArray(parsed.reminders) ? parsed.reminders : [],
      settings: { ...DEFAULT_STATE.settings, ...(parsed.settings || {}) }
    };
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

async function saveState(nextState) {
  const target = storagePath();
  const temporary = `${target}.tmp`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(temporary, JSON.stringify(nextState, null, 2), 'utf8');
  await fs.rename(temporary, target);
}

let state = structuredClone(DEFAULT_STATE);

app.setName('HOVER');
if (process.platform === 'win32') app.setAppUserModelId(WINDOWS_APP_ID);

function localDateKey(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validTime(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function normaliseReminder(input, current = {}) {
  const next = {
    id: current.id || crypto.randomUUID(),
    title: String(input.title || '').trim().slice(0, 80),
    notes: String(input.notes || '').trim().slice(0, 280),
    date: validDate(input.date) ? input.date : localDateKey(),
    startTime: validTime(input.startTime) ? input.startTime : '09:00',
    endTime: validTime(input.endTime) ? input.endTime : '09:30',
    color: ['violet', 'coral', 'mint', 'sky', 'sun'].includes(input.color) ? input.color : 'violet',
    repeat: input.repeat === 'daily' ? 'daily' : 'none',
    alarm: input.alarm !== false,
    alarmMinutes: [0, 5, 10, 15, 30].includes(Number(input.alarmMinutes)) ? Number(input.alarmMinutes) : 0,
    completedDates: Array.isArray(current.completedDates) ? current.completedDates.slice(-365) : [],
    alertedKeys: Array.isArray(current.alertedKeys) ? current.alertedKeys.slice(-14) : []
  };

  if (!next.title) throw new Error('A reminder needs a title.');
  if (next.endTime <= next.startTime) throw new Error('End time must be after the start time.');
  return next;
}

async function broadcastState() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('reminders:changed', state);
}

function scheduledMoment(reminder, now) {
  const today = localDateKey(now);
  if (reminder.repeat === 'none' && reminder.date !== today) return null;
  const date = reminder.repeat === 'daily' ? today : reminder.date;
  const [hours, minutes] = reminder.startTime.split(':').map(Number);
  const moment = new Date(`${date}T00:00:00`);
  moment.setHours(hours, minutes - reminder.alarmMinutes, 0, 0);
  return moment;
}

async function checkAlarms() {
  const now = new Date();
  const today = localDateKey(now);
  let changed = false;

  for (const reminder of state.reminders) {
    if (!reminder.alarm) continue;
    if (reminder.completedDates?.includes(today)) continue;
    const moment = scheduledMoment(reminder, now);
    const alarmKey = `${today}:${reminder.id}:${reminder.alarmMinutes}`;
    const isFresh = moment && now >= moment && now - moment < 60_000;
    if (!isFresh || reminder.alertedKeys?.includes(alarmKey)) continue;

    reminder.alertedKeys = [...(reminder.alertedKeys || []), alarmKey].slice(-14);
    changed = true;
    if (Notification.isSupported()) {
      new Notification({
        title: reminder.alarmMinutes ? `In ${reminder.alarmMinutes} min · ${reminder.title}` : reminder.title,
        body: reminder.notes || `Scheduled for ${reminder.startTime}`,
        silent: false
      }).show();
    }
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('reminders:alarm', reminder);
  }
  if (changed) {
    await saveState(state);
    await broadcastState();
  }
}

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const initialSize = state.settings.islandMode ? ISLAND_WINDOW : FULL_WINDOW;
  mainWindow = new BrowserWindow({
    title: 'HOVER',
    width: initialSize.width,
    height: initialSize.height,
    minWidth: state.settings.islandMode ? 300 : 360,
    minHeight: state.settings.islandMode ? 72 : 500,
    x: Math.max(workArea.x + 20, workArea.x + workArea.width - initialSize.width - 25),
    y: Math.max(workArea.y + 20, workArea.y + 55),
    show: false,
    frame: false,
    transparent: true,
    roundedCorners: true,
    resizable: true,
    alwaysOnTop: state.settings.alwaysOnTop,
    skipTaskbar: false,
    backgroundColor: '#00000000',
    icon: appIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.setAlwaysOnTop(state.settings.alwaysOnTop, 'floating');
  if (!state.settings.islandMode) regularBounds = mainWindow.getBounds();
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
}

app.whenReady().then(async () => {
  state = await loadState();
  createWindow();
  alarmTimer = setInterval(checkAlarms, 20_000);
  checkAlarms();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => clearInterval(alarmTimer));

ipcMain.handle('reminders:get-state', () => state);

ipcMain.handle('reminders:create', async (_event, input) => {
  const reminder = normaliseReminder(input);
  state.reminders.push(reminder);
  await saveState(state);
  await broadcastState();
  return reminder;
});

ipcMain.handle('reminders:update', async (_event, id, input) => {
  const index = state.reminders.findIndex((reminder) => reminder.id === id);
  if (index === -1) throw new Error('That reminder no longer exists.');
  const existing = state.reminders[index];
  state.reminders[index] = normaliseReminder(input, existing);
  await saveState(state);
  await broadcastState();
  return state.reminders[index];
});

ipcMain.handle('reminders:remove', async (_event, id) => {
  state.reminders = state.reminders.filter((reminder) => reminder.id !== id);
  await saveState(state);
  await broadcastState();
});

ipcMain.handle('reminders:toggle-complete', async (_event, id, date) => {
  if (!validDate(date)) throw new Error('Invalid completion date.');
  const reminder = state.reminders.find((item) => item.id === id);
  if (!reminder) throw new Error('That reminder no longer exists.');
  const completedDates = new Set(Array.isArray(reminder.completedDates) ? reminder.completedDates : []);
  if (completedDates.has(date)) completedDates.delete(date);
  else completedDates.add(date);
  reminder.completedDates = [...completedDates].sort().slice(-365);
  await saveState(state);
  await broadcastState();
  return completedDates.has(date);
});

ipcMain.handle('reminders:set-topmost', async (_event, enabled) => {
  state.settings.alwaysOnTop = Boolean(enabled);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(state.settings.alwaysOnTop, 'floating');
  await saveState(state);
  await broadcastState();
  return state.settings.alwaysOnTop;
});

function animateWindowBounds(target, duration = 360) {
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve();
  clearInterval(boundsAnimation);
  if (boundsAnimationResolve) boundsAnimationResolve();
  const start = mainWindow.getBounds();
  const startedAt = Date.now();
  return new Promise((resolve) => {
    boundsAnimationResolve = resolve;
    boundsAnimation = setInterval(() => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        clearInterval(boundsAnimation);
        boundsAnimationResolve = undefined;
        resolve();
        return;
      }
      const progress = Math.min(1, (Date.now() - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = (from, to) => Math.round(from + (to - from) * eased);
      mainWindow.setBounds({
        x: value(start.x, target.x),
        y: value(start.y, target.y),
        width: value(start.width, target.width),
        height: value(start.height, target.height)
      });
      if (progress >= 1) {
        clearInterval(boundsAnimation);
        boundsAnimation = undefined;
        boundsAnimationResolve = undefined;
        resolve();
      }
    }, 16);
  });
}

ipcMain.handle('app:set-island-mode', async (_event, enabled) => {
  const nextMode = Boolean(enabled);
  if (!mainWindow || mainWindow.isDestroyed()) return nextMode;
  const current = mainWindow.getBounds();
  state.settings.islandMode = nextMode;

  if (nextMode) {
    regularBounds = current.height > 200 ? current : regularBounds;
    mainWindow.setMinimumSize(300, 72);
    await saveState(state);
    await broadcastState();
    await animateWindowBounds({
      x: Math.round(current.x + (current.width - ISLAND_WINDOW.width) / 2),
      y: current.y,
      ...ISLAND_WINDOW
    });
  } else {
    const fallback = {
      x: Math.round(current.x + (current.width - FULL_WINDOW.width) / 2),
      y: current.y,
      ...FULL_WINDOW
    };
    await saveState(state);
    await broadcastState();
    await animateWindowBounds(regularBounds || fallback);
    mainWindow.setMinimumSize(360, 500);
  }
  return nextMode;
});

ipcMain.handle('app:create-desktop-shortcut', () => {
  if (process.platform !== 'win32') {
    return { ok: false, message: 'Desktop shortcuts are available on Windows only.' };
  }

  const shortcutPath = path.join(app.getPath('desktop'), 'HOVER.lnk');
  const icon = app.isPackaged ? process.execPath : appIconPath();
  const ok = shell.writeShortcutLink(shortcutPath, existsSync(shortcutPath) ? 'replace' : 'create', {
    target: process.execPath,
    args: app.isPackaged ? '' : `"${app.getAppPath()}"`,
    description: 'HOVER reminders',
    cwd: app.getAppPath(),
    appUserModelId: WINDOWS_APP_ID,
    ...(icon ? { icon, iconIndex: 0 } : {})
  });
  return ok
    ? { ok: true, message: 'HOVER desktop shortcut refreshed.' }
    : { ok: false, message: 'Windows could not create the desktop shortcut.' };
});

ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:close', () => mainWindow?.close());

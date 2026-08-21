const { app, BrowserWindow, ipcMain, Menu, Notification, screen, shell, Tray } = require('electron');
const fs = require('node:fs/promises');
const { existsSync } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const QRCode = require('qrcode');

let mainWindow;
let alarmTimer;
let boundsAnimation;
let boundsAnimationResolve;
let regularBounds;
let cloudSyncTimer;
let cloudSyncPromise;
let tray;
let isQuitting = false;

const FULL_WINDOW = { width: 430, height: 620 };
const ISLAND_WINDOW = { width: 360, height: 82 };
const WINDOWS_APP_ID = 'com.hover.reminders';
const CLOUD_BASE_URL = process.env.HOVER_CLOUD_URL || 'https://hover-reminder.pages.dev';

const DEFAULT_STATE = {
  reminders: [],
  settings: { alwaysOnTop: true, islandMode: false, runInBackground: true, openAtLogin: true },
  cloud: {
    paired: false,
    token: '',
    username: '',
    desktopName: os.hostname(),
    lastSync: null,
    status: 'offline',
    pendingPair: null,
    deletedIds: []
  }
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
      settings: { ...DEFAULT_STATE.settings, ...(parsed.settings || {}) },
      cloud: {
        ...DEFAULT_STATE.cloud,
        ...(parsed.cloud || {}),
        desktopName: parsed.cloud?.desktopName || os.hostname(),
        deletedIds: Array.isArray(parsed.cloud?.deletedIds) ? parsed.cloud.deletedIds : []
      }
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

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();

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
    alertedKeys: Array.isArray(current.alertedKeys) ? current.alertedKeys.slice(-14) : [],
    updatedAt: typeof input.updatedAt === 'string' && !Number.isNaN(Date.parse(input.updatedAt))
      ? input.updatedAt
      : new Date().toISOString()
  };

  if (!next.title) throw new Error('A reminder needs a title.');
  if (next.endTime <= next.startTime) throw new Error('End time must be after the start time.');
  return next;
}

async function broadcastState() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('reminders:changed', publicState());
}

function publicState() {
  return {
    reminders: state.reminders,
    settings: state.settings,
    cloud: {
      paired: state.cloud.paired,
      username: state.cloud.username,
      desktopName: state.cloud.desktopName,
      lastSync: state.cloud.lastSync,
      status: state.cloud.status,
      pairCode: state.cloud.pendingPair?.code || ''
    }
  };
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

async function cloudRequest(pathname, { method = 'GET', body, token = state.cloud.token } = {}) {
  const response = await fetch(`${CLOUD_BASE_URL}${pathname}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8_000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HOVER cloud returned ${response.status}.`);
  return payload;
}

function cloudReminder(reminder) {
  return {
    id: reminder.id,
    title: reminder.title,
    notes: reminder.notes || '',
    dateKey: reminder.date,
    startTime: reminder.startTime,
    endTime: reminder.endTime,
    color: reminder.color,
    repeat: reminder.repeat,
    alarm: reminder.alarm,
    alarmMinutes: reminder.alarmMinutes,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    updatedAt: reminder.updatedAt || new Date().toISOString()
  };
}

function localReminder(reminder) {
  return normaliseReminder({
    ...reminder,
    date: reminder.dateKey,
    updatedAt: reminder.updatedAt
  }, {
    id: reminder.id,
    completedDates: [],
    alertedKeys: []
  });
}

function completionId(reminderId, date) {
  return `${reminderId}:${date}`;
}

async function uploadReminder(reminder) {
  if (!state.cloud.paired || !state.cloud.token) return;
  await cloudRequest(`/api/reminders/${encodeURIComponent(reminder.id)}`, {
    method: 'PUT',
    body: cloudReminder(reminder)
  });
}

async function uploadCompletion(reminder, date, completed) {
  if (!state.cloud.paired || !state.cloud.token) return;
  const id = completionId(reminder.id, date);
  if (!completed) {
    await cloudRequest(`/api/completions/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return;
  }
  await cloudRequest('/api/completions', {
    method: 'POST',
    body: {
      id,
      reminderId: reminder.id,
      title: reminder.title,
      startTime: reminder.startTime,
      dateKey: date,
      color: reminder.color,
      completedAt: new Date().toISOString()
    }
  });
}

async function runCloudOperation(operation) {
  if (!state.cloud.paired || !state.cloud.token) return;
  try {
    await operation();
    state.cloud.status = 'online';
    state.cloud.lastSync = new Date().toISOString();
  } catch {
    state.cloud.status = 'offline';
  }
  await saveState(state);
  await broadcastState();
}

async function syncCloud() {
  if (!state.cloud.paired || !state.cloud.token) return { ok: false, message: 'Pair a phone before syncing.' };
  if (cloudSyncPromise) return cloudSyncPromise;

  cloudSyncPromise = (async () => {
    state.cloud.status = 'syncing';
    await broadcastState();
    try {
      for (const id of state.cloud.deletedIds) {
        await cloudRequest(`/api/reminders/${encodeURIComponent(id)}`, { method: 'DELETE' });
      }
      state.cloud.deletedIds = [];

      const payload = await cloudRequest('/api/sync');
      const deletedIds = new Set(Array.isArray(payload.deletedReminderIds) ? payload.deletedReminderIds : []);
      const localById = new Map(state.reminders.filter((item) => !deletedIds.has(item.id)).map((item) => [item.id, item]));
      const remoteReminders = Array.isArray(payload.reminders) ? payload.reminders : [];

      for (const remote of remoteReminders) {
        const local = localById.get(remote.id);
        if (!local || String(remote.updatedAt || '') > String(local.updatedAt || '')) {
          const replacement = localReminder(remote);
          replacement.completedDates = local?.completedDates || [];
          replacement.alertedKeys = local?.alertedKeys || [];
          localById.set(remote.id, replacement);
        }
      }

      state.reminders = [...localById.values()];
      for (const reminder of state.reminders) await uploadReminder(reminder);

      const history = Array.isArray(payload.history) ? payload.history : [];
      for (const completion of history) {
        const reminder = state.reminders.find((item) => item.id === completion.reminderId);
        if (!reminder || !validDate(completion.dateKey)) continue;
        reminder.completedDates = [...new Set([...(reminder.completedDates || []), completion.dateKey])].sort().slice(-365);
      }
      for (const reminder of state.reminders) {
        for (const date of reminder.completedDates || []) await uploadCompletion(reminder, date, true);
      }

      state.cloud.username = payload.profile?.username || state.cloud.username;
      state.cloud.lastSync = new Date().toISOString();
      state.cloud.status = 'online';
      await saveState(state);
      await broadcastState();
      return { ok: true, message: 'HOVER is synced.' };
    } catch (error) {
      state.cloud.status = 'offline';
      await saveState(state);
      await broadcastState();
      return { ok: false, message: error.message || 'HOVER could not reach the cloud.' };
    } finally {
      cloudSyncPromise = null;
    }
  })();

  return cloudSyncPromise;
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  if (tray || !appIconPath()) return;
  tray = new Tray(appIconPath());
  tray.setToolTip('HOVER reminders');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open HOVER', click: showMainWindow },
    { type: 'separator' },
    {
      label: 'Quit HOVER',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]));
  tray.on('double-click', showMainWindow);
}

function applyLoginSettings() {
  if (!app.isPackaged || process.platform !== 'win32') return;
  app.setLoginItemSettings({
    openAtLogin: state.settings.openAtLogin !== false,
    path: process.execPath,
    args: ['--background'],
  });
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
  mainWindow.once('ready-to-show', () => {
    if (!process.argv.includes('--background')) mainWindow.show();
  });
  mainWindow.on('close', (event) => {
    if (!isQuitting && state.settings.runInBackground !== false) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

app.whenReady().then(async () => {
  state = await loadState();
  applyLoginSettings();
  createWindow();
  createTray();
  alarmTimer = setInterval(checkAlarms, 20_000);
  cloudSyncTimer = setInterval(() => void syncCloud(), 60_000);
  checkAlarms();
  if (state.cloud.paired) void syncCloud();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('second-instance', showMainWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && state.settings.runInBackground === false) app.quit();
});
app.on('before-quit', () => {
  isQuitting = true;
  clearInterval(alarmTimer);
  clearInterval(cloudSyncTimer);
});

ipcMain.handle('reminders:get-state', () => publicState());

ipcMain.handle('pairing:start', async (_event, platform = 'mobile') => {
  const session = await cloudRequest('/api/pair/sessions', {
    method: 'POST',
    token: '',
    body: { desktopName: state.cloud.desktopName || os.hostname(), platform: String(platform).slice(0, 24) }
  });
  state.cloud.pendingPair = {
    code: session.code,
    secret: session.secret,
    expiresAt: session.expiresAt
  };
  state.cloud.status = 'pairing';
  await saveState(state);
  await broadcastState();
  const qrDataUrl = await QRCode.toDataURL(session.pairUrl, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 224,
    color: { dark: '#11191d', light: '#ffffff' }
  });
  return { code: session.code, expiresAt: session.expiresAt, qrDataUrl, pairUrl: session.pairUrl };
});

ipcMain.handle('pairing:status', async () => {
  const pending = state.cloud.pendingPair;
  if (!pending) return { status: state.cloud.paired ? 'paired' : 'idle' };
  try {
    const payload = await cloudRequest(
      `/api/pair/sessions/${encodeURIComponent(pending.code)}?secret=${encodeURIComponent(pending.secret)}`,
      { token: '' }
    );
    if (payload.status !== 'paired') return { status: 'pending', code: pending.code, expiresAt: pending.expiresAt };
    state.cloud.token = payload.token;
    state.cloud.paired = true;
    state.cloud.username = payload.profile?.username || '';
    state.cloud.pendingPair = null;
    state.cloud.status = 'online';
    await saveState(state);
    await syncCloud();
    return { status: 'paired', username: state.cloud.username };
  } catch (error) {
    const expired = Date.parse(pending.expiresAt) <= Date.now();
    if (expired) {
      state.cloud.pendingPair = null;
      state.cloud.status = 'offline';
      await saveState(state);
    }
    return { status: expired ? 'expired' : 'pending', message: error.message };
  }
});

ipcMain.handle('pairing:cancel', async () => {
  state.cloud.pendingPair = null;
  state.cloud.status = state.cloud.paired ? 'online' : 'offline';
  await saveState(state);
  await broadcastState();
  return { ok: true };
});

ipcMain.handle('pairing:unpair', async () => {
  state.cloud = { ...structuredClone(DEFAULT_STATE.cloud), desktopName: state.cloud.desktopName || os.hostname() };
  await saveState(state);
  await broadcastState();
  return { ok: true };
});

ipcMain.handle('cloud:sync-now', () => syncCloud());

ipcMain.handle('reminders:create', async (_event, input) => {
  const reminder = normaliseReminder(input);
  state.reminders.push(reminder);
  await saveState(state);
  await broadcastState();
  void runCloudOperation(() => uploadReminder(reminder));
  return reminder;
});

ipcMain.handle('reminders:update', async (_event, id, input) => {
  const index = state.reminders.findIndex((reminder) => reminder.id === id);
  if (index === -1) throw new Error('That reminder no longer exists.');
  const existing = state.reminders[index];
  state.reminders[index] = normaliseReminder(input, existing);
  await saveState(state);
  await broadcastState();
  void runCloudOperation(() => uploadReminder(state.reminders[index]));
  return state.reminders[index];
});

ipcMain.handle('reminders:remove', async (_event, id) => {
  state.reminders = state.reminders.filter((reminder) => reminder.id !== id);
  state.cloud.deletedIds = [...new Set([...(state.cloud.deletedIds || []), id])].slice(-500);
  await saveState(state);
  await broadcastState();
  void runCloudOperation(async () => {
    await cloudRequest(`/api/reminders/${encodeURIComponent(id)}`, { method: 'DELETE' });
    state.cloud.deletedIds = state.cloud.deletedIds.filter((item) => item !== id);
  });
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
  void runCloudOperation(() => uploadCompletion(reminder, date, completedDates.has(date)));
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

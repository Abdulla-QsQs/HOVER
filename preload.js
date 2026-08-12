const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('reminders', {
  getState: () => ipcRenderer.invoke('reminders:get-state'),
  create: (reminder) => ipcRenderer.invoke('reminders:create', reminder),
  update: (id, reminder) => ipcRenderer.invoke('reminders:update', id, reminder),
  remove: (id) => ipcRenderer.invoke('reminders:remove', id),
  toggleComplete: (id, date) => ipcRenderer.invoke('reminders:toggle-complete', id, date),
  setTopmost: (enabled) => ipcRenderer.invoke('reminders:set-topmost', enabled),
  setIslandMode: (enabled) => ipcRenderer.invoke('app:set-island-mode', enabled),
  createDesktopShortcut: () => ipcRenderer.invoke('app:create-desktop-shortcut'),
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),
  onChange: (callback) => ipcRenderer.on('reminders:changed', (_event, state) => callback(state)),
  onAlarm: (callback) => ipcRenderer.on('reminders:alarm', (_event, reminder) => callback(reminder))
});

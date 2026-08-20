const { contextBridge } = require('electron');

function localDateKey(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

const today = localDateKey();
const islandMode = process.argv.includes('--snapshot-island');
const pairingMode = process.argv.includes('--snapshot-pairing') || process.argv.includes('--snapshot-pairing-qr');

const state = {
  settings: { alwaysOnTop: true, islandMode },
  cloud: {
    paired: !pairingMode,
    username: pairingMode ? '' : 'hover-preview',
    desktopName: 'HOVER-PREVIEW',
    lastSync: new Date().toISOString(),
    status: pairingMode ? 'offline' : 'online',
    forcePairingPrompt: pairingMode,
    forcePairingQr: process.argv.includes('--snapshot-pairing-qr'),
    snapshotQrUrl: '../docs/screenshots/hover-qr-fixture.png'
  },
  reminders: [
    {
      id: 'snapshot-focus',
      title: 'Morning focus',
      notes: 'Start with the most important task.',
      date: today,
      startTime: '08:15',
      endTime: '09:15',
      color: 'sky',
      repeat: 'none',
      alarm: true,
      alarmMinutes: 10,
      completedDates: [],
      alertedKeys: []
    },
    {
      id: 'snapshot-planning',
      title: 'Plan the launch',
      notes: 'Review the final checklist.',
      date: today,
      startTime: '10:00',
      endTime: '11:15',
      color: 'violet',
      repeat: 'none',
      alarm: true,
      alarmMinutes: 5,
      completedDates: [],
      alertedKeys: []
    },
    {
      id: 'snapshot-reset',
      title: 'Walk + reset',
      notes: '',
      date: today,
      startTime: '12:15',
      endTime: '12:45',
      color: 'mint',
      repeat: 'daily',
      alarm: false,
      alarmMinutes: 0,
      completedDates: [],
      alertedKeys: []
    }
  ]
};

contextBridge.exposeInMainWorld('reminders', {
  getState: async () => state,
  create: async () => undefined,
  update: async () => undefined,
  remove: async () => undefined,
  toggleComplete: async () => true,
  setTopmost: async () => true,
  setIslandMode: async () => true,
  createDesktopShortcut: async () => ({ ok: true, message: 'Shortcut ready.' }),
  startPairing: async () => ({ code: 'HVR7K2', qrDataUrl: '', expiresAt: new Date(Date.now() + 600_000).toISOString() }),
  pairingStatus: async () => ({ status: 'pending' }),
  cancelPairing: async () => ({ ok: true }),
  unpair: async () => ({ ok: true }),
  syncNow: async () => ({ ok: true, message: 'HOVER is synced.' }),
  minimize: () => undefined,
  close: () => undefined,
  onChange: () => undefined,
  onAlarm: () => undefined
});

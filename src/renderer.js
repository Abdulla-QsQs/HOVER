const HOURS_START = 7;
const HOURS_END = 22;
const HOUR_HEIGHT = 60;

const el = (id) => document.getElementById(id);
const refs = {
  dayLabel: el('day-label'), dateHeading: el('date-heading'), summary: el('summary'),
  calendarGrid: el('calendar-grid'), eventLayer: el('event-layer'), calendarScroll: el('calendar-scroll'),
  islandView: el('island-view'), islandTitle: el('island-title'), islandTime: el('island-time'), islandComplete: el('island-complete'),
  liveClock: el('live-clock'), topmost: el('topmost'), goToday: el('go-today'), editor: el('editor'), editorTitle: el('editor-title'),
  form: el('reminder-form'), formError: el('form-error'), delete: el('delete-reminder'), toast: el('alarm-toast'),
  id: el('reminder-id'), title: el('title'), notes: el('notes'), date: el('date'), repeat: el('repeat'),
  start: el('start-time'), end: el('end-time'), alarm: el('alarm'), alarmMinutes: el('alarm-minutes'),
  pairPanel: el('pairing-panel'), pairIntro: el('pairing-intro'), pairCodeStep: el('pairing-code-step'),
  pairSuccess: el('pairing-success'), pairQr: el('pairing-qr'), pairCode: el('pairing-code'),
  pairStatus: el('pairing-status'), pairSuccessCopy: el('pairing-success-copy'), pairButton: el('pair-phone')
};

let appState = {
  reminders: [],
  settings: { alwaysOnTop: true, islandMode: false },
  cloud: { paired: false, username: '', desktopName: '', lastSync: null, status: 'offline' }
};
let selectedDate = startOfDay(new Date());
let toastTimer;
let pairingPollTimer;

function startOfDay(date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function dateFromKey(key) { const [year, month, day] = key.split('-').map(Number); return new Date(year, month - 1, day); }
function isToday(date) { return dateKey(date) === dateKey(new Date()); }
function minutesFromTime(time) { const [h, m] = time.split(':').map(Number); return h * 60 + m; }
function shortTime(time) { return new Date(`2000-01-01T${time}:00`).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
function timeFromMinutes(minutes) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function buildGrid() {
  refs.calendarGrid.innerHTML = '';
  for (let hour = HOURS_START; hour <= HOURS_END; hour += 1) {
    const row = document.createElement('div');
    row.className = 'hour-row';
    const label = document.createElement('span');
    label.className = 'hour-label';
    label.textContent = new Date(2000, 0, 1, hour).toLocaleTimeString([], { hour: 'numeric' });
    row.append(label);
    refs.calendarGrid.append(row);
  }
}

function occursOnDate(reminder, currentKey) {
  return reminder.date === currentKey || (reminder.repeat === 'daily' && reminder.date <= currentKey);
}

function isCompletedOnDate(reminder, currentKey) {
  return Array.isArray(reminder.completedDates) && reminder.completedDates.includes(currentKey);
}

function eventsForDate(currentKey) {
  return appState.reminders
    .filter((reminder) => occursOnDate(reminder, currentKey) && !isCompletedOnDate(reminder, currentKey))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
}

function eventsForSelectedDay() { return eventsForDate(dateKey(selectedDate)); }

function formatSummary(events) {
  if (!events.length) return 'Nothing planned yet.';
  if (events.length === 1) return `1 reminder · ${shortTime(events[0].startTime)}`;
  return `${events.length} reminders · next at ${shortTime(events[0].startTime)}`;
}

function renderHeader(events) {
  const today = isToday(selectedDate);
  refs.dayLabel.textContent = today ? 'TODAY' : 'SELECTED DAY';
  refs.dateHeading.textContent = selectedDate.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  refs.summary.textContent = formatSummary(events);
  refs.topmost.checked = appState.settings.alwaysOnTop;
  refs.goToday.textContent = today ? 'Today' : 'Go to today';
  refs.goToday.disabled = today;
  refs.goToday.setAttribute('aria-label', today ? 'Viewing today' : 'Return to today');
}

function renderIsland() {
  const todayKey = dateKey(new Date());
  const currentMinutes = new Date().getHours() * 60 + new Date().getMinutes();
  const todayReminders = eventsForDate(todayKey);
  const nextReminder = todayReminders.find((reminder) => minutesFromTime(reminder.endTime) >= currentMinutes) || todayReminders[0];
  document.body.classList.toggle('island-mode', Boolean(appState.settings.islandMode));
  refs.islandView.classList.remove('completing');
  refs.islandView.removeAttribute('aria-busy');
  refs.islandComplete.disabled = !nextReminder;
  refs.islandComplete.dataset.reminderId = nextReminder?.id || '';

  if (!nextReminder) {
    refs.islandTitle.textContent = 'No more reminders';
    refs.islandTime.textContent = 'Today is clear';
    return;
  }

  refs.islandTitle.textContent = nextReminder.title;
  const overdue = minutesFromTime(nextReminder.endTime) < currentMinutes;
  refs.islandTime.textContent = overdue
    ? `Overdue · ${shortTime(nextReminder.startTime)}`
    : `${shortTime(nextReminder.startTime)} – ${shortTime(nextReminder.endTime)}`;
}

async function completeReminder(reminder, completionDate, source) {
  if (!reminder || !source?.isConnected) return;
  source.classList.add('completing');
  source.setAttribute('aria-busy', 'true');
  await new Promise((resolve) => setTimeout(resolve, 260));
  try {
    await window.reminders.toggleComplete(reminder.id, completionDate);
    showToast(`Completed · ${reminder.title}`);
  } catch (error) {
    source.classList.remove('completing');
    source.removeAttribute('aria-busy');
    showToast(error.message || 'Could not complete this reminder.');
  }
}

function attachBlockInteraction(block, reminder, timeLabel) {
  const originalStart = minutesFromTime(reminder.startTime);
  const duration = minutesFromTime(reminder.endTime) - originalStart;
  let pressTimer;
  let pointerId;
  let pressY = 0;
  let dragging = false;
  let pressCancelled = false;
  let nextStart = originalStart;

  const clearHold = () => {
    clearTimeout(pressTimer);
    block.classList.remove('holding');
  };

  const resetDragVisuals = () => {
    clearHold();
    dragging = false;
    block.classList.remove('dragging');
    refs.calendarScroll.classList.remove('drag-mode');
  };

  block.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.complete-button')) return;
    if (event.button !== 0) return;
    pointerId = event.pointerId;
    pressY = event.clientY;
    pressCancelled = false;
    nextStart = originalStart;
    block.setPointerCapture(pointerId);
    block.classList.add('holding');
    pressTimer = setTimeout(() => {
      dragging = true;
      block.classList.remove('holding');
      block.classList.add('dragging');
      refs.calendarScroll.classList.add('drag-mode');
    }, 360);
  });

  block.addEventListener('pointermove', (event) => {
    const deltaY = event.clientY - pressY;
    if (!dragging) {
      if (Math.abs(deltaY) > 7) {
        pressCancelled = true;
        clearHold();
      }
      return;
    }

    event.preventDefault();
    const snappedDelta = Math.round(deltaY / 15) * 15;
    const earliest = HOURS_START * 60;
    const latest = HOURS_END * 60 - duration;
    nextStart = Math.min(latest, Math.max(earliest, originalStart + snappedDelta));
    const nextEnd = nextStart + duration;
    block.style.top = `${nextStart - earliest}px`;
    timeLabel.textContent = `${shortTime(timeFromMinutes(nextStart))} – ${shortTime(timeFromMinutes(nextEnd))}`;
  });

  block.addEventListener('pointerup', async (event) => {
    if (event.target.closest('.complete-button')) return;
    const wasDragging = dragging;
    clearHold();
    if (block.hasPointerCapture(event.pointerId)) block.releasePointerCapture(event.pointerId);
    resetDragVisuals();

    if (!wasDragging && !pressCancelled) {
      openEditor(reminder);
      return;
    }

    if (!wasDragging) return;

    if (nextStart === originalStart) {
      render();
      return;
    }

    const nextEnd = nextStart + duration;
    try {
      await window.reminders.update(reminder.id, {
        ...reminder,
        startTime: timeFromMinutes(nextStart),
        endTime: timeFromMinutes(nextEnd)
      });
      showToast(`Moved to ${shortTime(timeFromMinutes(nextStart))}`);
    } catch (error) {
      render();
      showToast(error.message || 'Could not move this reminder.');
    }
  });

  block.addEventListener('pointercancel', () => {
    resetDragVisuals();
    render();
  });

  block.addEventListener('pointerleave', () => {
    if (!dragging) clearHold();
  });
}

function renderEvents(events) {
  refs.eventLayer.innerHTML = '';
  events.forEach((reminder, index) => {
    const startMinute = minutesFromTime(reminder.startTime);
    const endMinute = minutesFromTime(reminder.endTime);
    const top = startMinute - HOURS_START * 60;
    const height = Math.max(endMinute - startMinute, 30);
    if (endMinute <= HOURS_START * 60 || startMinute >= HOURS_END * 60) return;
    const block = document.createElement('div');
    block.className = `event-block ${reminder.color}`;
    block.setAttribute('role', 'button');
    block.tabIndex = 0;
    block.style.animationDelay = `${Math.min(index, 8) * 32}ms`;
    block.style.top = `${Math.max(top, 0)}px`;
    block.style.height = `${Math.min(height, HOURS_END * 60 - Math.max(startMinute, HOURS_START * 60))}px`;
    block.title = `Click to edit · Hold to move ${reminder.title}`;
    block.setAttribute('aria-label', `${reminder.title}. Click to edit, or hold and drag to change its time.`);
    block.dataset.id = reminder.id;
    const complete = document.createElement('button');
    complete.className = 'complete-button';
    complete.type = 'button';
    complete.setAttribute('aria-label', `Mark ${reminder.title} complete`);
    complete.addEventListener('pointerdown', (event) => event.stopPropagation());
    complete.addEventListener('pointerup', (event) => event.stopPropagation());
    complete.addEventListener('click', (event) => {
      event.stopPropagation();
      completeReminder(reminder, dateKey(selectedDate), block);
    });
    const title = document.createElement('span');
    title.className = 'event-title';
    title.textContent = reminder.title;
    const time = document.createElement('span');
    time.className = 'event-time';
    time.textContent = `${shortTime(reminder.startTime)} – ${shortTime(reminder.endTime)}`;
    block.append(complete, title, time);
    attachBlockInteraction(block, reminder, time);
    block.addEventListener('keydown', (event) => {
      if (event.target !== block || !['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      openEditor(reminder);
    });
    refs.eventLayer.append(block);
  });
}

function renderNowLine() {
  const old = document.querySelector('.now-line');
  if (old) old.remove();
  if (!isToday(selectedDate)) return;
  const now = new Date();
  const minute = now.getHours() * 60 + now.getMinutes();
  if (minute < HOURS_START * 60 || minute > HOURS_END * 60) return;
  const line = document.createElement('div');
  line.className = 'now-line';
  line.style.top = `${minute - HOURS_START * 60}px`;
  refs.calendarScroll.append(line);
}

function render({ scrollToNow = false } = {}) {
  const events = eventsForSelectedDay();
  renderIsland();
  renderHeader(events);
  renderCloudState();
  renderEvents(events);
  renderNowLine();
  if (scrollToNow && isToday(selectedDate)) {
    const now = new Date();
    refs.calendarScroll.scrollTop = Math.max(0, (now.getHours() - HOURS_START - 1) * HOUR_HEIGHT);
  }
}

function renderCloudState() {
  const cloud = appState.cloud || {};
  refs.pairButton.textContent = cloud.paired ? 'Phone' : 'Pair';
  refs.pairButton.dataset.paired = cloud.paired ? 'true' : 'false';
  refs.pairButton.title = cloud.paired
    ? `${cloud.username ? `@${cloud.username}` : 'HOVER'} · ${cloud.status === 'syncing' ? 'Syncing' : 'Connected'}`
    : 'Pair HOVER with iPhone or Android';
}

function showPairingStep(step) {
  refs.pairIntro.hidden = step !== 'intro';
  refs.pairCodeStep.hidden = step !== 'code';
  refs.pairSuccess.hidden = step !== 'success';
}

function openPairing() {
  if (refs.editor.classList.contains('open')) closeEditor();
  clearInterval(pairingPollTimer);
  document.body.classList.add('pairing-open');
  refs.pairPanel.classList.add('open');
  refs.pairPanel.setAttribute('aria-hidden', 'false');
  if (appState.cloud?.paired) {
    refs.pairSuccessCopy.textContent = `@${appState.cloud.username || 'hover'} is connected. HOVER syncs in the background.`;
    showPairingStep('success');
  } else {
    showPairingStep('intro');
  }
}

async function closePairing({ cancel = false } = {}) {
  clearInterval(pairingPollTimer);
  pairingPollTimer = undefined;
  if (cancel && !refs.pairCodeStep.hidden) await window.reminders.cancelPairing();
  refs.pairPanel.classList.remove('open');
  refs.pairPanel.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('pairing-open');
}

async function startPairing(platform) {
  showPairingStep('code');
  refs.pairStatus.textContent = 'Creating a secure pairing code…';
  refs.pairCode.textContent = '------';
  refs.pairQr.removeAttribute('src');
  try {
    const session = await window.reminders.startPairing(platform);
    refs.pairQr.src = session.qrDataUrl;
    refs.pairCode.textContent = session.code;
    refs.pairStatus.textContent = 'Waiting for your phone…';
    clearInterval(pairingPollTimer);
    pairingPollTimer = setInterval(() => void pollPairing(), 2_000);
    void pollPairing();
  } catch (error) {
    refs.pairStatus.textContent = error.message || 'Could not create a pairing code. Check your connection.';
  }
}

async function pollPairing() {
  try {
    const status = await window.reminders.pairingStatus();
    if (status.status === 'paired') {
      clearInterval(pairingPollTimer);
      pairingPollTimer = undefined;
      refs.pairSuccessCopy.textContent = `@${status.username || 'hover'} is connected. Your planner is syncing now.`;
      showPairingStep('success');
      localStorage.setItem('hover-pairing-intro-seen', 'true');
    } else if (status.status === 'expired') {
      clearInterval(pairingPollTimer);
      pairingPollTimer = undefined;
      refs.pairStatus.textContent = 'This code expired. Close and create a new one.';
    } else if (status.message) {
      refs.pairStatus.textContent = 'Still waiting for your phone…';
    }
  } catch {
    refs.pairStatus.textContent = 'Connection paused. HOVER will keep checking.';
  }
}

function emptyForm() {
  refs.id.value = '';
  refs.title.value = '';
  refs.notes.value = '';
  refs.date.value = dateKey(selectedDate);
  refs.repeat.value = 'none';
  refs.start.value = '09:00';
  refs.end.value = '09:30';
  refs.alarm.checked = true;
  refs.alarmMinutes.value = '0';
  document.querySelector('input[name="color"][value="violet"]').checked = true;
}

function openEditor(reminder) {
  refs.formError.textContent = '';
  if (reminder) {
    refs.editorTitle.textContent = 'Edit reminder';
    refs.id.value = reminder.id;
    refs.title.value = reminder.title;
    refs.notes.value = reminder.notes || '';
    refs.date.value = reminder.date;
    refs.repeat.value = reminder.repeat;
    refs.start.value = reminder.startTime;
    refs.end.value = reminder.endTime;
    refs.alarm.checked = reminder.alarm;
    refs.alarmMinutes.value = String(reminder.alarmMinutes || 0);
    document.querySelector(`input[name="color"][value="${reminder.color}"]`).checked = true;
    refs.delete.hidden = false;
  } else {
    refs.editorTitle.textContent = 'New reminder';
    emptyForm();
    refs.delete.hidden = true;
  }
  refs.editor.classList.add('open');
  refs.editor.setAttribute('aria-hidden', 'false');
  document.body.classList.add('sheet-open');
  setTimeout(() => refs.title.focus(), 180);
}

function closeEditor() {
  refs.editor.classList.remove('open');
  refs.editor.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('sheet-open');
}

function animateDayChange(direction) {
  const animationClass = direction > 0 ? 'day-enter-next' : 'day-enter-previous';
  refs.calendarScroll.classList.remove('day-enter-next', 'day-enter-previous');
  void refs.calendarScroll.offsetWidth;
  refs.calendarScroll.classList.add(animationClass);
  refs.calendarScroll.addEventListener('animationend', () => refs.calendarScroll.classList.remove(animationClass), { once: true });
}

function moveSelectedDate(days) {
  const nextDate = new Date(selectedDate);
  nextDate.setDate(nextDate.getDate() + days);
  selectedDate = startOfDay(nextDate);
  render();
  animateDayChange(days);
}

function payloadFromForm() {
  return {
    title: refs.title.value,
    notes: refs.notes.value,
    date: refs.date.value,
    repeat: refs.repeat.value,
    startTime: refs.start.value,
    endTime: refs.end.value,
    alarm: refs.alarm.checked,
    alarmMinutes: Number(refs.alarmMinutes.value),
    color: document.querySelector('input[name="color"]:checked').value
  };
}

function showToast(message) {
  refs.toast.textContent = message;
  refs.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => refs.toast.classList.remove('show'), 7_000);
}

function playTone() {
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.setValueAtTime(740, context.currentTime);
    oscillator.frequency.setValueAtTime(990, context.currentTime + .16);
    gain.gain.setValueAtTime(.05, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .5);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(); oscillator.stop(context.currentTime + .5);
  } catch { /* Notifications still surface the alarm when audio is unavailable. */ }
}

el('new-reminder').addEventListener('click', () => openEditor());
el('new-reminder-bottom').addEventListener('click', () => openEditor());
el('create-shortcut').addEventListener('click', async () => {
  const result = await window.reminders.createDesktopShortcut();
  showToast(result.message);
});
refs.pairButton.addEventListener('click', openPairing);
document.querySelectorAll('[data-pair-platform]').forEach((button) => {
  button.addEventListener('click', () => void startPairing(button.dataset.pairPlatform));
});
el('pairing-close').addEventListener('click', () => void closePairing({ cancel: true }));
el('pairing-cancel').addEventListener('click', async () => {
  await window.reminders.cancelPairing();
  showPairingStep('intro');
});
el('pairing-skip').addEventListener('click', () => {
  localStorage.setItem('hover-pairing-intro-seen', 'true');
  void closePairing({ cancel: true });
});
el('pairing-done').addEventListener('click', async () => {
  if (appState.cloud?.paired) {
    const result = await window.reminders.syncNow();
    showToast(result.message);
  }
  await closePairing();
});
el('enable-island').addEventListener('click', () => window.reminders.setIslandMode(true));
el('island-expand').addEventListener('click', () => window.reminders.setIslandMode(false));
refs.islandComplete.addEventListener('click', () => {
  const reminder = appState.reminders.find((item) => item.id === refs.islandComplete.dataset.reminderId);
  completeReminder(reminder, dateKey(new Date()), refs.islandView);
});
el('dismiss-editor').addEventListener('click', closeEditor);
el('minimize').addEventListener('click', () => window.reminders.minimize());
el('close').addEventListener('click', () => window.reminders.close());
el('previous-day').addEventListener('click', () => moveSelectedDate(-1));
el('next-day').addEventListener('click', () => moveSelectedDate(1));
refs.goToday.addEventListener('click', () => { selectedDate = startOfDay(new Date()); render({ scrollToNow: true }); animateDayChange(-1); });
refs.topmost.addEventListener('change', async (event) => { await window.reminders.setTopmost(event.target.checked); });

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
    event.preventDefault();
    if (!refs.editor.classList.contains('open')) openEditor();
  }
  if (event.key === 'Escape' && refs.editor.classList.contains('open')) closeEditor();
  else if (event.key === 'Escape' && refs.pairPanel.classList.contains('open')) void closePairing({ cancel: true });
});

refs.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  refs.formError.textContent = '';
  try {
    if (refs.id.value) await window.reminders.update(refs.id.value, payloadFromForm());
    else await window.reminders.create(payloadFromForm());
    closeEditor();
  } catch (error) {
    refs.formError.textContent = error.message || 'Unable to save this reminder.';
  }
});

refs.delete.addEventListener('click', async () => {
  if (!refs.id.value) return;
  await window.reminders.remove(refs.id.value);
  closeEditor();
});

window.reminders.onChange((nextState) => { appState = nextState; render(); });
window.reminders.onAlarm((reminder) => { playTone(); showToast(`Alarm · ${reminder.title}`); });

buildGrid();
window.reminders.getState().then((initialState) => {
  appState = initialState;
  render({ scrollToNow: true });
  if (!appState.cloud?.paired && (appState.cloud?.forcePairingPrompt || localStorage.getItem('hover-pairing-intro-seen') !== 'true')) {
    openPairing();
    if (appState.cloud?.forcePairingQr) {
      refs.pairQr.src = appState.cloud.snapshotQrUrl;
      refs.pairCode.textContent = 'HVR7K2';
      refs.pairStatus.textContent = 'Waiting for your phone…';
      showPairingStep('code');
    }
  }
});
setInterval(() => {
  refs.liveClock.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  renderNowLine();
}, 20_000);

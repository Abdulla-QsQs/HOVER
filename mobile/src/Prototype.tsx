import {
  ArrowLeftIcon,
  BellIcon,
  CalendarIcon,
  CameraIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DesktopIcon,
  DownloadIcon,
  DotFilledIcon,
  DragHandleDots2Icon,
  GearIcon,
  Link2Icon,
  MobileIcon,
  PlusIcon,
  ReloadIcon,
} from "@radix-ui/react-icons";
import { AnimatePresence, motion } from "motion/react";
import {
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { BottomSheet, Carousel, KeyboardInput, MobileScroll, useKeyboard } from "./mobile";

type Phase = "splash" | "welcome" | "scanner" | "restore" | "permission" | "username" | "planner";
type PlannerView = "planner" | "profile";
type ReminderColor = "sky" | "violet" | "mint" | "coral" | "sun";
type PushState = "unsupported" | "off" | "ready" | "enabling" | "enabled" | "denied" | "error";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type StoredPushSubscription = {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
};

type Reminder = {
  id: string;
  title: string;
  start: string;
  end: string;
  dateKey: string;
  color: ReminderColor;
  top: number;
  height: number;
  alarm: boolean;
  completed?: boolean;
  notes?: string;
  repeat?: "none" | "daily";
  alarmMinutes?: number;
  updatedAt?: string;
};

type ReminderDraft = {
  title: string;
  date: string;
  start: string;
  end: string;
  color: ReminderColor;
  alarm: boolean;
};

type CompletedReminder = {
  id: string;
  reminderId?: string;
  title: string;
  start: string;
  dateKey: string;
  color: ReminderColor;
  completedAt: string;
  username: string;
};

type PendingPair = {
  code: string;
  secret?: string;
  desktopName?: string;
};

type CloudSyncPayload = {
  token?: string;
  recoveryCode?: string;
  desktop?: { name: string; platform: string };
  profile?: { id: string; username: string; createdAt: string; updatedAt: string };
  reminders?: Array<Record<string, unknown>>;
  deletedReminderIds?: string[];
  history?: Array<Record<string, unknown>>;
  error?: string;
  code?: string;
};

type BarcodeDetectorInstance = {
  detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>>;
};
type BarcodeDetectorConstructor = new (options: { formats: string[] }) => BarcodeDetectorInstance;

const BASE_DATE = new Date(2026, 7, 15);
const START_HOUR = 7;
const END_HOUR = 20;
const HOUR_HEIGHT = 31.5;
const DEFAULT_DESKTOP = "ABDULLA-PC";
const HISTORY_COLOR = "#541804";

const initialReminders: Reminder[] = [
  {
    id: "morning-focus",
    title: "Morning focus",
    start: "08:15",
    end: "09:15",
    dateKey: "2026-08-15",
    color: "sky",
    top: topForTime("08:15"),
    height: heightForTimes("08:15", "09:15"),
    alarm: true,
  },
  {
    id: "plan-launch",
    title: "Plan the launch",
    start: "10:30",
    end: "11:45",
    dateKey: "2026-08-15",
    color: "violet",
    top: topForTime("10:30"),
    height: heightForTimes("10:30", "11:45"),
    alarm: true,
  },
  {
    id: "mobile-pairing",
    title: "Review mobile pairing",
    start: "14:00",
    end: "14:45",
    dateKey: "2026-08-15",
    color: "mint",
    top: topForTime("14:00"),
    height: heightForTimes("14:00", "14:45"),
    alarm: false,
  },
  {
    id: "evening-walk",
    title: "Evening walk",
    start: "18:00",
    end: "18:30",
    dateKey: "2026-08-15",
    color: "coral",
    top: topForTime("18:00"),
    height: heightForTimes("18:00", "18:30"),
    alarm: true,
  },
];

const colors: ReminderColor[] = ["sky", "violet", "mint", "coral", "sun"];

export default function Prototype() {
  const keyboard = useKeyboard();
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const barcodeDetectorRef = useRef<BarcodeDetectorInstance | null>(null);
  const scanFrameRef = useRef<number | null>(null);
  const actionHandledRef = useRef(false);
  const dragRef = useRef<{
    id: string;
    pointerId: number;
    startY: number;
    initialTop: number;
    target: HTMLElement;
    timer: number;
    active: boolean;
  } | null>(null);

  const requestedScreen = useMemo(() => new URLSearchParams(window.location.search).get("screen"), []);
  const requestedAction = useMemo(() => new URLSearchParams(window.location.search).get("action"), []);
  const requestedPair = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return { code: normalizePairCode(params.get("pair") || ""), secret: params.get("secret") || "" };
  }, []);
  const [phase, setPhase] = useState<Phase>(() => {
    if (requestedScreen === "planner") return "planner";
    if (requestedScreen === "pair") return "welcome";
    if (window.localStorage.getItem("hover-paired") === "true") {
      return window.localStorage.getItem("hover-username") ? "planner" : "username";
    }
    return "splash";
  });
  const [plannerView, setPlannerView] = useState<PlannerView>("planner");
  const [selectedOffset, setSelectedOffset] = useState(0);
  const [dayDirection, setDayDirection] = useState(1);
  const [reminders, setReminders] = useState<Reminder[]>(() => loadReminders());
  const [history, setHistory] = useState<CompletedReminder[]>(() => loadHistory());
  const [username, setUsername] = useState(() => window.localStorage.getItem("hover-username") || "");
  const [usernameDraft, setUsernameDraft] = useState(() => window.localStorage.getItem("hover-username") || "");
  const [editorOpen, setEditorOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [scannerStatus, setScannerStatus] = useState("Ready to scan your desktop code");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [pendingPair, setPendingPair] = useState<PendingPair | null>(() => requestedPair.code ? requestedPair : null);
  const [cloudToken, setCloudToken] = useState(() => window.localStorage.getItem("hover-cloud-token") || "");
  const [savedRecoveryCode, setSavedRecoveryCode] = useState(() => window.localStorage.getItem("hover-recovery-code") || "");
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudError, setCloudError] = useState("");
  const [compactPreview, setCompactPreview] = useState(false);
  const [vapidPublicKey, setVapidPublicKey] = useState("");
  const [pushState, setPushState] = useState<PushState>(() => initialPushState());
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(() => isStandaloneApp());
  const [draft, setDraft] = useState<ReminderDraft>(() => emptyDraft(dateKey(BASE_DATE)));

  const selectedDate = useMemo(() => addDays(BASE_DATE, selectedOffset), [selectedOffset]);
  const selectedDateKey = dateKey(selectedDate);
  const selectedReminders = reminders
    .filter((reminder) => reminder.dateKey === selectedDateKey)
    .sort((a, b) => a.top - b.top);
  const nextReminder = selectedReminders[0];
  const week = useMemo(() => weekFor(selectedDate), [selectedDate]);
  const earliestDateKey = useMemo(() => {
    const datedItems = [...history.map((item) => item.dateKey), ...reminders.map((item) => item.dateKey)];
    return datedItems.length ? datedItems.sort()[0] : dateKey(BASE_DATE);
  }, [history, reminders]);
  const minimumOffset = useMemo(() => daysBetween(BASE_DATE, dateFromKey(earliestDateKey)), [earliestDateKey]);

  useEffect(() => {
    if (phase !== "splash") return;
    const timer = window.setTimeout(() => setPhase("welcome"), 1850);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    window.localStorage.setItem("hover-reminders", JSON.stringify(reminders));
  }, [reminders]);

  useEffect(() => {
    window.localStorage.setItem("hover-completed-history", JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
    void cloudRequest("/api/push/config").then((payload) => {
      if (payload.configured && typeof payload.publicKey === "string") setVapidPublicKey(payload.publicKey);
    }).catch(() => undefined);

    const onInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", onInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  useEffect(() => () => stopCamera(), []);

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2200);
  };

  const changeDay = (offset: number) => {
    const boundedOffset = Math.max(minimumOffset, offset);
    setDayDirection(boundedOffset >= selectedOffset ? 1 : -1);
    setSelectedOffset(boundedOffset);
  };

  const beginPair = async (codeValue: string, secret = "") => {
    const code = normalizePairCode(codeValue);
    if (code.length !== 6) {
      setScannerStatus("Enter the complete six-character HOVER code.");
      return;
    }
    setCloudBusy(true);
    setCloudError("");
    setScannerStatus("Checking the secure pairing session…");
    try {
      const session = await cloudRequest(`/api/pair/inspect?code=${encodeURIComponent(code)}`);
      const desktopName = String(session.desktopName || DEFAULT_DESKTOP);
      setPendingPair({ code, secret, desktopName });
      window.localStorage.setItem("hover-desktop", desktopName);
      stopCamera();
      keyboard.hide();
      setScannerStatus(`${desktopName} found. Continue to pair.`);
      setPhase("permission");
    } catch (error) {
      const message = error instanceof Error ? error.message : "That pairing code could not be verified.";
      setScannerStatus(message);
      setCloudError(message);
    } finally {
      setCloudBusy(false);
    }
  };

  const scanForDesktopCode = async () => {
    const detector = barcodeDetectorRef.current;
    const video = videoRef.current;
    if (!detector || !video || !cameraStreamRef.current) return;

    try {
      const results = await detector.detect(video);
      const result = results.find((item) => Boolean(item.rawValue));
      if (result?.rawValue) {
        const pair = parsePairPayload(result.rawValue);
        if (!pair) {
          setScannerStatus("That QR code is not a HOVER pairing code.");
          scanFrameRef.current = window.requestAnimationFrame(() => void scanForDesktopCode());
          return;
        }
        setScannerStatus("HOVER code found. Pairing…");
        await beginPair(pair.code, pair.secret);
        return;
      }
    } catch {
      // Keep the camera active; the six-character code remains available.
    }

    scanFrameRef.current = window.requestAnimationFrame(() => void scanForDesktopCode());
  };

  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setScannerStatus("Camera scanning is unavailable here. Enter the pairing code instead.");
      return;
    }

    try {
      setScannerStatus("Starting camera…");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      cameraStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      const Detector = (window as typeof window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
      barcodeDetectorRef.current = Detector ? new Detector({ formats: ["qr_code"] }) : null;
      setScannerStatus(
        barcodeDetectorRef.current
          ? "Point the camera at the HOVER code on your desktop"
          : "Camera ready. If automatic scan is unavailable, use the pairing code below.",
      );
      if (barcodeDetectorRef.current) void scanForDesktopCode();
    } catch {
      setScannerStatus("Camera access was not enabled. Use the six-character code below.");
    }
  };

  const stopCamera = () => {
    if (scanFrameRef.current !== null) window.cancelAnimationFrame(scanFrameRef.current);
    scanFrameRef.current = null;
    barcodeDetectorRef.current = null;
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
  };

  const finishNotificationSetup = async (requestPermission: boolean) => {
    if (requestPermission) window.localStorage.setItem("hover-push-wanted", "true");
    if (requestPermission && supportsWebPush()) {
      setPushState("enabling");
      try {
        const permission = Notification.permission === "default"
          ? await Notification.requestPermission()
          : Notification.permission;
        if (permission === "granted" && vapidPublicKey) {
          const subscription = await createPushSubscription(vapidPublicKey);
          window.localStorage.setItem("hover-push-subscription", JSON.stringify(subscription));
          setPushState(cloudToken ? "enabling" : "ready");
          if (cloudToken) {
            await uploadPushSubscription(cloudToken, subscription);
            setPushState("enabled");
          }
        } else if (permission === "denied") {
          setPushState("denied");
        } else {
          setPushState("error");
        }
      } catch {
        setPushState(Notification.permission === "denied" ? "denied" : "error");
      }
    } else if (requestPermission) {
      setPushState("unsupported");
    }
    if (window.localStorage.getItem("hover-username") && !pendingPair) {
      window.localStorage.setItem("hover-paired", "true");
      setPhase("planner");
    } else {
      setPhase("username");
    }
  };

  const saveUsername = async (event: FormEvent) => {
    event.preventDefault();
    const normalized = normalizeUsername(usernameDraft);
    if (normalized.length < 3) return;
    keyboard.hide();
    setCloudBusy(true);
    setCloudError("");
    try {
      if (pendingPair) {
        const payload = await cloudRequest("/api/pair/claim", {
          method: "POST",
          body: JSON.stringify({
            code: pendingPair.code,
            secret: pendingPair.secret,
            username: normalized,
            kind: mobilePlatform(),
            deviceName: mobileDeviceName(),
          }),
        }) as CloudSyncPayload;
        if (!payload.token) throw new Error("The pairing token was not returned.");
        persistCloudSession(payload);
        setCloudToken(payload.token);
        if (supportsWebPush() && Notification.permission === "granted" && vapidPublicKey) {
          setPushState("enabling");
          void enablePushForToken(payload.token, vapidPublicKey)
            .then(() => setPushState("enabled"))
            .catch(() => setPushState("error"));
        }
        if (payload.recoveryCode) setSavedRecoveryCode(payload.recoveryCode);
        if (payload.desktop?.name) window.localStorage.setItem("hover-desktop", payload.desktop.name);
        applyCloudPayload(payload, setReminders, setHistory, normalized);
        setPendingPair(null);
        window.history.replaceState({}, "", "/?screen=planner");
      } else if (cloudToken) {
        await cloudRequest("/api/profile", {
          method: "PATCH",
          token: cloudToken,
          body: JSON.stringify({ username: normalized }),
        });
      }
    } catch (error) {
      setCloudError(error instanceof Error ? error.message : "HOVER could not save this profile.");
      setCloudBusy(false);
      return;
    }
    setUsername(normalized);
    setUsernameDraft(normalized);
    window.localStorage.setItem("hover-username", normalized);
    window.localStorage.setItem("hover-paired", "true");
    window.localStorage.setItem("hover-cloud-profile", JSON.stringify({ username: normalized, updatedAt: new Date().toISOString() }));
    setPlannerView("planner");
    setPhase("planner");
    setCloudBusy(false);
  };

  const restorePlanner = async () => {
    setCloudBusy(true);
    setCloudError("");
    try {
      const payload = await cloudRequest("/api/recovery", {
        method: "POST",
        body: JSON.stringify({ recoveryCode, kind: mobilePlatform(), deviceName: mobileDeviceName() }),
      }) as CloudSyncPayload;
      if (!payload.token || !payload.profile) throw new Error("The recovery response was incomplete.");
      persistCloudSession(payload);
      setCloudToken(payload.token);
      if (supportsWebPush() && Notification.permission === "granted" && vapidPublicKey) {
        setPushState("enabling");
        void enablePushForToken(payload.token, vapidPublicKey)
          .then(() => setPushState("enabled"))
          .catch(() => setPushState("error"));
      }
      setUsername(payload.profile.username);
      setUsernameDraft(payload.profile.username);
      applyCloudPayload(payload, setReminders, setHistory, payload.profile.username);
      window.localStorage.setItem("hover-paired", "true");
      setPhase("planner");
    } catch (error) {
      setCloudError(error instanceof Error ? error.message : "HOVER could not restore that planner.");
    } finally {
      setCloudBusy(false);
    }
  };

  const syncFromCloud = async (token = cloudToken) => {
    if (!token) return;
    try {
      const payload = await cloudRequest("/api/sync", { token }) as CloudSyncPayload;
      const syncedUsername = payload.profile?.username || username;
      if (payload.profile?.username) {
        setUsername(payload.profile.username);
        setUsernameDraft(payload.profile.username);
        window.localStorage.setItem("hover-username", payload.profile.username);
      }
      applyCloudPayload(payload, setReminders, setHistory, syncedUsername);
    } catch {
      // Offline-first: local data remains usable until the next successful sync.
    }
  };

  useEffect(() => {
    if (!requestedPair.code) return;
    void beginPair(requestedPair.code, requestedPair.secret);
    // The QR payload is immutable for this launch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase !== "planner" || !cloudToken) return;
    void syncFromCloud(cloudToken);
    const interval = window.setInterval(() => void syncFromCloud(cloudToken), 30_000);
    const onVisible = () => { if (document.visibilityState === "visible") void syncFromCloud(cloudToken); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // Sync is intentionally keyed to session and screen, not local edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, cloudToken]);

  useEffect(() => {
    if (phase !== "planner" || !cloudToken || !vapidPublicKey || !supportsWebPush()) return;
    if (Notification.permission !== "granted" || window.localStorage.getItem("hover-push-wanted") !== "true") return;
    setPushState("enabling");
    void enablePushForToken(cloudToken, vapidPublicKey)
      .then(() => setPushState("enabled"))
      .catch(() => setPushState(Notification.permission === "denied" ? "denied" : "error"));
  }, [phase, cloudToken, vapidPublicKey]);

  const enableNotifications = async () => {
    if (!supportsWebPush()) {
      setPushState("unsupported");
      showNotice("Web Push is unavailable on this browser");
      return;
    }
    if (!vapidPublicKey || !cloudToken) {
      setPushState("error");
      showNotice("Pair HOVER before enabling notifications");
      return;
    }
    setPushState("enabling");
    window.localStorage.setItem("hover-push-wanted", "true");
    try {
      const permission = Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;
      if (permission !== "granted") {
        setPushState(permission === "denied" ? "denied" : "off");
        showNotice("Notifications were not enabled");
        return;
      }
      await enablePushForToken(cloudToken, vapidPublicKey);
      setPushState("enabled");
      showNotice("Background notifications enabled");
    } catch {
      setPushState("error");
      showNotice("HOVER could not enable notifications");
    }
  };

  const sendTestNotification = async () => {
    if (!cloudToken || pushState !== "enabled") return;
    setPushState("enabling");
    try {
      await cloudRequest("/api/push/test", { method: "POST", token: cloudToken });
      setPushState("enabled");
      showNotice("Test notification sent");
    } catch {
      setPushState("error");
      showNotice("The test notification could not be delivered");
    }
  };

  const installHover = async () => {
    if (installed) {
      showNotice("HOVER is already installed");
      return;
    }
    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") setInstalled(true);
      setInstallPrompt(null);
      return;
    }
    showNotice(/iphone|ipad|ipod/i.test(navigator.userAgent)
      ? "Use Share, then Add to Home Screen"
      : "Use your browser menu, then Install app");
  };

  const openNewReminder = () => {
    keyboard.hide();
    setEditingId(null);
    setDraft(emptyDraft(selectedDateKey));
    setEditorOpen(true);
  };

  useEffect(() => {
    if (phase !== "planner" || requestedAction !== "new" || actionHandledRef.current) return;
    actionHandledRef.current = true;
    setEditingId(null);
    setDraft(emptyDraft(selectedDateKey));
    setEditorOpen(true);
    window.history.replaceState({}, "", "/?screen=planner");
  }, [phase, requestedAction, selectedDateKey]);

  const openReminder = (reminder: Reminder) => {
    keyboard.hide();
    setEditingId(reminder.id);
    setDraft({
      title: reminder.title,
      date: reminder.dateKey,
      start: reminder.start,
      end: reminder.end,
      color: reminder.color,
      alarm: reminder.alarm,
    });
    setEditorOpen(true);
  };

  const saveReminder = (event: FormEvent) => {
    event.preventDefault();
    const nextReminderValue: Reminder = {
      id: editingId ?? `reminder-${Date.now()}`,
      title: draft.title.trim() || "Untitled reminder",
      start: draft.start,
      end: draft.end,
      dateKey: draft.date,
      color: draft.color,
      top: topForTime(draft.start),
      height: heightForTimes(draft.start, draft.end),
      alarm: draft.alarm,
      notes: "",
      repeat: "none",
      alarmMinutes: 0,
      updatedAt: new Date().toISOString(),
    };

    setReminders((current) =>
      editingId
        ? current.map((reminder) => (reminder.id === editingId ? nextReminderValue : reminder))
        : [...current, nextReminderValue],
    );
    keyboard.hide();
    setEditorOpen(false);
    showNotice(editingId ? "Reminder updated" : "Reminder added");
    if (cloudToken) void writeCloudReminder(cloudToken, nextReminderValue);
  };

  const deleteReminder = () => {
    if (!editingId) return;
    setReminders((current) => current.filter((reminder) => reminder.id !== editingId));
    keyboard.hide();
    setEditorOpen(false);
    showNotice("Reminder removed");
    if (cloudToken) void cloudRequest(`/api/reminders/${encodeURIComponent(editingId)}`, { method: "DELETE", token: cloudToken }).catch(() => undefined);
  };

  const completeReminder = (id: string) => {
    const completedReminder = reminders.find((reminder) => reminder.id === id);
    if (!completedReminder) return;
    const completedAt = new Date().toISOString();
    const completion: CompletedReminder = {
        id: `${completedReminder.id}:${completedReminder.dateKey}`,
        reminderId: completedReminder.id,
        title: completedReminder.title,
        start: completedReminder.start,
        dateKey: completedReminder.dateKey,
        color: completedReminder.color,
        completedAt,
        username,
      };
    setHistory((current) => [completion, ...current.filter((item) => item.id !== completion.id)]);
    setReminders((current) => current.map((reminder) => (reminder.id === id ? { ...reminder, completed: true } : reminder)));
    window.setTimeout(() => {
      setReminders((current) => current.filter((reminder) => reminder.id !== id));
    }, 460);
    showNotice("Completed");
    if (cloudToken) void writeCloudCompletion(cloudToken, completion);
  };

  const beginHold = (reminder: Reminder, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const target = event.currentTarget;
    const pointerId = event.pointerId;
    const timer = window.setTimeout(() => {
      if (!dragRef.current || dragRef.current.id !== reminder.id) return;
      dragRef.current.active = true;
      target.setPointerCapture(pointerId);
      setDraggingId(reminder.id);
      navigator.vibrate?.(18);
    }, 360);

    dragRef.current = {
      id: reminder.id,
      pointerId,
      startY: event.clientY,
      initialTop: reminder.top,
      target,
      timer,
      active: false,
    };
  };

  const moveHeldReminder = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !drag.active) return;
    event.preventDefault();
    const nextTop = clamp(drag.initialTop + event.clientY - drag.startY, 0, (END_HOUR - START_HOUR) * HOUR_HEIGHT - 48);
    setReminders((current) =>
      current.map((reminder) => (reminder.id === drag.id ? { ...reminder, top: Math.round(nextTop / 8) * 8 } : reminder)),
    );
  };

  const endHold = (reminder: Reminder, event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    window.clearTimeout(drag.timer);
    if (drag.active) {
      try {
        drag.target.releasePointerCapture(drag.pointerId);
      } catch {
        // Pointer capture may already have been released by the runtime.
      }
      const updated = reminders.find((item) => item.id === reminder.id);
      if (updated) {
        const start = timeForTop(updated.top);
        const duration = minutesBetween(updated.start, updated.end);
        const movedReminder = {
          ...updated,
          start,
          end: addMinutesToTime(start, duration),
          updatedAt: new Date().toISOString(),
        };
        setReminders((current) =>
          current.map((item) =>
            item.id === reminder.id
              ? movedReminder
              : item,
          ),
        );
        if (cloudToken) void writeCloudReminder(cloudToken, movedReminder);
      }
      showNotice("Time updated");
    } else {
      openReminder(reminder);
    }
    dragRef.current = null;
    setDraggingId(null);
  };

  if (phase === "splash") {
    return <SplashScreen />;
  }

  if (phase === "welcome") {
    return (
      <OnboardingScreen
        onPair={() => setPhase("scanner")}
        onRestore={() => setPhase("restore")}
        onPreview={() => finishNotificationSetup(false)}
      />
    );
  }

  if (phase === "scanner") {
    return (
      <ScannerScreen
        videoRef={videoRef}
        status={scannerStatus}
        onBack={() => {
          stopCamera();
          setPhase("welcome");
        }}
        onStart={startCamera}
        onPair={(code) => void beginPair(code)}
        busy={cloudBusy}
      />
    );
  }

  if (phase === "restore") {
    return (
      <RestoreScreen
        value={recoveryCode}
        onChange={setRecoveryCode}
        onBack={() => setPhase("welcome")}
        onRestore={() => void restorePlanner()}
        busy={cloudBusy}
        error={cloudError}
      />
    );
  }

  if (phase === "permission") {
    return (
      <PermissionScreen
        onAllow={() => finishNotificationSetup(true)}
        onLater={() => finishNotificationSetup(false)}
      />
    );
  }

  if (phase === "username") {
    return (
      <UsernameScreen
        value={usernameDraft}
        onChange={(value) => setUsernameDraft(normalizeUsername(value))}
        onSubmit={saveUsername}
        onBack={() => setPhase(window.localStorage.getItem("hover-paired") === "true" ? "planner" : "permission")}
        busy={cloudBusy}
        error={cloudError}
      />
    );
  }

  if (plannerView === "profile") {
    return (
      <ProfileScreen
        username={username}
        history={history}
        onBack={() => setPlannerView("planner")}
        onEditUsername={() => {
          setUsernameDraft(username);
          setPhase("username");
        }}
      />
    );
  }

  return (
    <div className="hover-app" data-testid="hover-planner">
      <div className="ambient-art" aria-hidden="true" />
      <div className="pull-planet" aria-hidden="true">
        <img src="/assets/hover/icon.png" alt="" draggable={false} />
      </div>
      <MobileScroll className="app-screen hover-scroll">
        <main className="planner-content">
          <header className="device-header">
            <button className="profile-trigger" aria-label="Open profile and completed history" onClick={() => setPlannerView("profile")}>
              <img src="/assets/hover/icon.png" alt="" className="device-icon" draggable={false} />
            </button>
            <div className="device-copy">
              <strong>{window.localStorage.getItem("hover-desktop") || DEFAULT_DESKTOP}</strong>
              <span><DotFilledIcon /> Windows · Online</span>
            </div>
            <button className="glass-icon-button" aria-label="Open settings" onClick={() => setSettingsOpen(true)}>
              <GearIcon />
            </button>
          </header>

          <section className="week-panel" aria-label={`${monthLong(selectedDate)} ${selectedDate.getFullYear()}`}>
            <div className="week-meta">
              <span>{monthLong(selectedDate).toUpperCase()} {selectedDate.getFullYear()}</span>
              <div>
                <button aria-label="Previous week" disabled={selectedOffset - 7 < minimumOffset} onClick={() => changeDay(selectedOffset - 7)}><ChevronLeftIcon /></button>
                <button aria-label="Next week" onClick={() => changeDay(selectedOffset + 7)}><ChevronRightIcon /></button>
              </div>
            </div>
            <Carousel className="week-carousel" contentClassName="week-track" ariaLabel="Choose a day">
              {week.map((day) => {
                const offset = daysBetween(BASE_DATE, day);
                const selected = dateKey(day) === selectedDateKey;
                const unavailable = offset < minimumOffset;
                return (
                  <button
                    className="day-chip"
                    data-selected={selected}
                    key={dateKey(day)}
                    onClick={() => changeDay(offset)}
                    aria-pressed={selected}
                    disabled={unavailable}
                    aria-label={unavailable ? `${weekdayLong(day)}, no earlier history` : weekdayLong(day)}
                  >
                    <span>{weekdayShort(day)}</span>
                    <strong>{day.getDate()}</strong>
                  </button>
                );
              })}
            </Carousel>
          </section>

          <AnimatePresence mode="wait" initial={false}>
            <motion.section
              className="day-view"
              key={selectedDateKey}
              initial={{ opacity: 0, x: dayDirection * 22, filter: "blur(4px)" }}
              animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, x: dayDirection * -18, filter: "blur(3px)" }}
              transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="date-overview">
                <div>
                  <p className="date-eyebrow">{selectedOffset === 0 ? "TODAY" : weekdayLong(selectedDate).toUpperCase()}</p>
                  <h1>{weekdayLong(selectedDate)}, {monthLong(selectedDate)} {selectedDate.getDate()}</h1>
                  <p>{summaryFor(selectedReminders)}</p>
                </div>
                <button className="add-orb" onClick={openNewReminder} aria-label="Add reminder">
                  <PlusIcon />
                </button>
              </div>

              {compactPreview && nextReminder ? (
                <button className="next-island" onClick={() => openReminder(nextReminder)}>
                  <span className="completion-ring" aria-hidden="true" />
                  <span className="next-island-copy">
                    <strong>{nextReminder.title}</strong>
                    <small>{formatTime(nextReminder.start)} – {formatTime(nextReminder.end)}</small>
                  </span>
                  <ChevronDownIcon />
                </button>
              ) : null}

              <section className="calendar-shell" aria-label={`${weekdayLong(selectedDate)} calendar`}>
                <div className="calendar-grid" style={{ height: (END_HOUR - START_HOUR) * HOUR_HEIGHT }}>
                  {Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, index) => START_HOUR + index).map((hour) => (
                    <div className={`hour-row ${selectedOffset === 0 && hour === 8 ? "hour-row-now" : ""}`} style={{ top: (hour - START_HOUR) * HOUR_HEIGHT }} key={hour}>
                      <span>{formatHour(hour)}</span>
                    </div>
                  ))}

                  {selectedOffset === 0 ? (
                    <div className="now-line" style={{ top: topForTime("08:05") }} aria-label="Current time 8:05 AM">
                      <span>8:05 AM</span>
                    </div>
                  ) : null}

                  <AnimatePresence>
                    {selectedReminders.map((reminder) => (
                      <motion.article
                        className={`reminder-block reminder-${reminder.color}`}
                        data-dragging={draggingId === reminder.id}
                        data-completed={reminder.completed ? "true" : "false"}
                        key={reminder.id}
                        style={{ top: reminder.top, height: reminder.height }}
                        initial={{ opacity: 0, y: 10, scale: 0.98 }}
                        animate={{ opacity: reminder.completed ? 0 : 1, y: 0, scale: reminder.completed ? 0.94 : 1 }}
                        exit={{ opacity: 0, x: 42, scale: 0.96 }}
                        transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
                      >
                        <button
                          className="complete-control"
                          aria-label={`Mark ${reminder.title} completed`}
                          onClick={(event) => {
                            event.stopPropagation();
                            completeReminder(reminder.id);
                          }}
                        >
                          <CheckIcon />
                        </button>
                        <button
                          className="reminder-main"
                          aria-label={`${reminder.title}, hold to drag or tap to edit`}
                          onPointerDown={(event) => beginHold(reminder, event)}
                          onPointerMove={moveHeldReminder}
                          onPointerUp={(event) => endHold(reminder, event)}
                          onPointerCancel={(event) => endHold(reminder, event)}
                        >
                          <span className="reminder-copy">
                            <strong>{reminder.title}</strong>
                            <small>{formatTime(reminder.start)} – {formatTime(reminder.end)}</small>
                          </span>
                          <DragHandleDots2Icon className="drag-grip" />
                        </button>
                      </motion.article>
                    ))}
                  </AnimatePresence>

                  {selectedReminders.length === 0 ? (
                    <button className="empty-day" onClick={openNewReminder}>
                      <CalendarIcon />
                      <strong>This day is clear</strong>
                      <span>Add a reminder</span>
                    </button>
                  ) : null}
                </div>
              </section>
            </motion.section>
          </AnimatePresence>
        </main>
      </MobileScroll>

      <nav className="planner-dock" aria-label="Planner controls">
        <button aria-label="Previous day" disabled={selectedOffset - 1 < minimumOffset} onClick={() => changeDay(selectedOffset - 1)}><ChevronLeftIcon /></button>
        <button className="today-control" onClick={() => changeDay(0)} disabled={selectedOffset === 0}>Today</button>
        <button className="dock-add" onClick={openNewReminder}><PlusIcon /><span>New reminder</span></button>
        <button aria-label="Next day" onClick={() => changeDay(selectedOffset + 1)}><ChevronRightIcon /></button>
      </nav>

      <BottomSheet
        open={editorOpen}
        onOpenChange={setEditorOpen}
        title={editingId ? "Edit reminder" : "New reminder"}
        description="Set the time here. HOVER keeps the alarm attached when it syncs."
        snap={0.78}
      >
        <form className="reminder-form" onSubmit={saveReminder}>
          <label>
            <span>Reminder</span>
            <KeyboardInput
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              placeholder="What do you need to do?"
              required
            />
          </label>
          <label>
            <span>Date</span>
            <KeyboardInput type="date" min={earliestDateKey} value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} required />
          </label>
          <div className="form-row">
            <label>
              <span>Starts</span>
              <KeyboardInput type="time" value={draft.start} onChange={(event) => setDraft({ ...draft, start: event.target.value })} required />
            </label>
            <label>
              <span>Ends</span>
              <KeyboardInput type="time" value={draft.end} onChange={(event) => setDraft({ ...draft, end: event.target.value })} required />
            </label>
          </div>
          <fieldset className="color-fieldset">
            <legend>Color</legend>
            <div className="color-row">
              {colors.map((color) => (
                <button
                  className={`color-choice color-${color}`}
                  data-selected={draft.color === color}
                  type="button"
                  key={color}
                  aria-label={`${color} reminder color`}
                  onClick={() => setDraft({ ...draft, color })}
                ><CheckIcon /></button>
              ))}
            </div>
          </fieldset>
          <label className="alarm-toggle">
            <span><BellIcon /> Notify me at the start time</span>
            <input type="checkbox" checked={draft.alarm} onChange={(event) => setDraft({ ...draft, alarm: event.target.checked })} />
          </label>
          <div className="form-actions">
            {editingId ? <button className="delete-action" type="button" onClick={deleteReminder}>Delete</button> : <span />}
            <button className="save-action" type="submit">Save reminder</button>
          </div>
        </form>
      </BottomSheet>

      <BottomSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        title="HOVER settings"
        description={`${DEFAULT_DESKTOP} is connected to this phone.`}
        snap={0.72}
      >
        <div className="settings-list">
          <label className="settings-row">
            <span><Link2Icon /><span><strong>Next reminder island</strong><small>Show the compact floating reminder</small></span></span>
            <input type="checkbox" checked={compactPreview} onChange={(event) => setCompactPreview(event.target.checked)} />
          </label>
          <div className="settings-row recovery-row">
            <span><BellIcon /><span><strong>Reminder notifications</strong><small>{pushStateLabel(pushState)}</small></span></span>
            <button
              onClick={() => pushState === "enabled" ? void sendTestNotification() : void enableNotifications()}
              disabled={pushState === "enabling" || pushState === "unsupported"}
            >{pushState === "enabled" ? "Test" : pushState === "enabling" ? "Working" : "Enable"}</button>
          </div>
          <div className="settings-row recovery-row">
            <span><DownloadIcon /><span><strong>Home Screen app</strong><small>{installed ? "Installed as HOVER" : "Install the standalone phone app"}</small></span></span>
            <button onClick={() => void installHover()} disabled={installed}>{installed ? "Added" : "Install"}</button>
          </div>
          <div className="settings-row recovery-row">
            <span><ReloadIcon /><span><strong>Recovery code</strong><small>{savedRecoveryCode || "Available after secure pairing"}</small></span></span>
            <button onClick={() => {
              navigator.clipboard?.writeText(savedRecoveryCode);
              showNotice("Recovery code copied");
            }} disabled={!savedRecoveryCode}>Copy</button>
          </div>
          <button className="settings-row unpair-row" onClick={() => {
            setSettingsOpen(false);
            setPlannerView("profile");
          }}>
            <span><CalendarIcon /><span><strong>Completed history</strong><small>{history.length} reminders saved for @{username || "username"}</small></span></span>
            <ChevronRightIcon />
          </button>
          <button className="settings-row unpair-row" onClick={async () => {
            if (cloudToken) {
              const registration = "serviceWorker" in navigator ? await navigator.serviceWorker.ready.catch(() => null) : null;
              const subscription = await registration?.pushManager.getSubscription().catch(() => null);
              await cloudRequest("/api/push/subscriptions", {
                method: "DELETE",
                token: cloudToken,
                body: JSON.stringify({ endpoint: subscription?.endpoint || "" }),
              }).catch(() => undefined);
              await subscription?.unsubscribe().catch(() => false);
            }
            window.localStorage.removeItem("hover-paired");
            window.localStorage.removeItem("hover-cloud-token");
            window.localStorage.removeItem("hover-push-subscription");
            window.localStorage.removeItem("hover-push-wanted");
            setCloudToken("");
            setPushState(initialPushState());
            setPendingPair(null);
            setSettingsOpen(false);
            setPhase("welcome");
          }}>
            <span><MobileIcon /><span><strong>Pair another desktop</strong><small>Return to the secure pairing flow</small></span></span>
            <ChevronRightIcon />
          </button>
        </div>
      </BottomSheet>

      <AnimatePresence>
        {notice ? (
          <motion.div
            className="hover-toast"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
          >
            <CheckIcon /> {notice}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function SplashScreen() {
  return (
    <div className="hover-stage splash-screen">
      <div className="ambient-art" aria-hidden="true" />
      <motion.img
        className="splash-icon"
        src="/assets/hover/icon.png"
        alt="HOVER"
        draggable={false}
        initial={{ rotate: -70, scale: 0.76, opacity: 0 }}
        animate={{ rotate: 520, scale: 1, opacity: 1 }}
        transition={{ duration: 1.05, ease: [0.08, 0.82, 0.18, 1] }}
      />
      <motion.strong
        className="splash-word"
        initial={{ opacity: 0, y: 12, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: 0.7, duration: 0.44, ease: [0.16, 1, 0.3, 1] }}
      >HOVER</motion.strong>
    </div>
  );
}

function OnboardingScreen({ onPair, onRestore, onPreview }: { onPair: () => void; onRestore: () => void; onPreview: () => void }) {
  return (
    <MobileScroll className="app-screen onboarding-scroll">
      <main className="hover-stage onboarding-screen">
        <div className="ambient-art" aria-hidden="true" />
        <section className="onboarding-hero">
          <img src="/assets/hover/icon.png" className="onboarding-icon" alt="HOVER" draggable={false} />
          <p>YOUR PLANNER, WITH YOU</p>
          <h1>Pair once.<br />Stay in sync.</h1>
          <span>Carry the same HOVER day plan, alarms and completion state on your phone.</span>
        </section>
        <section className="onboarding-actions">
          <button className="primary-action" onClick={onPair}><DesktopIcon /> Pair with desktop <ChevronRightIcon /></button>
          <button className="secondary-action" onClick={onRestore}><ReloadIcon /> Restore HOVER <ChevronRightIcon /></button>
          <p>Requires iOS 17+ or Android 10+</p>
          <button className="text-action" onClick={onPreview}>Preview without pairing</button>
        </section>
      </main>
    </MobileScroll>
  );
}

function ScannerScreen({
  videoRef,
  status,
  onBack,
  onStart,
  onPair,
  busy,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  status: string;
  onBack: () => void;
  onStart: () => void;
  onPair: (code: string) => void;
  busy: boolean;
}) {
  const [code, setCode] = useState("");
  return (
    <MobileScroll className="app-screen onboarding-scroll">
      <main className="hover-stage scanner-screen">
        <div className="ambient-art" aria-hidden="true" />
        <button className="back-control" onClick={onBack}><ArrowLeftIcon /> Back</button>
        <header>
          <p>PAIR WITH DESKTOP</p>
          <h1>Scan the HOVER code</h1>
          <span>Open HOVER on Windows, choose Pair a phone, then point this camera at the code.</span>
        </header>
        <div className="scanner-window">
          <video ref={videoRef} playsInline muted aria-label="QR scanner camera preview" />
          <CameraIcon />
        </div>
        <p className="scanner-status">{status}</p>
        <button className="primary-action" onClick={onStart} disabled={busy}><CameraIcon /> Start in-app scanner</button>
        <small className="scanner-native-hint">On iPhone, you can also scan the desktop QR with the Camera app to open HOVER securely.</small>
        <div className="pair-divider"><span>or use the pairing code</span></div>
        <KeyboardInput
          className="pair-code-input"
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase().slice(0, 6))}
          placeholder="ABC123"
          aria-label="Pairing code"
        />
        <button className="secondary-action" disabled={code.length < 6 || busy} onClick={() => onPair(code)}><Link2Icon /> {busy ? "Checking code…" : "Connect with code"}</button>
      </main>
    </MobileScroll>
  );
}

function RestoreScreen({
  value,
  onChange,
  onBack,
  onRestore,
  busy,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  onBack: () => void;
  onRestore: () => void;
  busy: boolean;
  error: string;
}) {
  return (
    <MobileScroll className="app-screen onboarding-scroll">
      <main className="hover-stage restore-screen">
        <div className="ambient-art" aria-hidden="true" />
        <button className="back-control" onClick={onBack}><ArrowLeftIcon /> Back</button>
        <section className="restore-card">
          <ReloadIcon className="restore-icon" />
          <p>HOVER RECOVERY</p>
          <h1>Bring your planner back</h1>
          <span>Enter the recovery code you saved when HOVER was first paired.</span>
          <KeyboardInput value={value} onChange={(event) => onChange(formatRecoveryCode(event.target.value))} placeholder="HVR-XXXX-XXXX-XXXX" aria-label="Recovery code" />
          {error ? <small className="cloud-form-error" role="alert">{error}</small> : null}
          <button className="primary-action" disabled={normalizeRecoveryCode(value).length !== 15 || busy} onClick={onRestore}>{busy ? "Restoring…" : "Restore planner"} <ChevronRightIcon /></button>
        </section>
      </main>
    </MobileScroll>
  );
}

function PermissionScreen({ onAllow, onLater }: { onAllow: () => void; onLater: () => void }) {
  return (
    <div className="hover-stage permission-screen">
      <div className="ambient-art" aria-hidden="true" />
      <div className="permission-orb"><BellIcon /></div>
      <p>ALARMS & NOTIFICATIONS</p>
      <h1>Let HOVER reach you on time.</h1>
      <span>Allow notifications so HOVER can surface alarms from reminders synced to this phone.</span>
      <button className="primary-action" onClick={onAllow}><BellIcon /> Enable notifications</button>
      <button className="text-action" onClick={onLater}>Maybe later</button>
      <small>You can change this later in HOVER settings.</small>
    </div>
  );
}

function UsernameScreen({
  value,
  onChange,
  onSubmit,
  onBack,
  busy,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onBack: () => void;
  busy: boolean;
  error: string;
}) {
  return (
    <MobileScroll className="app-screen onboarding-scroll">
      <main className="hover-stage username-screen">
        <div className="ambient-art" aria-hidden="true" />
        <button className="back-control" onClick={onBack}><ArrowLeftIcon /> Back</button>
        <form className="username-card" onSubmit={onSubmit}>
          <img src="/assets/hover/icon.png" alt="" className="username-icon" draggable={false} />
          <p>YOUR HOVER ID</p>
          <h1>Make this planner yours.</h1>
          <span>Your username keeps completed history under one private identity and prepares this phone for cloud sync.</span>
          <label>
            <small>USERNAME</small>
            <div className="username-field">
              <span>@</span>
              <KeyboardInput
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder="yourname"
                autoCapitalize="none"
                autoCorrect="off"
                aria-label="Choose a HOVER username"
                required
              />
            </div>
          </label>
          {error ? <small className="cloud-form-error" role="alert">{error}</small> : null}
          <button className="primary-action" type="submit" disabled={value.length < 3 || busy}>
            <CheckIcon /> {busy ? "Securing profile…" : "Continue to HOVER"} <ChevronRightIcon />
          </button>
          <small>3–24 characters · letters, numbers and underscores</small>
        </form>
      </main>
    </MobileScroll>
  );
}

function ProfileScreen({
  username,
  history,
  onBack,
  onEditUsername,
}: {
  username: string;
  history: CompletedReminder[];
  onBack: () => void;
  onEditUsername: () => void;
}) {
  const activity = buildActivityWeeks(history);
  const activeDays = new Set(history.map((item) => item.dateKey)).size;
  const streak = completionStreak(history);
  const recent = [...history].sort((a, b) => b.completedAt.localeCompare(a.completedAt)).slice(0, 8);

  return (
    <div className="hover-app profile-view" data-testid="hover-profile">
      <div className="ambient-art" aria-hidden="true" />
      <MobileScroll className="app-screen profile-scroll">
        <main className="profile-content">
          <header className="profile-toolbar">
            <button className="back-control" onClick={onBack}><ArrowLeftIcon /> Planner</button>
            <button className="profile-edit" onClick={onEditUsername}>Edit</button>
          </header>

          <section className="profile-identity">
            <img src="/assets/hover/icon.png" alt="HOVER profile" draggable={false} />
            <div>
              <p>HOVER PROFILE</p>
              <h1>{username ? `@${username}` : "Choose a username"}</h1>
              <span>Completed history from every paired day.</span>
            </div>
          </section>

          <section className="profile-stats" aria-label="Completion totals">
            <div><strong>{history.length}</strong><span>completed</span></div>
            <div><strong>{activeDays}</strong><span>active days</span></div>
            <div><strong>{streak}</strong><span>day streak</span></div>
          </section>

          <section className="activity-card" aria-labelledby="activity-title">
            <header>
              <div>
                <p>COMPLETION MAP</p>
                <h2 id="activity-title">{history.length === 1 ? "1 reminder completed" : `${history.length} reminders completed`}</h2>
              </div>
              <span>Last 12 weeks</span>
            </header>
            <div className="activity-chart" role="grid" aria-label={`${history.length} completed ${history.length === 1 ? "reminder" : "reminders"} across the last twelve weeks`}>
              <div className="activity-month-spacer" aria-hidden="true" />
              <div className="activity-month-labels" aria-hidden="true">
                {activity.weeks.map((week) => <span key={week.key}>{week.monthLabel}</span>)}
              </div>
              <div className="activity-day-labels" aria-hidden="true">
                <span>Mon</span><span>Wed</span><span>Fri</span>
              </div>
              <div className="activity-grid" role="rowgroup">
                {activity.cells.map((cell, index) => (
                  <span
                    className={`activity-cell activity-level-${cell.level}`}
                    data-future={cell.future ? "true" : "false"}
                    key={cell.date}
                    role="gridcell"
                    aria-label={`${formatHistoryDate(cell.date)}: ${cell.count} completed`}
                    title={`${formatHistoryDate(cell.date)}: ${cell.count} completed`}
                    style={{ animationDelay: `${Math.min(index * 7, 520)}ms` }}
                  />
                ))}
              </div>
            </div>
            <footer>
              <span className="activity-legend-title">Completion days</span>
              <span>Less</span>
              {[0, 1, 2, 3, 4].map((level) => <i className={`activity-cell activity-level-${level}`} key={level} />)}
              <span>More</span>
              <i className="history-color-chip" style={{ backgroundColor: HISTORY_COLOR }} aria-hidden="true" />
            </footer>
          </section>

          <section className="recent-history">
            <header><p>RECENTLY COMPLETED</p><span>{recent.length ? "Saved on this device" : "No history yet"}</span></header>
            {recent.length ? (
              <div className="history-list">
                {recent.map((item) => (
                  <article key={item.id}>
                    <span className="history-check"><CheckIcon /></span>
                    <div><strong>{item.title}</strong><small>{formatHistoryDate(item.dateKey)} · {formatTime(item.start)}</small></div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="history-empty">
                <span className="history-check"><CheckIcon /></span>
                <strong>Complete your first reminder</strong>
                <p>It will appear here and light up the map above.</p>
              </div>
            )}
          </section>
        </main>
      </MobileScroll>
    </div>
  );
}

function loadReminders() {
  try {
    const saved = window.localStorage.getItem("hover-reminders");
    return saved
      ? (JSON.parse(saved) as Reminder[]).map((reminder) => ({
          ...reminder,
          top: topForTime(reminder.start),
          height: heightForTimes(reminder.start, reminder.end),
        }))
      : initialReminders;
  } catch {
    return initialReminders;
  }
}

function loadHistory(): CompletedReminder[] {
  try {
    const saved = window.localStorage.getItem("hover-completed-history");
    return saved ? (JSON.parse(saved) as CompletedReminder[]) : [];
  } catch {
    return [];
  }
}

function normalizeUsername(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24);
}

function normalizePairCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function normalizeRecoveryCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 15);
}

function formatRecoveryCode(value: string) {
  const compact = normalizeRecoveryCode(value);
  const prefix = compact.slice(0, 3);
  const groups = [compact.slice(3, 7), compact.slice(7, 11), compact.slice(11, 15)].filter(Boolean);
  return [prefix, ...groups].filter(Boolean).join("-");
}

function parsePairPayload(value: string): { code: string; secret: string } | null {
  const plainCode = normalizePairCode(value);
  if (plainCode.length === 6 && !value.includes(":")) return { code: plainCode, secret: "" };
  try {
    const parsed = new URL(value);
    if (parsed.origin !== window.location.origin) return null;
    const code = normalizePairCode(parsed.searchParams.get("pair") || "");
    if (code.length !== 6) return null;
    return { code, secret: parsed.searchParams.get("secret") || "" };
  } catch {
    return null;
  }
}

function mobilePlatform() {
  return /android/i.test(navigator.userAgent) ? "android" : "ios";
}

function mobileDeviceName() {
  return mobilePlatform() === "android" ? "HOVER Android" : "HOVER iPhone";
}

function supportsWebPush() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function initialPushState(): PushState {
  if (!supportsWebPush()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission === "granted" && window.localStorage.getItem("hover-push-wanted") === "true") return "ready";
  return "off";
}

function isStandaloneApp() {
  const iosNavigator = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || iosNavigator.standalone === true;
}

function pushStateLabel(state: PushState) {
  return {
    unsupported: "Unavailable in this browser",
    off: "Off · enable alarms when HOVER is closed",
    ready: "Permission granted · finishing connection",
    enabling: "Connecting securely…",
    enabled: "On · background delivery is connected",
    denied: "Blocked in phone notification settings",
    error: "Needs attention · tap to reconnect",
  }[state];
}

function urlBase64ToBytes(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const binary = window.atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function createPushSubscription(publicKey: string): Promise<StoredPushSubscription> {
  if (!supportsWebPush()) throw new Error("Web Push is unavailable.");
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToBytes(publicKey),
    });
  }
  const value = subscription.toJSON();
  if (!value.endpoint || !value.keys?.p256dh || !value.keys?.auth) throw new Error("The phone returned an incomplete push subscription.");
  return {
    endpoint: value.endpoint,
    expirationTime: value.expirationTime,
    keys: { p256dh: value.keys.p256dh, auth: value.keys.auth },
  };
}

async function uploadPushSubscription(token: string, subscription: StoredPushSubscription) {
  await cloudRequest("/api/push/subscriptions", {
    method: "POST",
    token,
    body: JSON.stringify({
      subscription,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      userAgent: navigator.userAgent,
    }),
  });
}

async function enablePushForToken(token: string, publicKey: string) {
  const subscription = await createPushSubscription(publicKey);
  window.localStorage.setItem("hover-push-subscription", JSON.stringify(subscription));
  await uploadPushSubscription(token, subscription);
}

async function cloudRequest(
  pathname: string,
  options: RequestInit & { token?: string } = {},
): Promise<Record<string, unknown>> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("content-type", "application/json");
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  const response = await fetch(pathname, { ...options, headers });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : `HOVER cloud returned ${response.status}.`);
  return payload;
}

function persistCloudSession(payload: CloudSyncPayload) {
  if (payload.token) window.localStorage.setItem("hover-cloud-token", payload.token);
  if (payload.recoveryCode) window.localStorage.setItem("hover-recovery-code", payload.recoveryCode);
  if (payload.profile?.username) {
    window.localStorage.setItem("hover-username", payload.profile.username);
    window.localStorage.setItem("hover-cloud-profile", JSON.stringify(payload.profile));
  }
  window.localStorage.setItem("hover-paired", "true");
}

function applyCloudPayload(
  payload: CloudSyncPayload,
  setReminders: (items: Reminder[]) => void,
  setHistory: (items: CompletedReminder[]) => void,
  username: string,
) {
  const cloudHistory = payload.history?.map((item) => cloudCompletionToUi(item, username));
  if (payload.reminders) {
    const deletedIds = new Set(payload.deletedReminderIds || []);
    const completedKeys = new Set((cloudHistory || []).map((item) => `${item.reminderId}:${item.dateKey}`));
    setReminders(payload.reminders
      .map((item) => cloudReminderToUi(item))
      .filter((item) => !deletedIds.has(item.id) && !completedKeys.has(`${item.id}:${item.dateKey}`)));
  }
  if (cloudHistory) setHistory(cloudHistory);
}

function cloudReminderToUi(item: Record<string, unknown>): Reminder {
  const start = String(item.startTime || "09:00");
  const end = String(item.endTime || "09:30");
  return {
    id: String(item.id),
    title: String(item.title || "Untitled reminder"),
    start,
    end,
    dateKey: String(item.dateKey),
    color: colors.includes(item.color as ReminderColor) ? item.color as ReminderColor : "sky",
    top: topForTime(start),
    height: heightForTimes(start, end),
    alarm: item.alarm !== false,
    notes: String(item.notes || ""),
    repeat: item.repeat === "daily" ? "daily" : "none",
    alarmMinutes: Number(item.alarmMinutes || 0),
    updatedAt: String(item.updatedAt || new Date().toISOString()),
  };
}

function cloudCompletionToUi(item: Record<string, unknown>, username: string): CompletedReminder {
  return {
    id: String(item.id),
    reminderId: String(item.reminderId || ""),
    title: String(item.title || "Completed reminder"),
    start: String(item.startTime || "09:00"),
    dateKey: String(item.dateKey),
    color: colors.includes(item.color as ReminderColor) ? item.color as ReminderColor : "sky",
    completedAt: String(item.completedAt || new Date().toISOString()),
    username,
  };
}

function writeCloudReminder(token: string, reminder: Reminder) {
  return cloudRequest(`/api/reminders/${encodeURIComponent(reminder.id)}`, {
    method: "PUT",
    token,
    body: JSON.stringify({
      id: reminder.id,
      title: reminder.title,
      notes: reminder.notes || "",
      dateKey: reminder.dateKey,
      startTime: reminder.start,
      endTime: reminder.end,
      color: reminder.color,
      repeat: reminder.repeat || "none",
      alarm: reminder.alarm,
      alarmMinutes: reminder.alarmMinutes || 0,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      updatedAt: reminder.updatedAt || new Date().toISOString(),
    }),
  });
}

function writeCloudCompletion(token: string, completion: CompletedReminder) {
  return cloudRequest("/api/completions", {
    method: "POST",
    token,
    body: JSON.stringify({
      id: completion.id,
      reminderId: completion.reminderId,
      title: completion.title,
      startTime: completion.start,
      dateKey: completion.dateKey,
      color: completion.color,
      completedAt: completion.completedAt,
    }),
  });
}

function dateFromKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function buildActivityWeeks(history: CompletedReminder[]) {
  const completionCounts = history.reduce<Record<string, number>>((counts, item) => {
    counts[item.dateKey] = (counts[item.dateKey] || 0) + 1;
    return counts;
  }, {});
  const currentWeek = weekFor(BASE_DATE);
  const firstDate = addDays(currentWeek[0], -77);
  const weeks = Array.from({ length: 12 }, (_, weekIndex) => {
    const start = addDays(firstDate, weekIndex * 7);
    const previous = weekIndex ? addDays(firstDate, (weekIndex - 1) * 7) : null;
    return {
      key: dateKey(start),
      monthLabel: weekIndex === 0 || previous?.getMonth() !== start.getMonth()
        ? new Intl.DateTimeFormat("en", { month: "short" }).format(start)
        : "",
    };
  });
  const cells = Array.from({ length: 84 }, (_, index) => {
    const date = addDays(firstDate, index % 7 + Math.floor(index / 7) * 7);
    const key = dateKey(date);
    const count = completionCounts[key] || 0;
    return { date: key, count, level: Math.min(4, count), future: date > BASE_DATE };
  });
  return { weeks, cells };
}

function completionStreak(history: CompletedReminder[]) {
  const completedDays = new Set(history.map((item) => item.dateKey));
  let cursor = new Date(BASE_DATE);
  let streak = 0;
  while (completedDays.has(dateKey(cursor))) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

function formatHistoryDate(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(dateFromKey(value));
}

function emptyDraft(date: string): ReminderDraft {
  return { title: "", date, start: "09:00", end: "09:30", color: "sky", alarm: true };
}

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(date.getDate() + amount);
  return next;
}

function weekFor(date: Date) {
  const day = date.getDay();
  const mondayDelta = day === 0 ? -6 : 1 - day;
  const monday = addDays(date, mondayDelta);
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

function daysBetween(from: Date, to: Date) {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.round((end - start) / 86_400_000);
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function weekdayShort(date: Date) {
  return new Intl.DateTimeFormat("en", { weekday: "short" }).format(date);
}

function weekdayLong(date: Date) {
  return new Intl.DateTimeFormat("en", { weekday: "long" }).format(date);
}

function monthLong(date: Date) {
  return new Intl.DateTimeFormat("en", { month: "long" }).format(date);
}

function formatHour(hour: number) {
  if (hour === 12) return "12 PM";
  return hour > 12 ? `${hour - 12} PM` : `${hour} AM`;
}

function formatTime(value: string) {
  const [hourValue, minute] = value.split(":").map(Number);
  const suffix = hourValue >= 12 ? "PM" : "AM";
  return `${hourValue % 12 || 12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function topForTime(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return clamp(((hour - START_HOUR) * 60 + minute) / 60 * HOUR_HEIGHT, 0, (END_HOUR - START_HOUR) * HOUR_HEIGHT - 48);
}

function heightForTimes(start: string, end: string) {
  return clamp(minutesBetween(start, end) / 60 * HOUR_HEIGHT, 48, 96);
}

function minutesBetween(start: string, end: string) {
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  return Math.max(15, endHour * 60 + endMinute - (startHour * 60 + startMinute));
}

function timeForTop(top: number) {
  const totalMinutes = START_HOUR * 60 + Math.round(top / HOUR_HEIGHT * 60 / 5) * 5;
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

function addMinutesToTime(value: string, minutesToAdd: number) {
  const [hour, minute] = value.split(":").map(Number);
  const total = hour * 60 + minute + minutesToAdd;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function summaryFor(reminders: Reminder[]) {
  if (reminders.length === 0) return "Nothing planned yet";
  const noun = reminders.length === 1 ? "reminder" : "reminders";
  return `${reminders.length} ${noun} · next at ${formatTime(reminders[0].start)}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

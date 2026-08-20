# HOVER mobile companion

This folder contains the installable mobile PWA prototype for iPhone and Android. Its planner uses the approved option 1 calendar layout with option 3's OLED-black glass treatment.

## Included now

- Exact HOVER watercolor icon, decelerating launch spin, and bold splash reveal.
- Pair with desktop, recovery-code, camera/scanner, and notification-permission flows.
- Paired desktop name, live week and date controls, full day timeline, and correct Today labels.
- Add/edit reminder sheet with date, times, alarm, and event color.
- Mark-complete removal and hold-to-drag time changes.
- Username onboarding and a top-left profile with persistent completed-reminder history.
- A GitHub-style 12-week completion map with month/day labels, five activity levels, the exact HOVER history token `#541804`, totals, streak, and recent completions.
- Backward date navigation clamped to the earliest available reminder/history date.
- Pull-down reveal with the original HOVER icon floating and spinning above the planner.
- Optional compact next-reminder island in Settings.
- iPhone and Pixel 10 preview runtimes.
- Real expiring QR/manual-code pairing, separate device tokens, recovery restore, cloud usernames, reminder sync, deletion sync, and completed-history sync.
- Web app manifest, Home Screen icon, app shortcuts, offline shell, and push-notification service-worker handlers.

The in-app scanner uses the browser's native QR detector when available and always provides a six-character fallback. iPhone users can also scan the desktop QR with the native Camera app, which opens the signed pairing URL directly. Username, planner state, and completion history remain available locally while a paired profile syncs them through the D1 backend.

## Run locally

```powershell
cd mobile
npm ci
npm run dev -- --host 127.0.0.1 --port 4280 --strictPort
```

Open `http://127.0.0.1:4280/`. Use `?screen=planner` to open the approved planner state directly or `?screen=pair` to restart onboarding.

## Verify

```powershell
npm run check:runtime
npm run build
npm run test:sites
```

The final visual QA record is [`design-qa.md`](design-qa.md). App-specific implementation lives in `src/Prototype.tsx` and `src/prototype.css`; the surrounding mobile runtime is intentionally protected.

## Install on a phone

- iPhone: open the deployed HTTPS site in Safari, choose **Share**, then **Add to Home Screen**.
- Android: open the deployed HTTPS site in Chrome and choose **Install app**.

Push delivery on iPhone requires the PWA to be installed to the Home Screen and notification permission to be granted. Scheduled Web Push while every HOVER client is closed is not enabled in this beta; the pairing and sync backend does not claim that guarantee yet.

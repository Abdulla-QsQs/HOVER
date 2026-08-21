# Changelog

## Mobile 0.3.1 - Reliable pairing and planner access

- Added an iOS-compatible continuous QR decoder instead of relying on the unavailable Safari `BarcodeDetector` API.
- Made the six-character pairing code a real form with a visible submit action and native keyboard Go/Enter support.
- Removed legacy sample reminders and their completion records from local and synced planner data.
- Replaced hardcoded desktop names in the mobile planner with the signed-in username and current phone type.
- Restored native vertical calendar scrolling at a readable hour scale while keeping hold-to-drag on a dedicated handle.
- Updated the current-time line every second and immediately after the app regains focus or visibility.

## 1.2.1 - Standalone mobile runtime

- Moved the public Home Screen install link to `https://hover-reminder.pages.dev/`.
- Replaced the shipped phone simulator shell with an edge-to-edge production runtime using the real OS status bar, keyboard, scrolling, touch behavior, and safe areas.
- Removed the preview-only device picker, fake bezel, simulated keyboard, and circular custom cursor from phone and Home Screen launches.
- Corrected `TODAY`, the selected date, current-time line, and demo reminders to use the phone's real local date and time.
- Added OLED-black Apple and maskable icons to prevent iOS from flattening transparent pixels into a white tile.
- Preserved existing pairing tokens and cloud data through the neutral HOVER compatibility endpoint.

## 1.0.1 - Security update

- Upgraded Electron from 37.10.3 to 43.4.0 to resolve high-severity upstream advisories.
- Updated the snapshot utility for clean shutdown under Electron 43.
- Rebuilt and reverified the Windows installer.

## 1.0.0 - Initial release

- Glass calendar interface in a compact always-on-top window.
- Calendar-style reminder blocks with one-time and daily scheduling.
- Native Windows notifications with configurable alarm lead times.
- Click-to-edit and hold-to-drag rescheduling with 15-minute snapping.
- Per-day completion controls for one-time and repeating reminders.
- Collapsible dynamic-island mode showing the next reminder.
- Local-only reminder storage and desktop shortcut support.
- Windows NSIS installer and automated GitHub Release workflow.

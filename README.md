<p align="center">
  <img src="assets/hover.png" width="128" alt="HOVER watercolor icon">
</p>

<h1 align="center">HOVER</h1>

<p align="center">A small, always-on-top reminder calendar for Windows.</p>

HOVER keeps the day within reach without taking over the desktop. Reminders appear as draggable calendar blocks in a transparent glass window, can alert you at the right time, and collapse into a compact Dynamic Island-style view.

## Download

**[Download HOVER for Windows](https://github.com/Abdulla-QsQs/HOVER/releases/latest/download/HOVER-Setup-1.0.0.exe)**

The direct link downloads `HOVER-Setup-1.0.0.exe`. The guided installer can create Desktop and Start menu shortcuts. Release notes and checksums are available on the [Releases page](https://github.com/Abdulla-QsQs/HOVER/releases/latest).

> HOVER 1.0.0 is not code-signed. Windows SmartScreen may show an **Unknown publisher** notice; choose **More info → Run anyway** only when you downloaded it from this repository.

## Preview

<p align="center">
  <img src="docs/screenshots/hover-calendar.png" width="410" alt="HOVER calendar with reminder blocks">
</p>

<p align="center">
  <img src="docs/screenshots/hover-island.png" width="360" alt="HOVER compact island view">
</p>

## What it does

- Floats above other windows in a sticky-note-sized transparent glass panel.
- Places reminders as animated blocks on a day timeline.
- Moves a reminder by pressing and holding its block, then dragging it.
- Supports one-time and daily reminders with native Windows notifications.
- Marks reminders complete directly from the calendar or compact island.
- Switches dates with Back and Next while keeping the date heading accurate.
- Collapses into a Dynamic Island-style strip showing the next reminder.
- Creates or refreshes a Desktop shortcut from inside the app.
- Stores reminder data locally on the computer.

## Quick start

1. Install and open HOVER.
2. Select **New reminder** or press `Ctrl+N`.
3. Add a title, date, time, repeat rule, color, and alarm.
4. Select **Add reminder**.
5. Use the circular control on a block to complete it, or press and hold the block to drag it to a new time.

For every control and behavior, see the [HOVER usage guide](docs/USAGE.md).

## Run from source

Requires Node.js 22 or newer.

```powershell
npm ci
npm start
```

## Build and verify

```powershell
npm test
npm run snapshots
npm run dist:win
```

The Windows installer is written to `dist/HOVER-Setup-1.0.0.exe`. Snapshot generation updates the images under `docs/screenshots/`.

## Release workflow

- `quality.yml` checks JavaScript and audits dependencies on pushes and pull requests to `main`.
- `windows-release.yml` builds the NSIS installer on Windows and attaches it to a GitHub release whenever a `v*` tag is pushed. It can also be run manually to verify the installer artifact.

```powershell
git tag v1.0.0
git push origin v1.0.0
```

## Privacy

HOVER has no account, analytics, advertising, or cloud synchronization. Reminders are stored in Electron's local application-data folder and never leave the computer.

## License

HOVER is available under the [MIT License](LICENSE).

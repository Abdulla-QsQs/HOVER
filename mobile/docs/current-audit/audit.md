# HOVER completion map and pairing audit

## Scope

Chrome visual review of the deployed baseline, the GitHub contribution reference, the rebuilt local mobile profile, and the Windows pairing surfaces at their shipping window sizes.

## Reproduction steps

1. Open the HOVER planner on the iPhone preview.
2. Select the HOVER icon in the top-left to open Profile.
3. Compare the completion map with GitHub's profile contribution grid.
4. Return to Planner, create a reminder, save it, and select its completion control.
5. Reopen Profile and verify totals, the active date cell, and recent completion history.
6. Open the Windows first-launch pairing prompt, select a phone platform, and inspect the generated QR state.

## Evidence

- `01-current-planner.png` — deployed baseline planner.
- `02-current-streak-map.png` — original low-contrast map.
- `03-github-reference.png` — GitHub contribution reference.
- `04-local-final-streak.png` — rebuilt empty map.
- `05-github-vs-hover.png` — side-by-side structural comparison.
- `06-final-active-streak.png` — completed reminder shown in the rebuilt map.
- `../../../docs/screenshots/hover-pairing.png` — Windows first-launch choice.
- `../../../docs/screenshots/hover-pairing-qr.png` — Windows QR pairing state.

## Resolved findings

- Added GitHub-style month context and Monday/Wednesday/Friday row labels.
- Increased inactive-cell edge contrast without brightening the OLED-black surface.
- Kept `#541804` as the exact active fill and used a warmer border/glow for readability.
- Added a five-step Less-to-More legend and a staggered cell reveal with reduced-motion support.
- Replaced the simulated pairing success with expiring sessions, QR secrets, separate device tokens, recovery codes, and D1 persistence.
- Removed the crowded Windows footer labels and verified calendar, island, first-launch, and QR snapshots.
- Corrected the visible middle-dot encoding artifact in completed-history rows.

## Strengths

- The map now reads as a mobile adaptation of GitHub rather than a decorative dot field.
- Empty, active, and future states remain distinguishable on OLED black.
- Pairing is readable at the sticky-note window size and keeps the QR code on an opaque white scan field.
- Phone and desktop flows retain HOVER's existing glass, typography, icon, and motion language.

## Accessibility

- The chart exposes an accessible grid label and a date/count label for every cell.
- Controls retain visible focus styles and descriptive accessible names.
- Motion is disabled under `prefers-reduced-motion`.
- Pairing status uses a polite live region, and cloud form failures use alert semantics.

## Limits

- The 12-week map intentionally adapts GitHub's year-wide desktop density to a phone viewport.
- Native Web Push delivery while every HOVER client is closed still requires the scheduled push-delivery phase; desktop-native alarms continue to work while the Windows app is running.

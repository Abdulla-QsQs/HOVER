# HOVER mobile standalone-runtime design QA

## Comparison target

- Canonical layout source: `docs/design-reference/layout-option-1.png`
- Canonical treatment source: `docs/design-reference/visual-option-3.png`
- Previously verified app-owned planner: `docs/design-qa/implementation-final.png`
- New production phone runtime: `docs/design-qa/standalone-implementation.png`
- New onboarding state: `docs/design-qa/standalone-onboarding.png`
- New add-reminder state: `docs/design-qa/standalone-sheet.png`
- New completion-history state: `docs/design-qa/standalone-history.png`
- Combined equal-size planner comparison: `docs/design-qa/standalone-comparison.png`
- Viewport: `393 × 852` CSS px, device scale factor `1`.

The earlier verified app-owned UI is the fidelity source for this runtime correction. The task intentionally removes template-owned preview chrome on real phones while preserving the HOVER content inside it. Desktop QA can still force the framed iPhone / Pixel shell with `?runtime=preview`; phone QA can force the shipped edge-to-edge shell with `?runtime=native`.

## Findings

- No actionable P0, P1, or P2 issues remain.
- [P3] iOS always applies its rounded-square Home Screen mask, so a truly circular app hit area is not available for a free Home Screen PWA. HOVER now precomposes the unchanged circular watercolor artwork on OLED black, removing the visible white tile while keeping the circle intact.
- [P3] Local browser captures cannot render the physical iPhone status bar or home indicator. The installed build uses `viewport-fit=cover`, `black-translucent`, and native safe-area environment values; it no longer duplicates that OS chrome inside the app.

## Required fidelity surfaces

- Fonts and typography: the SF Pro / Segoe Variable system stack, optical weights, tight display tracking, tabular time labels, and short uppercase labels are unchanged. Headings, button labels, and dense calendar text remain legible at 393px.
- Spacing and layout rhythm: the paired-desktop header, week rail, date summary, full-day calendar, isolated bottom sheet, completion map, and bottom dock match the verified planner. Production phone content is edge-to-edge and safe-area aware; the fake device stage contributes no extra white canvas, bezel, or scaling.
- Colors and visual tokens: OLED black, cool glass borders, cyan metadata, low-saturation event colors, and the exact completion token `#541804` are unchanged. The new touch icon uses OLED black outside the circular art rather than the white transparency flattening visible on iOS.
- Image quality and asset fidelity: the real HOVER watercolor icon remains the source for in-app, manifest, maskable, and Apple touch assets. New icon sizes are precomposed from that source without generated replacement artwork, halos, or white borders. The starfield remains a dedicated raster asset.
- Copy and content: onboarding, pairing, recovery, notification, reminder, and history copy remains coherent. `TODAY`, the selected heading, seed reminders, and the current-time line now resolve from the phone's current local date/time instead of the old fixed August 15 test date.
- Icons: existing Radix controls retain consistent stroke weight and alignment. The production runtime removes the preview-only device picker and custom circular touch cursor rather than restyling them.
- Responsiveness and behavior: phone and installed launches choose the native shell from standalone mode, mobile user agent, or coarse-touch tablet input. Native scrolling uses platform momentum and `touch-action: pan-y`; desktop preview continues to use the deterministic simulator physics.
- Accessibility: semantic headings, dialogs, labels, live controls, disabled navigation states, reduced-motion behavior, 44px-class tap targets, and readable contrast are preserved. The native shell allows the OS keyboard and focus behavior instead of presenting a decorative simulated keyboard.

## Full-view comparison evidence

`standalone-comparison.png` places the prior verified `393 × 852` planner and the new `393 × 852` standalone planner in one visual input. App-owned hierarchy, glass surfaces, event blocks, completion controls, and action dock match. The deliberate differences are the removed fake status/home chrome and the real current date.

The supplied iPhone screenshot was used only as private problem evidence: it showed the entire simulator, device picker, white page canvas, and circular custom cursor inside Safari/Home Screen. None of those preview layers appear in `standalone-onboarding.png` or `standalone-implementation.png`.

## Focused state evidence

- `standalone-sheet.png`: the add-reminder editor is a single opaque glass sheet above a dimmed planner, with no overlapping preview keyboard or illegible double-glass layer.
- `standalone-history.png`: the GitHub-style 12-week grid, month/day labels, `Less`/`More` legend, exact brown activity token, totals, and recent history remain clear.
- `apple-touch-icon.png`: the circular artwork is sharp and unchanged; the formerly transparent outer pixels are OLED black so iOS no longer flattens them to a white tile.

## Primary interactions tested

- Phone runtime fills exactly `393 × 852` and contains no phone bezel, device picker, custom cursor, simulated status bar, simulated home indicator, or simulated keyboard.
- Desktop QA runtime retains the framed iPhone / Pixel picker and cursor for visual testing.
- New reminder opens, accepts a title through the native input, saves, closes the sheet, and renders the new calendar block.
- Mark complete removes the active block and records it in profile history and the activity grid.
- The actual current local date appears beneath `TODAY`; backward navigation remains bounded by available reminder/history data.
- Pair-session responses keep their existing cloud session but rewrite the QR destination to `https://hover-reminder.pages.dev/`.
- The Pages proxy applies no-store API behavior and security headers to the app shell.
- Browser console: no warnings or errors in planner, editor, onboarding, or profile states.
- Automated gates: 9 worker/backend tests and 10 runtime/interaction tests pass.

final result: passed

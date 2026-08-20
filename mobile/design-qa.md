# HOVER mobile design QA

## Comparison target

- Source visual truth — layout: `docs/design-reference/layout-option-1.png`
- Source visual truth — treatment: `docs/design-reference/visual-option-3.png`
- Normalized sources: `docs/design-qa/layout-normalized.png`, `docs/design-qa/visual-normalized.png`
- Browser-rendered implementation: `docs/design-qa/implementation-final.png`
- Full browser evidence: `docs/design-qa/full-frame-final.png`
- State: paired planner home, iPhone, OLED dark theme, Saturday 15 August 2026, four realistic reminders.
- Viewport: in-app browser `980 × 1180`; app-owned phone screen verified at `393 × 852` CSS px with device scale factor `1`.
- Source pixels: both generated references are `853 × 1844`; each was downsampled to `393 × 850` for equal-width comparison.
- Implementation pixels: `393 × 852`; no density resampling.

## Findings

- No actionable P0, P1, or P2 fidelity issues remain.
- [P3] The app uses the visual-treatment reference's compact system sans for the date instead of the layout reference's serif. This is intentional: the approved direction was option 1's structure with option 3's visual design.
- [P3] The implementation includes the template-owned live status bar, safe area, and home indicator. These were intentionally preserved and slightly compress the app-owned vertical rhythm compared with the generated references.

## Required fidelity surfaces

- Fonts and typography: system/SF Pro-style fallbacks, optical weights, tight date tracking, small tabular time labels, and truncation all follow the approved visual treatment. No generic futuristic or AI-style display type is present.
- Spacing and layout rhythm: paired-device header, month/week panel, date overview, full-day calendar, and bottom dock follow the approved layout. All persistent controls are visible at the target viewport and the four reminder blocks clear the dock.
- Colors and visual tokens: true black base, icy cyan labels, low-saturation sky/violet/mint/coral events, thin cool glass borders, and restrained elevation match the references.
- Image quality and asset fidelity: the supplied HOVER watercolor icon is used unchanged and remains sharp. The sparse OLED star field is a dedicated raster asset; no placeholder artwork, emoji, handcrafted SVG, or CSS-drawn decorative substitute is used. Standard controls use Radix icons.
- Copy and content: desktop name, dates, times, summaries, onboarding copy, reminder titles, recovery language, and notification pre-prompt are coherent and production-oriented.
- Accessibility and interaction: semantic buttons and headings, labels, focus states, reduced-motion handling, large touch targets, readable contrast, and live completion feedback are present.

## Full-view comparison evidence

The final combined comparison used both normalized approved references and the `393 × 852` implementation in one visual input. The implementation preserves option 1's month/week/calendar hierarchy and option 3's paired-device treatment, sharp glass, event palette, completion rings, and bottom action dock. The deliberate hybrid explains the two acceptable differences noted above.

## Focused region evidence

A separate crop was not needed after normalization: all three comparison images were rendered at `393px` width, leaving header typography, icon edges, week selection, calendar labels, block borders, completion rings, drag grips, and dock controls clearly readable in the combined input. The new-reminder sheet was also inspected in a live browser state and remained fully separated and readable above the dimmed planner.

## Comparison history

1. Initial browser pass found a P2 safe-area issue: the bottom planner dock resolved an undefined app-level safe-area variable and appeared at the top. The app shell now defines the inherited device safe area; the dock sits above iOS and Android bottom chrome.
2. First normalized pass found two P2 layout issues: the first `7 AM` label was clipped and the approved layout's month label was missing. The first label now sits within the calendar edge, and a compact `AUGUST 2026` row with real week navigation was added.
3. The revised pass slightly reduced the hour scale so the `6:00 PM` event ends above the persistent dock. Post-fix evidence shows the full day, all four reminders, and all persistent actions without overlap.
4. Final normalized comparison found no actionable P0/P1/P2 issues.

## Primary interactions tested

- Next day changes the heading to `Sunday, August 16`, changes the eyebrow to `SUNDAY`, and shows the correct empty-state summary; Today restores `TODAY` and the August 15 schedule.
- New reminder opens the isolated glass sheet, accepts a title, saves, updates the summary, and renders the new calendar block.
- Mark complete animates and removes the reminder, then updates the summary.
- Mark complete now also creates a persistent dated history row, raises the completion/active-day/streak totals, and lights the matching 12-week activity cell with the `#541804` token.
- The exact top-left HOVER icon opens the member profile; Planner returns to the calendar and Edit opens the username identity screen.
- Username input normalizes to the cloud-safe lowercase handle `@abdulla_hover`, persists locally, and reappears in the profile.
- Previous-day and previous-week controls are disabled at the earliest available reminder/history date; earlier week chips remain visible but unavailable and accurately announce that no earlier history exists.
- A top-edge pull gesture reveals the original HOVER icon as a centered spinning planet in the overscroll gap; it clears the paired-device header and retracts when the rubber-band returns.
- Pair with desktop accepts a six-character code, proceeds through the notification pre-prompt, dismisses the simulated keyboard before navigation, and lands on the paired planner.
- iPhone screen verified at `393 × 852`; Pixel 10 verified at `427 × 952` with its protected Android bottom chrome and no overlaps. The planner, profile grid, recent history, and pull-down planet were checked on the live runtime.
- Clean final browser tab reported no console warnings or errors.
- `manifest.webmanifest` and `sw.js` both returned HTTP 200 from the local preview.
- `npm run check:runtime`, production build, and all four Sites worker tests passed.

## Follow-up polish

- Consider a later native-only haptic profile for long-press dragging once the PWA is wrapped for iOS/Android stores.

final result: passed

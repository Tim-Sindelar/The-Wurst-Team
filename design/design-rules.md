# Design rules

Mock screens for the ETH study-space seat reservation app. Plain HTML + CSS, no build step.
Values live in `tokens.css`. **This file says how to use them.** If a rule and a screen disagree, fix the screen.

## Direction
- Copy the visual language of the ETH EduApp: warm dark brown, flat, hairline cards, uppercase labels, outline icons.
- Phone first, 390px wide. On desktop, centre a 390px column. Do not stretch.
- Dark is the default theme. Light is toggled with `<html data-theme="light">`. Every screen must work in both.
- Font: DIN Next LT W05 (ETH's licensed font, used if installed), falling back to Barlow (Google Fonts). We do not ship DIN files.

## The three commandments
1. **No raw values in screens.** No hex codes, no raw px for colour, spacing, radius or type. Use `var(--...)`. Need something new? Add a token, tell the other designer.
2. **Never use colour alone.** Every state also has a shape, icon, label or pattern.
3. **One primary action per screen.** One accent-filled button, in the same place on every screen (bottom, full width).

## Colour
| Token | Use |
|---|---|
| `--bg` | Page background |
| `--surface` | Cards, sidebars, sheets |
| `--border` | 1px dividers and card outlines |
| `--text` / `--text-muted` | Primary / secondary text |
| `--accent` | Primary button, links, selected state, focus |
| `--on-accent` | Text and icons on an accent fill |
| `--danger` | Cancel / end / errors, outlined style only |
| `--seat-*` | **Only** availability and seat state. Never decorative, never for text-heavy UI |

Seat and availability states, always colour **plus** a second cue:

| State | Token | Second cue |
|---|---|---|
| Free | `--seat-free` | Filled seat |
| Reserved (waiting for check-in) | `--seat-reserved` (violet) | Dashed outline, hollow |
| Occupied | `--seat-occupied` | Muted fill, no detail |
| On break | `--seat-break` | Muted fill + coffee-cup badge |
| Occupied, bookable (10 min left, not extended) | `--seat-bookable` (orange) | Orange fill + clock badge |
| Yours / selected | `--seat-yours` | Filled with a double ring |

Seat state rules (from the user flow):
- During the 20 to 10 min priority window, **other users still see the seat as Occupied**. Only the occupant sees their own seat in a priority state (banner on the session screen, no change on the map for others).
- At 10 min left with no extension, the seat becomes **Occupied, bookable** for everyone.
- A reserved seat whose reservation times out returns to Free.

Availability on cards: dot + the words ("12 free"). Dot colour by fill level: green plenty, amber few, red none (use `--danger`).
`--seat-occupied` is graphic-only. Its contrast is too low for text.

## Typography
- Body 16px (`--fs-body`), secondary 14px, never below 12px.
- Section labels: `--fs-label`, uppercase, bold, `--ls-label` tracking, `--text-muted`.
- Screen title 28px, card title 20px, medium or semibold weights only for emphasis. Do not use italic.
- Countdowns use `--fs-timer` with `font-variant-numeric: tabular-nums` so digits don't jiggle.
- Links are underlined.

## Layout & spacing
- 4px base. Allowed steps: 4, 8, 12, 16, 24, 32 (`--sp-*`). Screen gutter 16px.
- Primary button is pinned to the bottom with safe-area padding. Content scrolls above it.
- Test long text: a study-space name of 40+ characters must wrap or truncate cleanly.

## Components
- **Card:** `--surface`, 1px `--border`, `--radius-card`, no shadow. Optional 4px left stripe for status.
- **Button:** 48px high, `--radius-control`.
  - Primary: accent fill, `--on-accent` text.
  - Secondary: transparent, 1px accent border, accent text.
  - Danger: transparent, 1px `--danger` border and text.
- **Input / search:** 48px, `--radius-control`, 1px border, search icon inside, visible placeholder.
- **Seat:** minimum 44px touch target even if the drawn seat is smaller. Show seat number on selection.
- **Banner (session phases):** `--surface` with a 4px accent stripe, icon + text + one action.
- **Icons:** outline style, 1.75px stroke, 24px, `currentColor`. Same icon set across all screens.

## Accessibility
- Text contrast at least 4.5:1, graphics and borders at least 3:1 (hairline `--border` dividers are decorative and exempt).
- Visible focus ring on everything focusable: 2px `--focus`, 2px offset.
- Touch targets at least 44px. Real `<a>` / `<button>` elements. No clickable `<div>`.
- Label every icon-only control (`aria-label`). Seat map seats are buttons with labels like "Seat 14, free".
- Motion only on `transform` and `opacity`, 150 to 250ms, and respects `prefers-reduced-motion` (handled in tokens).

## Navigation (mock behaviour)
- Moving between screens is a styled `<a href>`. Relative paths so the files open from disk.
- Flow: Home → Seat arrangement → Reservation → QR scan → Session.
- Fake state (selected seat, countdown) is hardcoded or a few lines of JS. Keep it tiny.

## Screens
Source of truth for the flow: `user-flow.drawio.xml`.

1. **Home:** search bar, three recent/favourite study-space cards (free count + status), map placeholder.
2. **Seat arrangement:** top-down floor plan, six seat states, legend. Secondary button "Reserve any seat" (app picks one). Tapping a free seat opens the reserve bottom sheet.
   - **Reserve sheet** (not a screen): seat summary, note "held for X minutes", primary "Reserve", secondary "Cancel". Confirming turns the seat Reserved and goes to screen 3.
3. **Reservation:** seat / room / building summary, X:00 check-in countdown, primary "Check in" (scan), secondary "Cancel reservation".
4. **QR scan:** dark camera viewfinder mock, scan frame, hint text, flashlight toggle, back button. Reused when extending. Error state: "You don't seem to be at this seat" (location check failed).
5. **Session:** 2h countdown, seat info, buttons Extend (only in extension phases), Break, End session. Banner only in two phases: priority extension (20 min left, only you) and open extension (10 min left, everybody). No banner in the normal phase. Break state: timer pauses or shows a break timer, seat shows the cup badge.
   - Extend asks "Are you sure you want to extend?" then goes through the QR scan again on purpose, then back to the reserve sheet flow.

Notifications are push banners, not screens. Mock at most as a banner component: check-in reminder (X-3 min), seat lost, priority window (T-20), open window (T-10), session end (with "someone reserved this seat, please hand it over" note if booked), your booked seat is free early.

## Open items
- Reservation hold time X and extension length are not fixed yet. Use placeholders (10 min hold, 30 min extension) in mocks.
- "Seat is taken when I arrive": the flow marks it unsolved (trust-based). Mock nothing for now.

## Working together
- Split by screens, not by shared files. `tokens.css` and base styles change only after a quick message.
- Commit small, pull often, one commit per screen.

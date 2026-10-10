# Design rules

Mock screens for the ETH study-space seat reservation app. Plain HTML + CSS, no build step.
Values live in `tokens.css`. **This file says how to use them.** If a rule and a screen disagree, fix the screen.

## Direction
- Copy the visual language of the ETH EduApp: warm dark brown, uppercase labels, outline icons. Soft shapes (7px cards, 5px controls) with a light shadow, thin outline kept on every card.
- App name on screens is a placeholder: **Study Spaces**. One word to change later.
- Components come from the shared set (button, chip, tab, input, search, dropdown, toggle, checkbox, notice, table card, seat marker, break timer, QR check-in, modal, app header, bottom navigation). Reuse them; do not restyle per screen.
- Phone first, 390px wide. On desktop, centre a 390px column. Do not stretch.
- Dark is the default theme. Light is toggled with `<html data-theme="light">`. Every screen must work in both.
- Font: DIN Next LT W05 (ETH's licensed font, used if installed), falling back to Barlow (Google Fonts). We do not ship DIN files.

## Files
One version of everything. Nothing is duplicated.

| File | What it is |
|---|---|
| `tokens.css` | Every colour, size and motion value, dark default + light |
| `base.css` | Every shared component, plus the icon set |
| `base.js` | Shared script: theme switch, bottom sheets, banners |
| `index.html` | Home of the mocks, links to every screen |
| `design-system.html` | Live view of the tokens (switch theme to see both) |
| `components.html` | Every component with copyable HTML, and the popups to try |
| `screens/_template.html` | Copy this to start a screen |
| `screens/NN-name.html` | The screens, in flow order |
| `docs.css` | Layout of the guide pages only. Screens never load it |
| `admin.css` | Layout and parts for the admin dashboard only (side menu, tables, dialogs). Student screens never load it |
| `admin/users-data.js`, `admin/users.js` | Local sample data and interactive Users UI; no backend calls |
| `admin/NN-name.html` | The admin dashboard pages, desktop-first |
| `user-flow.drawio.xml` | The user flow, source of truth |

To start a screen: copy `screens/_template.html` to `screens/01-home.html`, build it from the parts on `components.html`, and link its primary button to the next screen.
A new component goes into `base.css` **and** `components.html`, in the same commit.

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
| Reserved (waiting for check-in) | `--seat-reserved` (violet) | Solid fill + seat number; state label in details / info |
| Occupied | `--seat-occupied` | Solid gray fill + seat number; state label in details / info |
| On break | `--seat-break` (bronze) | Solid fill + coffee-cup badge + seat number |
| Occupied, bookable (10 min left, not extended) | `--seat-bookable` (orange) | Solid fill + clock badge + seat number |
| Yours / selected | `--seat-yours` | Filled with a double ring |

Seat state rules (from the user flow):
- During the 20 to 10 min priority window, **other users still see the seat as Occupied**. Only the occupant sees their own seat in a priority state (banner on the session screen, no change on the map for others).
- At 10 min left with no extension, the seat becomes **Occupied, bookable** for everyone.
- A reserved seat whose reservation times out returns to Free.

Availability on study-space cards: dot + the words ("12 free", "3 free · almost full", "0 free · full"). Dot uses `--avail-high` (green), `--avail-mid` (amber) or `--avail-none` (red). Amber exists only here and never on seats.
`--seat-occupied` is a fill colour. Seat numbers on this fill use `--on-seat-muted`, including light mode.

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
- **Card:** `--surface`, 1px `--border`, `--radius-card` (7px), `--shadow`. Optional 6px left stripe (`--stripe`) for status. On dark the shadow is faint, so the outline carries the shape.
- **Button:** 48px high, `--radius-control` (5px).
  - Primary: accent fill, `--on-accent` text.
  - Secondary: transparent, 1px accent border, accent text.
  - Danger: transparent, 1px `--danger` border and text.
- **Input / search:** 48px, `--radius-control`, 1px border, search icon inside, visible placeholder.
- **Seat:** minimum 44px touch target even if the drawn seat is smaller. Show seat number on selection.
- **Banner (session phases):** `--surface` with a 6px accent stripe (`--stripe`), icon + text + one action.
- **Countdown:** `<p class="t-timer" data-countdown="552" data-total="600">` inside a `.timer-card` with a `.progress` bar. It ticks by itself and shrinks the bar. Use it on Reservation (check-in time) and Session (time left).
- **Icons:** outline style, 1.75px stroke, 24px, `currentColor`. Same icon set across all screens.

## Accessibility
- Text contrast at least 4.5:1, graphics and borders at least 3:1 (hairline `--border` dividers are decorative and exempt).
- Visible focus ring on everything focusable: 2px `--focus`, 2px offset.
- Touch targets at least 44px. Real `<a>` / `<button>` elements. No clickable `<div>`.
- Label every icon-only control (`aria-label`). Seat map seats are buttons with labels like "Seat 14, free".
- Motion only on `transform` and `opacity`, 150 to 250ms, and respects `prefers-reduced-motion` (handled in tokens).

## Popups and notifications
Two kinds only. Do not invent a third.

### 1. Decision sheet (bottom sheet)
Used whenever the user must choose before something happens.
- Slides up from the bottom, full width, rounded top corners, a small drag handle on top, a close (X) in the top right.
- The screen behind is dimmed (`--overlay`) and can't be tapped.
- Contents, in order: title (what will happen), one or two lines of detail, then two buttons.
- **Two equal-width buttons side by side.** Left: the safe option, outlined (Cancel, Keep seat, Not now). Right: the action, filled in accent. For risky actions (End session, Cancel reservation) the right button is outlined in `--danger` instead.
- Button labels are verbs, never "Yes" / "No": "Reserve seat 14", "Extend session", "End session", "Keep seat".
- The popup's two buttons are its own choice. The rule "one primary action per screen" still applies to the screen underneath.
- Closing by any of these (tap the dim area, swipe down, X) counts as the safe option. It never confirms anything.
- Motion: slide up about 250ms (`--dur-base`), dim fades in. With reduced motion it just appears.
- Keyboard: focus moves into the sheet, stays there, Esc closes it, focus returns to the button that opened it. Screen readers get `role="dialog"` and the title as its label.

Which actions use a decision sheet (all of them ask first):

| Action | Title | Right button |
|---|---|---|
| Reserve a seat | "Reserve seat 14?" + note "Held for X minutes. Check in before it runs out." | Reserve seat 14 |
| Extend session | "Extend your session?" + note "You'll scan the QR code again." | Extend session |
| Cancel reservation | "Cancel reservation?" + seat is released | Cancel reservation (danger) |
| End session | "End session?" + seat is freed for others | End session (danger) |
| Start a break | "Take a break?" + break length and what happens to the seat | Start break |

### 2. Notification banner
Used to tell the user something happened. No decision needed (at most one action button).
- Slides in from the top, over the content, with an icon, one short line of text, and optionally one button.
- Auto-dismisses after about 6 seconds, except urgent ones, which stay until tapped or swiped away: check-in reminder, seat lost, session end with the hand-over note.
- Announced to screen readers (`role="status"`, or `role="alert"` for the urgent ones).
- Same six messages as in the user flow: check-in reminder, seat lost, priority window opens (T-20), everybody can extend (T-10), session ended, your booked seat is free early.

### Not popups
- Errors on a screen (for example "You don't seem to be at this seat") are shown in place, inside the screen, not as a popup.
- The extension phases on the session screen are a banner in the page, not a popup.

## Navigation (mock behaviour)
- Moving between screens is a styled `<a href>`. Relative paths so the files open from disk.
- Flow: Home → Seat arrangement → (Reserve sheet) → Reservation → QR scan → Session → Home.
  - Every card on Home opens the seat map (it is always HG E 41 in the mock).
  - Tapping Reserve on the seat map opens the reserve sheet. Confirming goes to `03-reservation.html?seat=N`.
  - The chosen seat number is remembered in the browser. Any element with `data-seat` shows it, so every screen says the same seat. Never hardcode a seat number in a screen, write `Seat <span data-seat>14</span>`.
  - Check in → QR scan → Session. Break, extend and end loops are described under Session.
  - Ending the session or cancelling the reservation goes back to Home and clears the booking.
  - Every button and link must lead somewhere. Run the click-through before pushing.
- Fake state (selected seat, countdown) is hardcoded or a few lines of JS. Keep it tiny.

## Screens
Source of truth for the flow: `user-flow.drawio.xml`.

1. **Home:** the app name "Study Spaces" with the theme switch and the profile picture on the right (scrolls away), then a pinned search bar, a "Reserved" card only while a seat is held (links to Reservation), favourite study-space cards in a swipe row, tall map placeholder. The mock remembers the reservation in the browser: opening Reservation sets "reserved", opening Session sets "session" (the card then says "In session"), cancelling or ending clears it. `?state=reserved`, `?state=session` or `?state=none` on the URL forces it.
2. **Seat arrangement:** top-down floor plan, colour-coded seats. The state key opens from an info (i) button at the top of the map; it is not a permanent legend. No visible drag / pinch instructions. Secondary button "Reserve any seat" (app picks one). Tapping a free seat opens the reserve bottom sheet.
   - **Reserve sheet** (not a screen): seat summary, note "held for X minutes", primary "Reserve", secondary "Cancel". Confirming turns the seat Reserved and goes to screen 3.
3. **Reservation:** seat / room / building summary, X:00 check-in countdown, primary "Check in" (scan), secondary "Cancel reservation".
4. **QR scan:** dark camera viewfinder mock, scan frame, hint text, flashlight toggle, back button. Reused when extending. Error state: "You don't seem to be at this seat" (location check failed), shown in place as a danger notice. In the mock, tapping the frame counts as a successful scan, and `?error=1` shows the error.
5. **Session:** 2h countdown, seat info, buttons Extend (only in extension phases), Break, End session. Banner only in two phases: priority extension (20 min left, only you) and open extension (10 min left, everybody). No banner in the normal phase. Break: starting and ending a break each go through the QR scan (`04-qr-scan.html?from=break-start` and `?from=break-end`), and the QR screen words its title to match. The session clock keeps running. A break timer (counting down the remaining break allowance) appears above it, the seat shows the cup badge, and "Back at my seat" is the primary action.
   - Extend adds 2 hours. It asks first, then goes through the QR scan again on purpose, then returns here with a "Session extended" banner.

6. **Profile** (extra, not in the flow): opens from the picture on Home. Back arrow, avatar with name and read-only email, editable display name, secondary photo picker with preview/removal, and three notification toggles. Save changes is the single primary action in the bottom action bar; editing never changes login identity. Show validation/save errors in place and a notification banner after saving. Photos accept JPEG/PNG/WebP up to 2 MiB and 16 megapixels.

Notifications are push banners, not screens. Mock at most as a banner component: check-in reminder (X-3 min), seat lost, priority window (T-20), open window (T-10), session end (with "someone reserved this seat, please hand it over" note if booked), your booked seat is free early.

## Open items
- All timing comes from the backend config (`backend/app/config.py`, served by `GET /api/v1/rules`). Defaults: hold time (check-in window) 15 min, session and extension 2 hours, 30 min of breaks in total per reservation. A break lasts until you scan back in or the allowance runs out, and it does not pause the session clock (decided).
- "Seat is taken when I arrive": the flow marks it unsolved (trust-based). Mock nothing for now.

## Admin dashboard (desktop)
For the people who run the study spaces. Lives in `admin/`, loads `tokens.css`, `base.css` and `admin.css`.
**Same look as the student app:** the same tokens, colours, fonts, seat-state meanings and the same two kinds of popup. Only the layout changes, because it is for a laptop.

### Layout
- **Desktop first.** Designed for 1280px and wider. It must not break on a phone (the side menu becomes a top bar under 900px), but it is not optimised for one.
- **Side menu** on the left, `--sidebar-w` wide: the app name with "Admin", the menu, and at the bottom the theme switch.
- **Page:** content is centred, at most `--content-max` wide, with 32px padding.
- **Page header:** title on the left (28px heading) with one muted line below it, the page's **one primary action on the right**. The "primary pinned at the bottom" rule is for the phone app. On desktop it is top right.
- **Sub-menu (tabs as links)** under the header when a page has sections, for example a space: Seats, Opening hours, Closures, Layout, Settings. The current one is underlined.
- Content is built from cards and tables. No shadows beyond the card shadow, no extra colours.
- **Notification banners** ("Updated", "Closure created") slide in at the bottom **right**, so they never cover the page title or its buttons. Same rules as the student app: fade after 6 seconds, urgent ones stay.

### Tables
- Hairline border, `--radius-card`, header row in the label style (12px caps, muted). Rows are `--row-h` (64px) high so buttons keep a 44px target.
- Text left, numbers right and tabular. Status is a chip **with a word**. Never colour alone.
- Row actions on the right as quiet buttons. A risky action (end reservation, delete) is a quiet button in `--danger`.
- The name in the first column is the link. The whole row is not clickable.
- Empty table: one line saying why it is empty and one button that fixes it.
- Live tables show "Updated 10:42:05" and a Refresh button. They never move rows by themselves.

### Forms
- Labels above the field, helper text under it, errors inline in `--danger` with a message that says what to do.
- Two columns on desktop, one on a phone. Fields use the shared 48px inputs.
- Buttons at the bottom right of the form: the safe one (Cancel) on the left, the action (Save) on the right, filled.

### Dialogs
- A centred box, `--dialog-w` wide, with the dimmed screen behind. Title, one or two lines, footer with the buttons on the right: safe option left (outlined), action right (filled, or `--danger` outline when risky). Labels are verbs.
- Closes with the X, Esc or a click outside, and all of those mean "no".
- The student app's decision sheet and this dialog are the same rule: **ask before anything that changes bookings.**

### Changing bookings: the impact preview (two steps)
Anything that can change existing bookings (closing a space or seat, deleting a closure, switching a seat off, changing opening hours) never applies silently.
1. The admin fills in the form and chooses **Preview impact**. Nothing is changed yet.
2. A dialog lists every affected booking: the person, the seat, the action and the time before and after. The action is a chip with a word: **Cancel** (red), **Shorten** (orange), **Shift** (blue).
3. **Apply changes** confirms (red outline if anything is cancelled), **Back** returns to the form. If nothing is affected the dialog says "No bookings are affected" and offers Apply.
4. A banner confirms afterwards.
The backend works the same way: the first request is refused with the list of affected bookings, and repeating it with `force=true` applies it.

### Seat and space states in admin
The backend reports six seat states. Admin shows them with the same colours and markers as the student app, and always the word:

| Backend | Admin chip | Notes |
|---|---|---|
| `free` | Free | Nobody has it reserved or is using it |
| `reserved` | Reserved | Reserved and waiting for check-in, or booked for later |
| `occupied` | Occupied | A checked-in session. Only these count in the "Occupied" number |
| `on_break` | On break | Away from the seat, session still running |
| `claimable` | Bookable | Occupied but in its last 10 minutes, others may reserve it |
| `unavailable` | Switched off, or Closed | Can't be reserved now. **Switched off** means an admin turned the seat off (`is_active` is false). **Closed** means a closure or the opening hours. Same muted look, different word |

- "Free" in the counts is only the `free` state. Reserved, switched-off and closed seats never count as free.
- A space shows **Open** or **Closed** as a chip with the word.
- Booking changes in the impact preview use three more chips: **Cancel** (red), **Shorten** (orange), **Shift** (blue).

### Sample data for the mockups
Use the backend's demo spaces so the mockups match what will be wired later: "Hauptbibliothek · Lesesaal" and "Baubibliothek · Hönggerberg", four seats each, time zone Europe/Zurich. People, reservations and opening hours are made up (the backend's demo is open 24/7, the hours mockup shows a realistic week). The mockups never connect to anything.

## Working together
- Split by screens, not by shared files. `tokens.css` and base styles change only after a quick message.
- Commit small, pull often, one commit per screen.


### Users and activity (mockup proposal)
- Users appears directly below Spaces in the admin side menu. The directory links to an individual profile for every sample user.
- Directory metrics use the last 30 days; the profile separates that summary from the dated weekly activity chart and recent reservations.
- Study time means checked-in time excluding breaks. Waiting for check-in, cancelled reservations and missed arrivals count as zero study time.
- Booking status uses existing seat-state chips; historical outcomes use neutral labelled chips. Activity charts use the accent token, never seat-state colours.
- Users is an interactive local mockup: search, booking-status filters, sorting, validated profile editing, reservation details, full history and confirmed reservation ending work against sample data. Changes persist in browser storage; Reset demo data restores the initial dataset after confirmation.
- Sample people and statistics are fictional; summary numbers and charts are derived from the same reservation records. The current backend provides user IDs on reservations but no user directory, profile-management or user-history endpoint. Backend integration remains future work.

### Create spaces and layout editor (local mockup)
Select a room on the sample backend-style floor map, name it and create the space. Creation opens its furniture editor. The backend-owned polygon remains fixed; tables, seats, windows and doors are editable local objects. Windows and doors snap to walls. Seats and tables use the phone map's dimensions, numbering and design tokens. Save layout persists furniture and recalculates seat totals. This mockup makes no backend calls and does not modify the React student fixture.

The furniture editor is the Layout tab inside the original room menu. Spaces > Manage opens Seats with current occupants and reservations; Opening hours, Closures and Settings remain available. Create space enters Layout directly, and all room tabs preserve the selected space ID.

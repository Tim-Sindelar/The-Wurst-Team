# Agent and contributor rules

## Frontend (`frontend/`)

React 19, Vite, TypeScript, Mantine 9, Tailwind CSS 4, React Router, TanStack Query.
The screens implement the mockups in `design/`. `design/design-rules.md` is the source of truth for how the app looks and behaves; when it and the code disagree, fix the code. When the design changes, port it here.

### Where things live

| Path | What it is |
| --- | --- |
| `src/styles.css` | Design tokens as a Tailwind `@theme` (dark), the light overrides, base styles |
| `src/theme/theme.tsx` | Mantine theme: type scale, radii, default props, variants, and which `ui-*` class each component part gets |
| `src/theme/components.css` | The `ui-*` classes: how every Mantine component looks |
| `src/components/` | Shared building blocks: `Screen` frame, `DecisionSheet`, `StatusBanner`, `TimerCard`, `SeatChip`, `Icon`, the seat map |
| `src/screens/` | One file per screen, in flow order: Home, SeatMap, Reservation, Scan, Session, Profile |
| `src/domain/` | Domain types and per-state lookups (seat states, labels, state classes) |
| `src/mock/` | Sample data and the mock booking state. Replaced by API data later |
| `src/routes.ts` | Screen paths |
| `src/campus-map/` | The campus map screen (`/map`), ported from the view mode of `occupancy-map-preview/`. See "Campus map" below |
| `map-data/` | The campus map's configuration: `generated.json` + `overrides.json` (workspaces), `map-style.json` (map colours per theme), `navigation.json` (click-to-zoom areas). Copied from `occupancy-map-preview/data` with `npm run map:sync` |
| `server/` | The campus map's backend for now: Vite middleware copied from `occupancy-map-preview/server` (map data, ETH room bookings, campus datasets, floor plans) |
| `src/api/generated/` | Generated API client. Never edit by hand; run `make generate` |

### Styling

1. **Tokens only.** No hex codes or raw pixel values for colour, spacing, radius, type or shadow in components or screens. Use token utilities: `bg-surface`, `text-text-muted`, `border-border-strong`, `rounded-card`, `shadow-card`, `text-title`, `p-4`. Tailwind's default palette, type scale, radii and shadows are removed, so only design tokens exist. If you need a new value, add a token to `src/styles.css` (dark in `@theme`, light under `[data-mantine-color-scheme='light']`) and to `design/tokens.css`.
2. **Mantine components are styled once, in the theme.** Each component gets `ui-*` classes in `src/theme/theme.tsx`, defined in `src/theme/components.css` with `@apply` inside `@layer components`. Screens pick a variant and never restyle a component's colours, borders or type. To change how a component looks, change `components.css`. Use a utility class on one instance only for layout (`flex-1`, `mt-2`, a card's status stripe).
3. **Layers decide who wins:** `theme < base < mantine < components < utilities`. Theme classes beat Mantine's defaults, and utilities beat theme classes. Don't use `!important`, and don't put utility classes in theme `classNames` (they would tie with screen classes).
4. **Tailwind for everything custom**: layout, spacing, one-off elements. No CSS modules and no new CSS files. Inline `style` is only for computed geometry (seat positions on the map).
5. **Write class names out in full.** Tailwind only finds literal strings, so `` `bg-seat-${state}` `` will not work. Put per-state classes in a lookup (`stateVar`, `stripeClass` in `src/domain/seat.ts`).
6. **Both themes.** Dark is the default; light is toggled by `ThemeToggle` through Mantine's colour scheme. Check every change in both.

### Components and variants

| Need | Use |
| --- | --- |
| Button | `Button` with `variant="primary"` (default), `"secondary"`, `"danger"` or `"quiet"`. Links: `component={Link} to=...` |
| Icon-only button | `ActionIcon` with `variant="icon"` (default, 44px), `"map"` (32px map control) or `"camera"`. Always give it an `aria-label` |
| Card | `Card`; add `stripeClass[state]` for the 6px status stripe |
| Seat state chip | `SeatChip state=... [plain]` (Mantine `Badge` underneath) |
| In-page notice | `Alert` with `variant="info"` (default), `"warning"` or `"danger"` |
| Countdown | `TimerCard` (label, ticking time, progress bar) |
| Decision before an action | `DecisionSheet`: safe option left (outlined), action right; `actionTone="danger"` for end or cancel |
| Something happened | `StatusBanner` (auto-hides after 6s unless `urgent`) |
| Toggle | `Switch` with a `label` |
| Text | `Title order={1}` is the 28px screen heading, `order={2/3}` the 20px title (add `text-heading` for a heading-sized `h2`). `Text size="sm"` for secondary text, `c="dimmed"` for muted. Section labels: `SectionLabel`. Timers: `text-timer tabular-nums` |
| Icons | `Icon` from `src/components/Icon.tsx` only (24px outline, 1.75 stroke). Add new icons there |
| Screen layout | `Screen` > `ScreenHeader` (back, title, theme switch) > `ScreenMain` > `ActionBar` |

Only two kinds of popup exist: the decision sheet and the notification banner. Don't add a third. (The campus map's bottom sheets, `MapSheet`, use the decision sheet's frame for its settings and its room dashboard.) Errors on a screen are shown in place as a `danger` notice.

### Design rules that apply to code

- One primary (accent-filled) action per screen, in the `ActionBar`, full width.
- Never use colour alone: every state also has a label, icon or shape. Seat-state colours (`seat-*`) are only for seat state and availability.
- Touch targets are at least 44px. Use real links and buttons, never clickable `div`s. Label every icon-only control.
- Visible focus ring on everything focusable (Mantine's focus ring is mapped to `--color-focus`).
- Motion only on `transform` and `opacity`, 150 to 250ms, and respect reduced motion.
- Text never below 12px; long names (40+ characters) must wrap or truncate cleanly.
- Phone first: a 390px column, centred on desktop. Don't stretch layouts wider.

### Campus map

- The map screen is full screen: top bar (back, title, theme), Leaflet map, floor picker on the right, and a bottom toolbar (time, live rooms, campus data, map options) whose buttons open `MapSheet` bottom sheets.
- Tapping a room, workspace or pin selects it and shows a card above the toolbar; tapping it again (or the card) opens the dashboard sheet with its details and the lists the preview had in its side panel.
- The map components keep their own markup and class names, styled in `src/campus-map/campus-map.css`, the one plain CSS file outside `src/theme`. Its colour names point at the design tokens. Colours drawn on the map come from `map-data/map-style.json`. The ESLint React Compiler rules are off for this folder (the Leaflet layers rely on latest-value refs).
- `occupancy-map-preview/` stays the developer tool for the map: its Admin mode edits workspaces and navigation, its Style panel edits the map style. After saving there, run `npm run map:sync` here. There is no admin or style editor in this app.
- Floor plans are read from `occupancy-map-preview/public/floors` (built by `scraper/extract_floors.py`, not in git), or from `MAP_FLOORS_DIR`.

### Data and state

- The screens are mocks: no backend calls yet. Sample data lives in `src/mock/data.ts`. The chosen seat and booking state (`none`, `reserved`, `session`) live in `MockBookingProvider` and persist in `localStorage`.
- Mock-only URL switches mirror the HTML mockups: `/?state=reserved|session|none`, `/session?phase=priority|open|break`, `/session?extended=1`, `/scan?from=extend|break-start|break-end`, `/scan?error=1`.
- When wiring the backend, fetch with the generated TanStack Query helpers from `src/api/generated/` and replace the `src/mock` imports screen by screen. Don't hand-write fetch calls or API types.

### Code conventions

- Files that export components export only components (React Fast Refresh). Put contexts, hooks and constants in their own files.
- Dependencies are pinned to exact versions in `package.json`.
- Before pushing, run `npm run lint`, `npm run typecheck` and `npm run build` in `frontend/`. For visual changes, compare the screen against its mockup in `design/screens/` in both themes.

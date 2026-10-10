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
| `src/hooks/` | `useMyReservation` (the live booking, server-clock helpers, refetch at deadlines), `useQrScanner`, `useNow`, `useCountdown` |
| `src/routes.ts` | Screen paths |
| `src/campus-map/` | The campus map screen (`/map`), ported from the view mode of `occupancy-map-preview/`. See "Campus map" below |
| `src/api/generated/` | Generated API client. Never edit by hand; run `make generate` |
| `src/pwa.ts`, `pwa/service-worker.js`, `public/manifest.webmanifest`, `public/icons/` | The installable app: worker registration, the service worker (the `service-worker` plugin in `vite.config.ts` emits it as `sw.js`), the manifest and the app icons. See "Installable app" below |

### Styling

1. **Tokens only.** No hex codes or raw pixel values for colour, spacing, radius, type or shadow in components or screens. Use token utilities: `bg-surface`, `text-text-muted`, `border-border-strong`, `rounded-card`, `shadow-card`, `text-title`, `p-4`. Tailwind's default palette, type scale, radii and shadows are removed, so only design tokens exist. If you need a new value, add a token to `src/styles.css` (dark in `@theme`, light under `[data-mantine-color-scheme='light']`) and to `design/tokens.css`.
2. **Mantine components are styled once, in the theme.** Each component gets `ui-*` classes in `src/theme/theme.tsx`, defined in `src/theme/components.css` with `@apply` inside `@layer components`. Screens pick a variant and never restyle a component's colours, borders or type. To change how a component looks, change `components.css`. Use a utility class on one instance only for layout (`flex-1`, `mt-2`, a card's status stripe).
3. **Layers decide who wins:** `theme < base < mantine < components < utilities`. Theme classes beat Mantine's defaults, and utilities beat theme classes. Don't use `!important`, and don't put utility classes in theme `classNames` (they would tie with screen classes).
4. **Tailwind for everything custom**: layout, spacing, one-off elements. No CSS modules and no new CSS files. Inline `style` is only for computed geometry (seat positions on the map).
5. **Write class names out in full.** Tailwind only finds literal strings, so `` `bg-seat-${state}` `` will not work. Put per-state classes in a lookup (`stateVar`, `stripeClass` in `src/domain/seat.ts`).
6. **Both themes.** Dark is the default; light is switched on the Profile screen (`ThemeSwitch`) through Mantine's colour scheme. Check every change in both.

### Components and variants

| Need | Use |
| --- | --- |
| Button | `Button` with `variant="primary"` (default), `"secondary"`, `"danger"`, `"quiet"` or `"map"` (32px text button floating on the room map). Links: `component={Link} to=...` |
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
- Phone first: below 480px (the `tablet` breakpoint) screens fill the full width with no side margins; from 480px up they are a centred 390px column. Don't stretch layouts wider. Headers and `SafeAreaTop` (Home) keep clear of the notch with `env(safe-area-inset-top)`.

### Campus map

- The map screen is full screen: top bar (back, title, theme), Leaflet map on the clean base map, a floor wheel on the right (one letter per floor: the letter the building in focus uses; the floor numbers themselves are untouched), and a bottom bar with the workspace search. The workspace list lives in a `MapSheet` bottom sheet, never in a popup.
- The layers button at the top right (`map/ModeControl.tsx`) opens the "Map view" sheet with a three-step slider (`mapMode.ts`): **Study spaces** shows only the workspaces of the bookable study spaces (`GET /api/v1/spaces`, matched to the workspace containing its `map_room_id`, else by name and position), **Workspaces** shows every workspace with live rooms, **Campus** adds the ASVZ sport and mensa datasets. The same sheet has the 3D switch (on by default). The 3D stack always draws its visible edges faintly: the outline parts that change from one floor to the next, the lowest outline and the corners, minus those hidden behind the stack as seen from the south and above. The home button (below the zoom buttons, `NavZones`) flies to a campus area zone (Zentrum first): from one campus view to the other, from anywhere else to the nearest. The map opens on the Zentrum view (both campuses until the navigation zones have loaded). Everything else (other datasets, the time picker, detailed floor plans, other base maps, free rooms and UZH lists) is off and has no switch.
- Tapping a room, workspace or pin selects it and shows a card above the toolbar; its info button (or a second tap) opens the popup (a `MapSheet`). When the selection is a bookable study space (a workspace containing the space's `map_room_id`, else matched by name and position, or the ETH room itself), the card and the popup have a full-width "Open room plan" button to the space's seat map. There are no hover tooltips.
- A workspace popup shows the booking status and photos of its ETH rooms, and a workspace that is also a mensa is drawn in the mensa's color with its menu in the popup, with live rooms and the mensa layer off too. The ETH room list is fetched the first time such a popup opens, the mensa items once the map is zoomed in.
- The map components keep their own markup and class names, styled in `src/campus-map/campus-map.css`, the one plain CSS file outside `src/theme`. Its colour names point at the design tokens. Colours drawn on the map come from the backend's map style (`GET /api/v1/map/style`). The ESLint React Compiler rules are off for this folder (the Leaflet layers rely on latest-value refs).
- All map data comes from the backend feature `backend/app/features/campus_map/` under `/api/v1/map`: workspaces, map style and navigation (Postgres), ETH room bookings, campus datasets and floor plans. The loaders in `src/campus-map/data/`, `datasets/repository.ts` and `map/minimalStyle.ts` call it through the generated client (`unwrap` in `data/api.ts`); floor plans and room photos are plain URLs under `MAP_API`. The map needs `make backend` running.
- The 3D view (`map/Floors3D.tsx`) stacks only the building group in focus. Groups are the buildings inside each building zoom zone, hardcoded in `map/buildingGroups.ts`; update that list when the zones change. Floor letters come from the room names and the scraper counts floor numbers per building, so once loaded the map shifts each zoned building's floor numbers to line up by letter with the zone's main building (`letterOffsets` in `buildingGroups.ts`, applied in `CampusMap` to the floor index, the workspaces and the room and mensa places): a floor shows every level with the same name, even at different heights (I counts as J). Every floor is drawn with its own outline (the group's levels on that floor merged), so the stack follows the real shape, and the floor with the `E` letters stays in place, so floors above it (the selected one too, with its workspaces and pins) are drawn further north. With 3D on, at every zoom, every group not stacked is drawn as its footprint only: the group's merged outline (all its floors together), flat in its real place, with no floor plan, workspaces or pins. The floor wheel then lists only the stacked group's floors (and hides without one); a group without the selected floor switches to its nearest one. In 2D too, only the selected floor's workspaces and pins are drawn. Room layouts show from the lowest zoom a building zone flies to (`roomZoom` in `MapView`).
- `occupancy-map-preview/` stays the developer tool for the map: its Admin mode edits workspaces and navigation, its Style panel edits the map style. After saving there, run `make map-sync` to import the files into the backend. There is no admin or style editor in this app.
- The backend Docker build generates floor plans and workspace outlines into `/app/floors` and sets `MAP_FLOORS_DIR` to that directory. Outside Docker, floor plans are read from `occupancy-map-preview/public/floors` (built by `make map-floors`, not in git), or from the backend's `MAP_FLOORS_DIR`.

### Installable app (PWA)

- The app installs from https://02.hackathon.ethz.ch (and from each PR preview, as a separate app). The manifest uses relative URLs (`./`) and the worker registers at `BASE_URL`, so both work under `/pr/N/`. The manifest link has `crossorigin="use-credentials"` because the organisers' login proxy needs the session cookie.
- The service worker only exists in production builds. It caches the app shell on install, serves hashed `assets/` from the cache, goes to the network first for pages (offline: the cached `index.html`), and never touches `/api`. Production's worker leaves `/pr/` and `/ar/` alone. Every build gets a new worker that replaces the old one and its cache.
- Caddy serves `index.html`, `sw.js` and `manifest.webmanifest` with `no-cache`, so a deploy reaches installed apps on their next launch.
- The icon (`public/icons/icon.svg`, `public/favicon.svg`) is a seat map with your seat checked. After changing it, re-render `icon-192.png`, `icon-512.png` (also the maskable icon, so keep the artwork within the middle 80%) and `apple-touch-icon.png` (180px).
- `meta[name=theme-color]` follows the colour scheme (`--color-bg`), so the installed app's status bar matches the theme.

### Data and state

- Screens fetch with the generated TanStack Query helpers from `src/api/generated/` (`useQuery(listSpacesOptions())`, `useMutation(checkInMutation())`). Don't hand-write fetch calls or API types. The Vite dev server proxies `/api` to the backend on port 8000.
- The current booking comes from `useMyReservation()`. After any booking change call `useRefreshBooking()`'s function so Home, the seat map and the booking screens agree. Server timestamps go through `toClient()` so a wrong device clock can't skew countdowns.
- Failed calls are shown in place: use `apiProblem(error)` for the sentence, in a `danger` `Alert` or inside the `DecisionSheet`.
- Timing rules (check-in window, session length, extension windows, break allowance) are set in `backend/app/config.py` and read through `useRules()` (`GET /api/v1/rules`). Never hardcode them in the frontend.
- The API has no seat positions yet, so `src/domain/room.ts` places seats on a stand-in floor plan. Replace it with `SpaceDetail.layout` once the backend provides one.
- Profile (opened from the bottom navigation) uses `/api/v1/me` through `useCurrentUser`. Its account-card pencil opens `/profile/edit`, where name and photo edits save together through the generated `updateMeMutation` and return to Profile. Leaving with unsaved edits uses `DecisionSheet`. Photo uploads allow 12 MiB and 16 megapixels; the circular drag/zoom preview uploads a square 256×256 PNG. The backend persists these in `user_profiles` without changing auth identity. Profile also has the Appearance card with the dark theme switch.
- Favourites live in `favourite_spaces` and come through `useFavourites()` (`/api/v1/me/favourites`). The star updates at once and rolls back if the call fails. Home shows them as their own row and filters by the search box (`filterSpaces`, `favouriteSpaces` in `domain/space.ts`).
- Recents live in `recent_spaces` and come through `useRecents()` (`/api/v1/me/recents`, newest first, at most 10). The backend records a space when the user books a seat there or checks in by scan; the migration seeds it from past reservations. Home shows two swipeable rows under `SectionLabel`s: Favourites (`favouriteSpaces`) and Recent (`recentSpaces`, newest first); an empty row is hidden. There is no all-spaces row: typing in the search box replaces the rows with a plain vertical list of matches. Home has no link to the map. Booking changes refresh it through `useRefreshBooking`.
- Home search uses `filterSpaces`, a dependency-free similarity search (`domain/similarity.ts`): it forgives typos, word order, accents and partial words, and lists the best match first.
- Space cards are plain surface cards. When a space has a photo (`StudySpace.photoUrl`, unset until the API provides one) it shows behind the text, always blurred 2px and dimmed with `bg-photo-scrim`, and the text on it uses `text-on-photo`. There are no placeholder photos.
- The room screen (`/seats/:spaceId`, `SeatMapScreen`) is a full-bleed `SeatMap` under the header with nothing selected at first. Tapping a seat opens `SeatSheet` (a non-modal card at the bottom, not a third popup); its action opens the decision sheet to confirm. The `map` button "Choose any free seat" top right picks a random other free seat and is hidden while the user holds a seat. If the server answers `seat_unavailable` to a reservation (someone else was first), the sheet closes and a danger `Alert` "Seat X was just taken" with "Choose another seat" shows over the map; other errors stay inside the decision sheet.
- The notification switches on Profile save per-user preferences automatically in localStorage on this device; notification delivery is not implemented.
- Check-in, extend and break scans go through `/scan?from=extend|break-start|break-end`. The server checks the QR code by checking in at that seat, which changes nothing for a running session. Demo QR tokens are printed by `make seed`. The camera feed fills the scan screen, dimmed outside the scan frame; there is no typed-code fallback. The camera needs `localhost` or HTTPS. In dev (`npm run dev`) the scan screen also has "Skip scan (demo only)", which reads the seat's code through the demo admin stub (`X-Demo-Admin`); it is compiled out of production builds.

### Code conventions

- Files that export components export only components (React Fast Refresh). Put contexts, hooks and constants in their own files.
- Dependencies are pinned to exact versions in `package.json`.
- Before pushing, run `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` in `frontend/`. For visual changes, compare the screen against its mockup in `design/screens/` in both themes.

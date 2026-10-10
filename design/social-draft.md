# Social frontend draft

This is a working design preview, available locally at `http://127.0.0.1:5173/social-draft`
and in CI-deployed PR previews under `/pr/<number>/social-draft`. It uses isolated sample data
and does not call the social backend or modify live individual bookings. Navigation and sample mutations work so the
team can refine the experience before API integration.

`design-rules.md` continues to govern typography, spacing, themes, touch targets, and popups.
There are no new design tokens, component variants, stylesheets, or dependencies.

## Layout references

| Draft view | Existing visual reference | Main action |
| --- | --- | --- |
| Friends | `screens/06-profile.html`: avatars, cards, notification/privacy toggles | Add a friend |
| Manage friends | `screens/06-profile.html`: requests and friend list | Add a friend |
| Stalk my friends | `screens/01-home.html`: cards for shared rooms | Open campus map |
| Add a friend | `components.html`: text inputs, notices, secondary buttons | Send friend request |
| Study parties | `screens/01-home.html`: linked summary cards | Create a party |
| Create party | `screens/06-profile.html`: labelled form | Create party |
| Invite friends | `screens/06-profile.html`: friend cards with explicit Invite buttons | Done |
| Party detail | `screens/05-session.html`: summary, member cards, in-page notice | Join party / Choose seats / View my seat |
| Seat assignment | `screens/02-seat-arrangement.html`: same interactive room map and seat markers | Reserve seats together |
| Own reservation / session | `screens/03-reservation.html` and `screens/05-session.html`: seat stripe, chip, countdown | Check in / View party |
| Own QR scan | `screens/04-qr-scan.html`: labelled mock scan target | Scan the assigned seat |

Screens use the existing 390px `Screen` frame, `ScreenHeader`, `ScreenMain`, and pinned `ActionBar`.
Cards, buttons, switches, text, inputs, and notices use the Mantine theme. Native selects inherit
the shared Input theme; their arrows come from `Icon`. Long names wrap in content. Seat-state
colours appear only on seats and seat summaries. Non-seat membership states use text and icons.
Destructive decisions use the existing danger decision sheet, and confirmations use the existing
notification banner. Both colour schemes are supported through existing theme tokens.

The demo trials persistent **Home / Map / Friends** bottom navigation, outside the
scrolling viewport. Page actions sit above it, and the campus map fills the remaining viewport.
Friends is a short hub: privacy first, then Study parties and Stalk my friends under Study together,
and Manage friends under Friendships. Requests and removal live only in Manage friends; shared
rooms live only in Stalk my friends. There is no Friends/Parties toggle.
Create asks only for a name, then opens invitations. Each friend has an **Invite** button that
changes to **Invited**; there are no invitation switches. **Done** opens the party roster.
The parties list separates invitations from joined parties. Cancelled parties are hidden, including
in the hub count. A checked-in seat surviving cancellation stays accessible as Your ongoing session.
Cancellation retains the saved party and independent reservations; hiding it does not delete data.
Party invitations use direct friend selection, without shared party links. The recipient opens an
invitation under Study parties and taps Join to open the existing consent sheet. In this mock,
  open Anna’s study group to test the recipient experience as yourself.

Routine confirmation banners appear in the page and never cover navigation. Privacy switches
update immediately without a notification. Urgent notices remain floating below the header.

Preview tools are collapsed below the product screen. They contain reset, booking-conflict controls,
and (on party detail/reservation) a perspective selector. These controls are not product UI.

## Preview walkthrough

1. Open Friends through the bottom navigation or `/social-draft`. Room sharing is off by default
   and its setting is at the top. Open Manage friends to accept Nora's request, cancel Felix's request, filter the friend list,
   or remove a friend through a decision sheet.
2. Open Add a friend. Use **Try Sam’s sample invite**, then send a request.
   Copying your own invite link works; opening that link does not automatically send a request.
3. Open Study parties, create a party, give it a name, invite friends with their Invite buttons, then press Done.
   Open Parties to see the new party alongside the sample Afternoon study party. Both have their
   own `/social-draft/party/:partyId` links, and remain saved after visiting Home or reloading.
4. The local demo starts with one invitation to Anna’s study group and one fully joined four-person
   Afternoon study party. Open Anna’s invitation and join through the consent sheet as yourself.
   Open Afternoon study to book for four members immediately. Existing saved demos are upgraded
   once to add these samples while preserving custom parties and booked/cancelled reservations;
   a preserved closed Afternoon study uses a separate ready-party sample.
5. Choose seats. Tap distinct free seats on the existing floor plan. The picker advances to the
   next unassigned member. All selected seats have the existing double-ring highlight, and every
   assignment is listed with a Change control. Occupied, claimable, reserved, and duplicate seats
   produce an in-place error rather than an assignment.
6. Confirm booking. Inspect your seat and countdown, then tap the draft scan frame to check in.
   Switch perspectives on the reservation screen to inspect each member's own seat/check-in.
7. From the organizer's party detail, cancel the party. It disappears from the list; unchecked-in
   seats are released while checked-in members keep their sessions. An individual can also
   cancel/end only their own seat. Open Stalk my friends to see only friends' shared study rooms.
8. **Reset preview** restores the sample data, clears screen-local form state, and returns to Friends.
   Friends, requests, privacy, and parties persist in an isolated localStorage entry. Reloading
   starts with your own perspective. PR previews have separate storage keys, and friend links
   include the preview base path. If browser storage is blocked, data lasts for the current
   social visit only. No real backend state is changed.

The seat picker's Preview tools link to `?error=1` to simulate availability changing at confirmation.
No sample reservation is created in that state. Switch back to Normal booking to try the success
path. Old `/social-draft/party` bookmarks redirect to the most recently created party. Unknown
party IDs show an unavailable notice rather than opening a different party.

Run `npm run test:social-draft` in `frontend/` for party storage, targeting, consent, and cancellation
regressions. The hub sections, bottom navigation, inline confirmations, create/invite/list flow,
Home roundtrip, reloads, invalid links, cancelled-party visibility, preserved session access,
recipient consent sheet, and legacy seat bookmark were also exercised in an in-memory DOM in dark and light modes. This checks interactions
and markup; live visual review remains unavailable while computer use is not working.

## Remaining work

- Review the draft in both themes against the references above. Live browser visual review was
  unavailable in this session because computer use was not working.
- Refine room browsing and the member waiting state.
- Replace preview view models and reducer actions with the generated social API helpers, preserving
  explicit friendship acceptance and party-booking consent.
- Use backend capability gating for real routes. The preview's `VITE_SOCIAL_DEMO_ENABLED` gate is separate
  from `SOCIAL_ENABLED`; it must not become a production bypass.
- Replace sample seat numbers and layout with backend IDs and the team's room-layout contract.
- Use real reservation state and QR check-in; keep each member's booking and session individually owned.
- Add loading and network error states, refresh data after mutations, and implement server-derived
  expiry for the whole roster. The current prototype only counts down the viewed reservation/session.
- Remove the preview toolbar and draft scan affordance before shipping.

Shared changes are `AppLayout` and `BottomNavigation` for the development navigation trial,
in-page routine `StatusBanner` confirmations, shared icons/theme styles, and the optional
`SeatMap.highlightedSeats` prop. Individual seat screens omit highlights. The social draft code
lives under `frontend/src/features/social-draft/`; `App.tsx` registers its lazy routes when the demo
flag is enabled. Local development defaults on; CI enables the flag for PR builds and leaves it
off in normal production. Docker exposes `SOCIAL_DEMO_ENABLED` as a build argument.
The deployed bundle check verifies navigation is included only in preview images. DOM checks also
cover production mode with the flag enabled, prefixed links/storage, and four-seat manual booking.

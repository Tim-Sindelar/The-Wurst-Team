# Social frontend draft

This is a working design preview, available locally at `http://127.0.0.1:5173/social-draft`
and in CI-deployed PR previews under `/pr/<number>/social-draft`. Friends, people search,
requests, privacy and shared rooms use the real social backend when its capabilities say enabled.
Disabled social shows an explicit sample-data notice; network/auth failures show errors. PR
deployments enable the real directory in their isolated database. Party screens retain sample
data and do not modify live bookings.

`design-rules.md` continues to govern typography, spacing, themes, touch targets, and popups.
There are no new design tokens, component variants, stylesheets, or dependencies.

## Layout references

| Draft view | Existing visual reference | Main action |
| --- | --- | --- |
| Friends | `screens/06-profile.html`: avatars, cards, notification/privacy toggles | Add a friend |
| Friend requests | `screens/06-profile.html`: request cards | Accept / decline / cancel |
| Add a friend | `components.html`: name search, avatar cards, selection, notices | Send friend request |
| Study parties | `screens/01-home.html`: linked summary cards | Create a party |
| Create party | `screens/06-profile.html`: labelled form | Create party |
| Invite friends | `screens/06-profile.html`: friend cards with explicit Invite buttons | Done |
| Party detail | `screens/05-session.html`: summary, member cards, in-page notice | Join party / Choose seats / View my seat |
| Seat assignment | `screens/02-seat-arrangement.html`: same interactive room map and seat markers | Reserve seats together |
| Own reservation / session | `screens/03-reservation.html` and `screens/05-session.html`: seat stripe, chip, countdown | Check in / View party |
| Own QR scan | `screens/04-qr-scan.html`: labelled mock scan target | Scan the assigned seat |

Screens use the existing 390px `Screen` frame, `ScreenHeader`, `ScreenMain`, and pinned `ActionBar`.
At the user’s request, Friends places its single Add a friend primary action after the friend list
inside scrolling `ScreenMain`, rather than in a pinned action bar.
Cards, buttons, switches, text, inputs, and notices use the Mantine theme. Native selects inherit
the shared Input theme; their arrows come from `Icon`. Long names wrap in content. Seat-state
colours appear only on seats and seat summaries. Non-seat membership states use text and icons.
Destructive decisions use the existing danger decision sheet, and confirmations use the existing
notification banner. Both colour schemes are supported through existing theme tokens.

The demo trials persistent **Home / Map / Friends** bottom navigation, outside the
scrolling viewport. Page actions sit above it, and the campus map fills the remaining viewport.
Friends has privacy first, a study-party entry, then one combined friend list showing shared
rooms. Friends with a permitted active location come first; names order each group. No shared
room is deliberately ambiguous about privacy versus no active session. Search filters this list;
removal uses its inline button and a decision sheet. A Requests link opens pending requests.
Add a friend sits at the bottom of the scrolling list. The old location route redirects to Friends.
There is no separate Stalk my friends screen or duplicated friend list.
Create asks only for a name, then opens invitations. Each friend has an **Invite** button that
changes to **Invited**; there are no invitation switches. **Done** opens the party roster.
Only one joined active party per person is permitted. Open membership consumes the slot; a booked
party consumes it while that person’s reservation/session is live. Invitations never consume a slot.
Leave/cancel or finish/expire your reservation before creating/joining another. The reducer enforces
the rule too; direct create URLs show a disabled action and a link to the current party.
The parties list separates invitations from the current joined party. Cancelled parties are hidden, including
in the hub count. A checked-in seat surviving cancellation stays accessible as Your ongoing session.
Cancellation retains the saved party and independent reservations; hiding it does not delete data.
Party invitations use direct friend selection, without shared party links. The recipient opens an
invitation under Study parties and taps Join to open the existing consent sheet. In this mock,
  open Anna’s study group to test the recipient experience as yourself.

Routine confirmation banners appear in the page and never cover navigation. Privacy switches
update immediately without a notification. Urgent notices remain floating below the header.

Party preview tools are collapsed below the party screens. They contain reset, booking-conflict controls,
and (on party detail/reservation) a perspective selector. These controls are not product UI.

## Preview walkthrough

1. Open Friends through the bottom navigation or `/social-draft`. Room sharing is off by default
   and its setting is at the top. Friends and shared room names are in one list, with locations
   first. Filter or remove friends here; open Requests to accept Nora or cancel Felix.
2. Open Add a friend and search by display name (at least two characters). Select a result
   with Add friend, then Send friend request in the action bar. Results distinguish friends,
   outgoing requests and incoming requests. Incoming requests link to Friend requests.
   When the backend is disabled, search Sam to exercise the sample flow. There are no friend links.
3. Open Study parties. With a current party, View your party replaces Create a party. Cancel
   the sample Afternoon study first, then create a party, name it, invite friends and press Done.
   Each saved party retains its own `/social-draft/party/:partyId` URL; archived parties are preserved.
4. The local demo starts with one invitation to Anna’s study group and one fully joined four-person
   Afternoon study party (you, Luca, Mia and Theo). Anna’s invitation stays pending while Afternoon
   study is active. Cancel Afternoon study first to join Anna through the consent sheet.
   Open Afternoon study to book for four members immediately. Existing saved demos are upgraded
   once while preserving custom parties and booked/cancelled reservations. The old open sample
   roster is refreshed to avoid overlapping joined members. Upgrades never seed another active
   party alongside an existing custom party.
5. Choose seats. Tap distinct free seats on the existing floor plan. The picker advances to the
   next unassigned member. All selected seats have the existing double-ring highlight, and every
   assignment is listed with a Change control. Occupied, claimable, reserved, and duplicate seats
   produce an in-place error rather than an assignment.
6. Confirm booking. Inspect your seat and countdown, then tap the draft scan frame to check in.
   Switch perspectives on the reservation screen to inspect each member's own seat/check-in.
7. From the organizer's party detail, cancel the party. It disappears from the list; unchecked-in
   seats are released while checked-in members keep their sessions. An individual can also
   cancel/end only their own seat. Return to Friends to see shared study rooms in the friend list.
8. **Reset preview** restores the sample data, clears screen-local form state, and returns to Friends.
   Sample parties and disabled-backend demo friendships persist in isolated localStorage entries.
   Live friendships, requests and privacy persist in PostgreSQL, refresh after changes and on focus,
   and poll every 20 seconds for incoming requests and room changes. Reset affects only sample data.
   Reloading starts the party preview with your own perspective. PR previews have separate storage keys.

The seat picker's Preview tools link to `?error=1` to simulate availability changing at confirmation.
No sample reservation is created in that state. Switch back to Normal booking to try the success
path. Old `/social-draft/party` bookmarks redirect to the most recently created party. Unknown
party IDs show an unavailable notice rather than opening a different party.

Run `npm run test:social-draft` in `frontend/` for party storage, targeting, consent, and cancellation
regressions. The hub sections, bottom navigation, inline confirmations, create/invite/list flow,
Home roundtrip, reloads, directory search, cancelled-party visibility, preserved session access,
recipient consent sheet, and legacy seat bookmark were also exercised in an in-memory DOM in dark and light modes. This checks interactions
and markup; live visual review remains unavailable while computer use is not working.

## Remaining work

- Review the draft in both themes against the references above. Live browser visual review was
  unavailable in this session because computer use was not working.
- Refine room browsing and the member waiting state.
- Connect the party view models and reducer actions to generated social API helpers, preserving
  party-booking consent. Friendship screens already use the generated API.
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
off in normal production. PR deploys separately enable the social backend; local live friendships
require `SOCIAL_ENABLED=true`. Docker exposes `SOCIAL_DEMO_ENABLED` as a build argument.
The deployed bundle check verifies navigation is included only in preview images. DOM checks also
cover production mode with the flag enabled, prefixed links/storage, and four-seat manual booking.

Directory interactions were checked in an in-memory DOM in dark and light: ID-based requests,
refreshed pending states and persisted privacy. Explicit demo and failed-backend cases were also
checked. This verifies markup and interactions; live visual review is still unavailable.

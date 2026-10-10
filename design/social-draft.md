# Social frontend draft

This is a working design preview, available only in Vite development mode at
`http://127.0.0.1:5173/social-draft`. It uses isolated sample data and does not call the social
backend or modify the existing mock booking state. Navigation and sample mutations work so the
team can refine the experience before API integration.

`design-rules.md` continues to govern typography, spacing, themes, touch targets, and popups.
There are no new design tokens, component variants, stylesheets, or dependencies.

## Layout references

| Draft view | Existing visual reference | Main action |
| --- | --- | --- |
| Friends | `screens/06-profile.html`: avatars, cards, notification/privacy toggles | Add a friend |
| Add a friend | `components.html`: text inputs, notices, secondary buttons | Send friend request |
| Study parties | `screens/01-home.html`: linked summary cards | Create a party |
| Create party / invite friends | `screens/06-profile.html`: labelled form and switches | Create party / Send invitations |
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

The preview toolbar is outside the product screen. It contains sample-data controls, navigation,
and (on party detail/reservation) a perspective selector. These controls are not product UI.

## Preview walkthrough

1. Open `/social-draft`. Accept Nora's request, cancel Felix's request, filter the friend list,
   remove a friend through a decision sheet, or toggle your room-sharing preference.
2. Open Add a friend. Use **Sam’s sample invite** in the preview toolbar, then send a request.
   Copying your own invite link works; opening that link does not automatically send a request.
3. Open Parties, then Afternoon study. The sample has three ready members and Anna still invited.
4. Select Anna in **Preview party as**, join through the consent sheet, then switch back to the
   organizer. There are now four ready members.
5. Choose seats. Tap distinct free seats on the existing floor plan. The picker advances to the
   next unassigned member. All selected seats have the existing double-ring highlight, and every
   assignment is listed with a Change control. Occupied, claimable, reserved, and duplicate seats
   produce an in-place error rather than an assignment.
6. Confirm booking. Inspect your seat and countdown, then tap the draft scan frame to check in.
   Switch perspectives on the reservation screen to inspect each member's own seat/check-in.
7. From the organizer's party detail, cancel the party. Unchecked-in seats are released while
   checked-in members keep their sessions. An individual can also cancel/end only their own seat.
8. **Reset preview** restores the sample data and clears screen-local form state. Reloading or
   leaving the preview also resets data; nothing is persisted.

The seat picker toolbar links to `?error=1` to simulate availability changing at confirmation.
No sample reservation is created in that state. Switch back to Normal booking to try the success
path. Creating a party replaces the single sample party; this draft is not a multi-party store.

## Remaining work

- Review the draft in both themes against the references above. Live browser visual review was
  unavailable in this session because computer use was not working.
- Refine copy, navigation entry, room browsing, and the member waiting state.
- Replace preview view models and reducer actions with the generated social API helpers, preserving
  explicit friendship acceptance and party-booking consent.
- Use backend capability gating for real routes. The preview's development-only gate is separate
  from `SOCIAL_ENABLED`; it must not become a production bypass.
- Replace sample seat numbers and layout with backend IDs and the team's room-layout contract.
- Use real reservation state and QR check-in; keep each member's booking and session individually owned.
- Add loading and network error states, refresh data after mutations, and implement server-derived
  expiry for the whole roster. The current prototype only counts down the viewed reservation/session.
- Remove the preview toolbar and draft scan affordance before shipping.

The sole shared component extension is the optional `SeatMap.highlightedSeats` prop. Individual
seat screens omit it, retaining their existing selection behavior. All other social draft code
lives under `frontend/src/features/social-draft/`; `App.tsx` registers its lazy routes in development.

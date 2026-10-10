# Friends and party booking backend

Social features are optional and disabled by default. This implementation does not change the
existing frontend screens or mocked booking state. The generated frontend API client includes
the new endpoints; UI integration is the next milestone. A separate development-only
[frontend draft](../design/social-draft.md) now previews the flow with isolated sample data.

## Enable locally

Add `SOCIAL_ENABLED=true` to `backend/.env`, then recreate the backend:

```sh
docker compose up -d backend
```

Startup applies the additive migration. Set the value back to `false` and recreate the backend
to disable social features. Existing reservations remain usable through the standard reservation,
check-in, and session endpoints. Do not downgrade the database just to disable the feature.

The frontend should use `getSocialCapabilitiesOptions()` as the source of truth: hide navigation
when `enabled` is false and gate direct social routes too. Every social API except capabilities
is gated in the backend. API schemas and operation IDs remain stable while disabled.

Use the existing managed-proxy authentication in deployment. Keep direct access blocked, keep
managed authentication enabled, and use `AUTH_MODE=proxy`. Social never creates credentials,
changes the UUID namespace, stores email addresses, or uses browser-supplied identity in proxy mode.
Local demo mode supports `X-Demo-User-Id` to exercise multiple users through the API.

## Product contract

- Invite links identify a user; opening a link does not send a request or create friendship.
  The frontend should put the opaque token in `/friends/add?invite=<token>` and require an explicit
  Send request action. The backend returns a token, not a URL, so the frontend can use its own origin.
- Sending a request and accepting it are separate actions. Crossing requests remain pending.
  Either participant may cancel/decline a pending request or remove an accepted friendship.
- Social users are enrolled only by mutations, so simply visiting a page does not create rows.
  Profile edits remain authoritative for display names; proxy names supply the fallback.
  Other users never receive email addresses or seat QR tokens.
- Room sharing defaults to off. Only accepted friends see a shared room, and only for an
  `active` or `on_break` reservation. Pending, upcoming, expired, hidden, and absent sessions
  expose no room. Sharing returns a room, never GPS or an exact seat. Responses use `no-store`;
  the frontend must refresh friend data when focused and after relevant mutations.
- Parties have an organizer and at most 12 invited/accepted members, including the organizer.
  Only the organizer invites accepted friends. A member must explicitly accept before their
  seat can be booked. Joining must clearly say: **The organizer can reserve a seat for you and
  cancel it before you check in. You must check in yourself.** Friendship does not grant this consent.
- An open party may be declined or left before booking. Removing a friendship stops room sharing
  and future invitations; it does not withdraw previously accepted party consent. Use Leave party
  to withdraw consent. The organizer cancels the party rather than leaving it.
- The organizer manually supplies exactly one distinct seat for every currently accepted member.
  Invited members are excluded and cannot join after booking. The UI should show that accepted
  roster explicitly before confirmation. All selected seats must be free now and in the same room.
  There is no adjacency algorithm, upcoming booking, or partial success.
- Booking creates one ordinary reservation per member in one transaction. A member with a live
  reservation, an unavailable seat, or a changed roster causes the entire request to fail.
  Each member uses the existing `/me/reservation`, QR check-in, and session actions as themselves.
- Each party has one booking round. Repeating the same assignment returns the original booking;
  it never recreates expired or cancelled reservations. Different assignments are rejected.
  Create another party for another round.
- Each member checks in at their assigned seat. No-shows expire individually. Members cancel their
  own reservations through the standard end endpoint. Checked-in sessions are controlled individually.
- Organizer cancellation closes the party and cancels only its remaining unchecked-in reservations.
  It preserves checked-in sessions and any later individual bookings. Repeating cancellation is safe.

## API contract

All paths below are under `/api/v1/social`. Responses are typed in OpenAPI; use the generated
TanStack Query helpers rather than handwritten fetch calls or API types.

| Method | Path | Generated operation | Purpose |
| --- | --- | --- | --- |
| GET | `/capabilities` | `get_social_capabilities` | Feature availability, no login required |
| GET | `/me` | `get_social_me` | Own social identity, optional link token, and sharing preference |
| POST | `/me/invite-link` | `create_friend_link` | Create/retrieve own stable invite token |
| PATCH | `/me/privacy` | `update_social_privacy` | `{share_room: boolean}` |
| GET | `/friends` | `list_friends` | Accepted friends and permitted current rooms |
| GET | `/friend-requests` | `list_friend_requests` | Incoming and outgoing pending requests |
| POST | `/friend-requests` | `send_friend_request` | `{invite_token}` |
| POST | `/friend-requests/{id}/accept` | `accept_friend_request` | Recipient acceptance |
| DELETE | `/friendships/{id}` | `delete_friendship` | Cancel, decline, or remove; participant only |
| GET | `/parties` | `list_parties` | Own accepted parties and open invitations |
| POST | `/parties` | `create_party` | `{name}`; organizer is automatically accepted |
| GET | `/parties/{id}` | `get_party` | Roster, consent states, and assigned bookings |
| POST | `/parties/{id}/invitations` | `invite_party_member` | `{user_id}`; organizer only |
| POST | `/parties/{id}/reply` | `reply_to_party_invitation` | `{accept: boolean}`; invitee only |
| POST | `/parties/{id}/leave` | `leave_party` | Withdraw from an open party |
| POST | `/parties/{id}/book` | `book_party` | `{assignments: [{user_id, seat_id}, ...]}`; organizer only |
| POST | `/parties/{id}/cancel` | `cancel_party` | Organizer cancellation and list of cancelled reservation IDs |

Expected conflicts use HTTP 409 with `{code, detail}`. Show these errors in place. After a conflict,
refresh the roster, room availability, and own reservation before retrying. Invalid assignments
return 422; unavailable/private resources return 404; unauthorized organizer/recipient actions
return 403. Missing authentication returns 401 when the feature is enabled.

## Integration boundaries

Social owns its router, schemas, service, and four additive tables. `PartyMember.reservation_id`
links to ordinary reservation rows; there is no new reservation ownership or lifecycle.

The reservation service adds two transaction-level methods:

- `reserve_party(assignments)` validates and creates bookings without committing.
- `cancel_unchecked(reservation_ids)` cancels only the supplied pending bookings without committing.

Its shared preparation helper acquires all user advisory locks in numeric key order, then room
and seat locks in UUID order, normalizes stale bookings, and evaluates one clock instant.
Individual bookings use the same helper. Social locks the party first to serialize consent,
invitations, booking, and cancellation; reservation operations never acquire party locks.

Do not implement group booking by making several HTTP calls to the individual reservation endpoint.
The social route commits once after both reservation rows and party references are ready.

Shared merge points: `config.py`, `main.py`, model registration, test cleanup, the reservation
locking helper, Alembic's revision chain, and generated API files. Rebase the social migration
onto the team's current migration head before merging if another migration lands first. Regenerate
the client from the merged backend using `make generate`.

## Verification

```sh
docker compose exec -T backend pytest
cd backend
uv run --locked ruff check .
uv run --locked ruff format --check .
```

Social tests use the existing isolated PostgreSQL schema harness and real migrations. They cover
friend permissions, duplicate/crossing requests, privacy and derived expiry, party consent,
four-person booking, rollback, idempotency, individual check-in/no-shows, cancellation, disabling,
migration roundtrip, and competing party/individual booking and consent/check-in transactions.

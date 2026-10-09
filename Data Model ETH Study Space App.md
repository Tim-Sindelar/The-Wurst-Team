# Data Model: ETH Study Space App

Oct 9, 2026 · @Filip Trplan

## Implemented scope

The reservation feature lives in `backend/app/features/reservations/`: database models, API schemas, routes, reservation logic, and demo seeding. Shared configuration, database sessions, and authentication remain in `backend/app/`. Feature models are registered through `backend/app/models/__init__.py` for Alembic.

This version supports immediate and next-session reservations, QR check-in, extension, cumulative breaks, cancellation, early handover, and managed-proxy authentication. Notifications, admin editing, geolocation, opening hours, and the room-layout contract are deferred.

## Principles

- Keep four domain tables and derive state from rows and the clock. No status, end-reason, or ended-at columns are stored.
- Calculate deadlines from settings when an action occurs and persist them. Existing deadlines and captured break budgets survive configuration changes.
- A user may hold one live reservation, including an upcoming reservation.
- Reserve is one action: a free seat starts immediately; a claimable seat starts after the occupant. There is no separate queue endpoint or waiting list.
- Use Alembic for every schema change, request-scoped SQLAlchemy sessions, and explicit write commits.

## Tables

All identifiers are UUIDs. All timestamps are PostgreSQL `timestamptz`. Columns are required unless marked nullable.

```text
study_spaces
  id                          uuid PK
  name                        text
  lat                         double precision
  lng                         double precision
  layout                      jsonb, default {}

seats
  id                          uuid PK
  space_id                    uuid FK → study_spaces.id
  label                       text
  qr_token                    text UNIQUE

reservations
  id                          uuid PK
  user_id                     uuid
  seat_id                     uuid FK → seats.id
  previous_reservation_id     uuid FK → reservations.id, nullable
  created_at                  timestamptz
  starts_at                   timestamptz
  check_in_deadline           timestamptz
  checked_in_at               timestamptz, nullable
  ends_at                     timestamptz
  break_budget_seconds        integer

breaks
  id                          uuid PK
  reservation_id              uuid FK → reservations.id
  started_at                  timestamptz
  ends_at                     timestamptz
  returned_at                 timestamptz, nullable
```

`user_id` is a stable UUIDv5 derived from the trusted proxy's `X-User-Id` email; there is no users table. Explicit demo mode supplies dummy UUIDs for local development. QR tokens are opaque and separate from seat identity. Layouts remain empty objects until the frontend contract is defined.

`previous_reservation_id` identifies the checked-in occupant on the same seat preceding an upcoming reservation. It lets the state calculation recognize early handover. Once activation timestamps are persisted, the link is cleared. A reservation must be activated before it can be checked in and have a successor of its own, so unresolved handovers do not form chains.

`break_budget_seconds` captures the configured allowance at reservation creation. Break deadlines remain stored in `ends_at`; returning sets `returned_at`, distinguishing a timely return from expiry. Elapsed break time consumes the shared allowance, capped by the reservation end.

## Configuration

Defaults live in the existing Pydantic `Settings` class in `backend/app/config.py`. Environment variables override them; Compose reads `backend/.env` when present. Recreate the backend after changing its environment.

| Setting | Default | Purpose |
| --- | --- | --- |
| `session_length_minutes` | 120 | New-session duration and extension amount |
| `check_in_window_minutes` | 15 | Check-in allowance after session start |
| `private_priority_window_minutes` | 20 | Earliest the occupant can extend before the end |
| `public_reservation_window_minutes` | 10 | Earliest another user can reserve the next session |
| `break_budget_minutes` | 30 | Total break allowance captured per reservation |

Environment names are the uppercase forms of these settings. All values must be positive. Require public window < private window < session length, and check-in window < session length.

Changing settings affects new reservation deadlines, new extension amounts, and current eligibility windows. It does not rewrite stored deadlines or replenish existing break allowances. Early handover shifts a booking's stored start, check-in deadline, and end together, preserving its originally assigned duration and allowance.

## Derived reservation state

`reservation_states` is a read-only view backed by the SQL function `reservation_states_at(at_time)`. The function takes a clock value, not configuration. Transactions use one instant after obtaining locks; tests can exercise exact boundaries.

The calculation first accounts for expired unreturned breaks, then derives early activation through the predecessor link. It exposes the original row plus `effective_starts_at`, `effective_check_in_deadline`, `effective_ends_at`, and `status`.

| Status | Meaning |
| --- | --- |
| `upcoming` | The effective start has not arrived |
| `pending` | The session started but has not checked in |
| `active` | Checked in, with no current break |
| `on_break` | Checked in and within an unreturned break deadline |
| `no_show` | Check-in deadline missed |
| `ended` | Cancelled, checked out, or session/break expired |

An empty reservation interval is always ended. A no-show releases the seat at its check-in deadline; a later write persists the shortened interval, after which the stored row reads as ended. Reads alone never update rows.

## Seat availability

| State | Meaning |
| --- | --- |
| `free` | No live current or upcoming booking prevents immediate use |
| `reserved` | Current booking awaits check-in, or a future booking prevents use |
| `occupied` | Active occupant and the next session is unavailable |
| `on_break` | Occupant is within their break deadline |
| `claimable` | Active occupant is in the public window with no next booking |

Seat responses include `reservable_at`: now for a free seat, the occupant's end for an available next session, or null. A seat on break retains its display state while permitting a next booking during the public window. Free-seat counts count only `free` seats.

## Actions

| Action | Behavior |
| --- | --- |
| Reserve a seat | Reserve now when free, or at the occupant's end during the public window; reject an existing live booking for the caller |
| Reserve any | Choose a free seat in the requested space; never choose an upcoming session |
| QR check-in | Activate the caller's pending booking, or create a checked-in walk-up booking on a free seat |
| Extend | During the final private-priority window, add the configured session duration if no next booking exists; allowed while on break |
| Start break | Allow one break at a time; deadline is min(session end, now + remaining allowance) |
| Return | Set returned_at strictly before the break deadline |
| End | Cancel or check out; release the seat and activate a next booking immediately |
| Miss check-in | Derive no-show without a worker; persist the shortened interval on a later mutation |
| Break expiry | End the reservation at the break deadline and derive immediate next-booking activation |

For a session ending at 14:00 with default settings, only the occupant can extend between 13:40 and 13:50. From 13:50, extension and another user's next-session reservation compete. Once the next session is booked, the occupant cannot extend into it.

QR scans cannot check in an upcoming booking before its start or move an existing live booking to another seat. Repeated scans for the same checked-in booking are harmless. A scan after expiry may create a new walk-up booking if the seat is free; it never revives the old booking.

Multiple breaks share one budget. Breaks do not pause the session, and extension does not replenish the budget. At a break deadline, return is too late. Early handover starts the next user's session and check-in clock at release time, even if no API call occurs then. Notifications are deferred.

## Constraints and transaction safety

- `btree_gist` supports exclusion constraints. Seat intervals use `[starts_at, ends_at)`.
- User commitments use `[created_at, ends_at)` to prevent holding multiple bookings even when their future session intervals do not overlap.
- Cancelling an upcoming booking sets `ends_at = starts_at`. Both exclusion constraints treat that as an empty interval, preserving the row while releasing the seat and user.
- Enforce timestamp ordering, positive break budgets, valid coordinates, unique seat labels within a space, unique QR tokens, and non-overlapping break intervals ending at return or deadline.
- Index foreign keys and user/seat lookups.
- Serialize caller mutations with transaction-scoped advisory locks; lock affected seats in UUID order and re-evaluate the clock afterward.
- Before mutation, persist due expirations and handovers for affected seats and stale caller bookings. Shrink the predecessor before moving its successor to avoid transient overlap.
- Map expected booking conflicts to HTTP 409. Keep historical rows; expose no deletion endpoints.

## API

All endpoints use `/api/v1` and typed Pydantic request/response schemas.

| Method and path | Purpose |
| --- | --- |
| `GET /spaces` | Map summaries and free-seat counts |
| `GET /spaces/{space_id}` | Layout and seat availability |
| `GET /me/reservation` | Current/upcoming booking, or null |
| `POST /reservations` | Reserve a specific seat or any free seat in a space |
| `POST /check-ins` | QR check-in or walk-up |
| `POST /reservations/{reservation_id}/extend` | Extend |
| `POST /reservations/{reservation_id}/break` | Start a break |
| `POST /reservations/{reservation_id}/return` | Return from a break |
| `POST /reservations/{reservation_id}/end` | Cancel or check out |

Creation accepts `{kind: "seat", seat_id}` or `{kind: "any", space_id}`. Check-in accepts `{qr_token}`. Other actions require no body. Responses include server time, effective deadlines, remaining break seconds, and available actions. Public responses omit user identities and QR tokens.

Authentication defaults to proxy mode and requires the authenticated managed ingress with no direct public access. Local demo mode uses a configured default UUID, optionally overridden through `X-Demo-User-Id`. `make seed` creates demo spaces and seats and prints QR tokens without overwriting existing data.

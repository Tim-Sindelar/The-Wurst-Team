# Data Model: ETH Study Space App

Oct 9, 2026 · @Filip Trplan

## Core principles

The model is four tables, and seat state is computed from reservations and the clock rather than stored. Two rules shape everything else:

1. **Derive state, don't store it.** Free, reserved, occupied, on break and claimable are all functions of a seat's reservations and `now()`. Time-driven transitions (no-show, priority window, session end) then need no background job to stay correct. Jobs exist only to send notifications.
2. **Store deadlines on the row.** Whenever a rule produces a deadline (check-in deadline, session end, break end), it is written onto the row when the row is created. Changing the rules later, including moving to per-room rules, then never needs a migration or a query rewrite.

Every way something ends just moves its `ends_at` earlier. There is no separate `ended_at` or `end_reason`.

## Tables

```sql
study_spaces (
  id, name,
  lat, lng,           -- map pin and geofence centre
  layout jsonb        -- drawing of the room; references seats by id
)

seats (
  id, space_id,
  label,              -- "A-12"
  qr_token unique     -- what the sticker encodes; rotatable
)

reservations (
  id, user_id, seat_id, created_at,
  starts_at,          -- now(), or the current occupant's ends_at when queued
  check_in_deadline,  -- starts_at + check-in window, written at creation
  checked_in_at,      -- null until the QR scan / check-in
  ends_at             -- expected end; moved earlier on checkout, cancel, no-show
)

breaks (
  id, reservation_id,
  started_at,
  ends_at             -- started_at + max break; moved earlier on return
)
```

- `user_id` points at whatever the auth layer provides (Supabase `auth.users` or a plain `users` table).
- Seats stay as rows so reservations have something to reference. The layout JSON only draws the room and places each seat by `seat_id`, so seat identity and the QR token live in one place.
- An extension updates `ends_at` in place.

## Global config

Rules live in one backend config, not in the database. Values marked placeholder aren't decided yet.

| Setting | Value | Used for |
| --- | --- | --- |
| Session length (T) | 120 min | `reservations.ends_at` at creation and on extend |
| Check-in window (X) | 15 min (placeholder) | `reservations.check_in_deadline` |
| Check-in reminder | X minus 3 min | notification before a no-show |
| Private priority window | 20 min before end | only the occupant can extend |
| Public window | 10 min before end | anyone can queue for the next slot |
| Max break | 30 min (placeholder) | `breaks.ends_at` |
| Geofence radius | placeholder | location check on check-in |

## Derived state

Decided: no stored status column. A view gives every reservation a readable `status`, so app code reads `status = 'active'` like a real column but the value is always current. Because deadlines are stored on the rows, the view needs no config.

```sql
create view reservation_states as
select r.*,
  case
    when now() >= r.ends_at                       then 'ended'
    when r.checked_in_at is null
     and now() >= r.check_in_deadline             then 'no_show'
    when r.checked_in_at is null
     and now() < r.starts_at                      then 'queued'
    when r.checked_in_at is null                  then 'pending'
    when exists (select 1 from breaks b
                 where b.reservation_id = r.id
                   and now() < b.ends_at)         then 'on_break'
    else 'active'
  end as status
from reservations r;
```

Seat state on the map comes from the seat's current reservation (the one where `starts_at <= now() < ends_at`):

| Seat state | Condition |
| --- | --- |
| Free | no current reservation, or it is `no_show` |
| Reserved | current reservation is `pending` |
| On break | current reservation is `on_break` |
| Occupied | current reservation is `active`, outside the public window, or someone has already queued |
| Claimable (orange) | `active`, inside the public window, and no `queued` reservation behind it |

The private priority window (orange only for the occupant) is per viewer, so it is computed in the backend for "my reservation", not in the shared view. The same goes for the claimable check, since it uses the public window from config. The map's "N free seats" is a count over these states grouped by `space_id`.

## Flow actions

Each action in the user flow is one short transaction.

| Action | What the backend does |
| --- | --- |
| Reserve a seat (or "reserve any") | First close out no-shows on that seat: `set ends_at = check_in_deadline where checked_in_at is null and check_in_deadline < now()`. Then insert with `starts_at = now()`, `check_in_deadline = now() + X`, `ends_at = now() + T`. |
| Walk-up QR scan on a free seat | Same as reserve, with `checked_in_at = now()` set in the same insert. |
| Check in (QR scan or button) | Look up the seat by `qr_token`, verify location, set `checked_in_at = now()` on the user's pending reservation. |
| Extend | `ends_at = ends_at + T`. The overlap constraint rejects it if someone has already queued. |
| Queue behind the occupant | Insert with `starts_at = current.ends_at`, check\_in\_deadline = current.ends\_at + X, `ends_at = current.ends_at + T`. |
| Start a break | Insert a break with `ends_at = now() + max break`. |
| Return from a break | `breaks.ends_at = now()`. |
| Check out or cancel | `ends_at = now()`. If a queued reservation is behind it, move that one's `starts_at` (and its check-in deadline) to `now()` so its owner can check in right away. |
| No-show | Nothing runs. The view shows `no_show` once the deadline passes, and the next reserve on that seat closes the row out. |

Notifications (check-in reminder, priority window, public window, session end, seat lost) come from a job that runs every minute and finds reservations crossing those thresholds. It only needs a small sent-log so nobody gets the same push twice.

## Constraints

The database itself prevents double booking and malformed rows, so two people tapping the same seat in the same second can't both win.

```sql
create extension if not exists btree_gist;

-- one reservation per seat at any moment
alter table reservations add constraint no_seat_overlap
  exclude using gist (seat_id with =, tstzrange(starts_at, ends_at) with &&);

-- one seat per user at any moment
alter table reservations add constraint no_user_overlap
  exclude using gist (user_id with =, tstzrange(starts_at, ends_at) with &&);

-- timestamps make sense
alter table reservations add constraint sane_times check (
  ends_at > starts_at
  and check_in_deadline >= starts_at
  and (checked_in_at is null or checked_in_at between starts_at and ends_at)
);
```

The overlap constraints have no `where` clause. They work because every ending (checkout, cancel, no-show close-out) shrinks `ends_at`, which frees the time range.

## Left out, and open questions

Left out on purpose for the MVP: per-room rules, opening hours, seat features, check-in method, end reasons (handover is just a timeout), extension counts, a link from a queued reservation to the previous one (it's found by `starts_at = ends_at` on the same seat), a reports table for disputes, and a full notification queue.

- [ ] Can people reserve for a later time (e.g. 14:00 at 11:00), or only "now" plus queueing behind the occupant?
- [ ] Breaks: how many per session, and does a break pause `ends_at` or not? Not pausing is much simpler.
- [ ] Is the location check needed when the QR scan already proves presence, or only for the button check-in?
- [ ] Auth: ETH SSO, or plain email login for the demo?
- [ ] Shape of the layout JSON (walls, tables, seat positions keyed by `seat_id`).
- [ ] "Arrived but seat is taken": still unsolved, the app only shows who holds it.

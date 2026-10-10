import { useState } from 'react';
import { Link, useOutletContext } from 'react-router';
import { Button, Text, TextInput, Title } from '@mantine/core';
import * as api from '../../api/generated';
import { AdminDialog } from './AdminDialog';
import { Icon } from '../../components/Icon';
import { AdminStat } from './AdminStat';
import { AdminStateChip } from './AdminStateChip';
import { AdminFeedback } from './AdminFeedback';
import { adminHeaders, useAdminAction } from './useAdminAction';
export function AdminSeatsPage() {
  const space = useOutletContext<api.AdminSpaceOverview>();
  const action = useAdminAction();
  const [search, setSearch] = useState(''),
    [adding, setAdding] = useState(false),
    [label, setLabel] = useState(''),
    [ending, setEnding] = useState<api.AdminReservationDetails | null>(null);
  return (
    <div className="grid gap-6">
      <div className="admin-page-header">
        <Title order={2}>Seats and current users</Title>
        <Button
          disabled={space.is_archived}
          onClick={() => {
            setLabel('');
            setAdding(true);
          }}
        >
          Add seat
        </Button>
      </div>
      <div className="admin-stats" aria-label="Seats now">
        <AdminStat
          label="Active seats"
          value={space.active_seats}
          detail={'of ' + space.total_seats}
        />
        <AdminStat label="Free" value={space.free_seats} />
        <AdminStat label="Occupied" value={space.occupied_seats} />
        <AdminStat label="On break" value={space.on_break_seats} />
      </div>
      <TextInput
        className="admin-search"
        aria-label="Find seat or user"
        placeholder="Find seat or user"
        leftSection={<Icon name="search" />}
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
      />
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              {['Seat', 'State', 'Current user', 'Until', 'Actions'].map(
                (t) => (
                  <th key={t}>{t}</th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {space.seats
              .filter((s) =>
                (
                  s.label +
                  ' ' +
                  (s.current_reservation?.user.display_name || '')
                )
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .map((s) => {
                const r = s.current_reservation || s.upcoming_reservation;
                return (
                  <tr key={s.id}>
                    <td className="font-semibold">{s.label}</td>
                    <td>
                      <AdminStateChip
                        tone={s.state}
                        label={
                          !s.is_active
                            ? 'Switched off'
                            : s.state === 'unavailable'
                              ? 'Closed'
                              : s.state === 'claimable'
                                ? 'Bookable'
                                : s.state === 'on_break'
                                  ? 'On break'
                                  : s.state[0].toUpperCase() + s.state.slice(1)
                        }
                      />
                    </td>
                    <td>
                      {r ? (
                        <Link to={'/admin/users/' + r.user.id}>
                          {r.user.display_name}
                        </Link>
                      ) : (
                        'No current user'
                      )}
                    </td>
                    <td>
                      {r ? new Date(r.ends_at).toLocaleTimeString() : '—'}
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="quiet"
                          disabled={action.busy || space.is_archived}
                          onClick={() =>
                            void action.run(
                              (force) =>
                                api.adminUpdateSeat({
                                  path: { space_id: space.id, seat_id: s.id },
                                  headers: adminHeaders,
                                  query: { force },
                                  body: { is_active: !s.is_active },
                                  throwOnError: true,
                                }),
                              'Seat updated.',
                            )
                          }
                        >
                          {s.is_active ? 'Switch off' : 'Switch on'}
                        </Button>
                        <Button
                          variant="quiet"
                          component={Link}
                          to={'/admin/spaces/' + space.id + '/qr?seat=' + s.id}
                        >
                          QR code
                        </Button>
                        {r && (
                          <Button
                            variant="quiet"
                            className="admin-risky"
                            onClick={() => setEnding(r)}
                          >
                            End reservation
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
      {!space.seats.length && (
        <Text>
          No seats yet. Add furniture and seats in{' '}
          <Link to={'/admin/spaces/' + space.id + '/layout'}>Layout</Link>.
        </Text>
      )}
      <AdminFeedback action={action} />
      <AdminDialog
        opened={adding}
        onClose={() => setAdding(false)}
        title="Add a seat"
        safeLabel="Cancel"
        actionLabel="Create seat"
        onConfirm={() => {
          if (label.trim())
            void action.run(
              () =>
                api.adminCreateSeat({
                  path: { space_id: space.id },
                  headers: adminHeaders,
                  body: { label, is_active: true },
                  throwOnError: true,
                }),
              'Seat created. Place it in the layout before students use its map position.',
              () => setAdding(false),
            );
        }}
      >
        <TextInput
          label="Seat label"
          value={label}
          onChange={(e) => setLabel(e.currentTarget.value)}
          required
        />
      </AdminDialog>
      <AdminDialog
        opened={!!ending}
        onClose={() => setEnding(null)}
        title="End this reservation?"
        safeLabel="Keep reservation"
        actionLabel="End reservation"
        actionTone="danger"
        onConfirm={() => {
          if (ending)
            void action.run(
              () =>
                api.adminEndReservation({
                  path: { reservation_id: ending.id },
                  headers: adminHeaders,
                  throwOnError: true,
                }),
              'Reservation ended.',
              () => setEnding(null),
            );
        }}
      >
        {ending?.user.display_name} · seat {ending?.seat.label}
      </AdminDialog>
    </div>
  );
}

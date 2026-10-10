import { useState } from 'react';
import { Link, useOutletContext } from 'react-router';
import { Button, Text, TextInput, Title } from '@mantine/core';
import * as api from '../../api/generated';
import { DecisionSheet } from '../../components/DecisionSheet';
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
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
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
      <TextInput
        label="Find seat or user"
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
      />
      <div className="overflow-x-auto">
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
                      <span className="capitalize">
                        {s.is_active
                          ? s.state.replace('_', ' ')
                          : 'Switched off'}
                      </span>
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
                          <Button variant="quiet" onClick={() => setEnding(r)}>
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
      <DecisionSheet
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
      </DecisionSheet>
      <DecisionSheet
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
      </DecisionSheet>
    </div>
  );
}

import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Alert, Button, Card, Text, TextInput, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import * as q from '../../api/generated/@tanstack/react-query.gen';
import * as api from '../../api/generated';
import { DecisionSheet } from '../../components/DecisionSheet';
import { AdminFeedback } from './AdminFeedback';
import { adminHeaders, errorMessage, useAdminAction } from './useAdminAction';
const duration = (seconds: number) => (seconds / 3600).toFixed(1) + ' h';
export function AdminUsersPage() {
  const query = useQuery(q.adminListUsersOptions({ headers: adminHeaders }));
  const [search, setSearch] = useState('');
  return (
    <div className="grid gap-4">
      <header>
        <Title order={1}>Users</Title>
        <Text c="dimmed">
          Registered profiles and users with reservation records.
        </Text>
      </header>
      <TextInput
        label="Search users"
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
      />
      {query.isPending ? (
        <Text>Loading users…</Text>
      ) : query.isError ? (
        <Alert variant="danger">
          {errorMessage(query.error)}
          <Button variant="quiet" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </Alert>
      ) : (
        <div className="overflow-x-auto">
          <table className="admin-table">
            <thead>
              <tr>
                {[
                  'User',
                  'Reservations',
                  'Study time',
                  'Live reservations',
                  '',
                ].map((s, i) => (
                  <th key={i}>{s}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {query.data.users
                .filter((u) =>
                  (u.name + ' ' + u.id)
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((u) => (
                  <tr key={u.id}>
                    <td>
                      <strong>{u.name}</strong>
                      <Text size="sm" c="dimmed">
                        {u.id}
                      </Text>
                    </td>
                    <td>{u.reservations}</td>
                    <td>{duration(u.study_seconds)}</td>
                    <td>{u.live_reservations}</td>
                    <td>
                      <Button
                        variant="quiet"
                        component={Link}
                        to={'/admin/users/' + u.id}
                      >
                        Manage
                      </Button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {!query.data.users.length && (
            <Text className="p-4">
              No users yet. Student profiles and reservations appear here when
              created.
            </Text>
          )}
        </div>
      )}
    </div>
  );
}
export function AdminUserPage() {
  const { userId } = useParams();
  const query = useQuery(
    q.adminGetUserOptions({
      path: { user_id: userId! },
      headers: adminHeaders,
    }),
  );
  if (query.isPending) return <Text>Loading user…</Text>;
  if (query.isError)
    return <Alert variant="danger">{errorMessage(query.error)}</Alert>;
  return <UserForm key={query.data.user.name} data={query.data} />;
}
function UserForm({ data }: { data: api.AdminUserHistoryResponse }) {
  const action = useAdminAction();
  const [name, setName] = useState(data.user.name),
    [ending, setEnding] = useState<api.AdminReservationDetails | null>(null);
  return (
    <div className="grid gap-6">
      <Link to="/admin/users" className="text-text-muted">
        ← Users
      </Link>
      <Title order={1}>{data.user.name}</Title>
      <div className="admin-stats">
        {[
          ['Reservations', data.user.reservations],
          ['Study time', duration(data.user.study_seconds)],
          ['Live reservations', data.user.live_reservations],
        ].map(([label, value]) => (
          <Card key={label} className="p-4">
            <Text c="dimmed">{label}</Text>
            <strong className="text-heading">{value}</strong>
          </Card>
        ))}
      </div>
      <form
        className="grid max-w-phone gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(
            () =>
              api.adminUpdateUser({
                path: { user_id: data.user.id },
                headers: adminHeaders,
                body: { name },
                throwOnError: true,
              }),
            'User profile updated.',
          );
        }}
      >
        <TextInput
          label="Display name"
          value={name}
          maxLength={80}
          required
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <Text size="sm" c="dimmed">
          User ID {data.user.id}
        </Text>
        <div className="flex gap-3">
          <Button
            variant="secondary"
            type="button"
            onClick={() => setName(data.user.name)}
          >
            Discard changes
          </Button>
          <Button type="submit" disabled={action.busy}>
            Save changes
          </Button>
        </div>
      </form>
      <Title order={2}>Reservation history</Title>
      <div className="overflow-x-auto">
        <table className="admin-table">
          <thead>
            <tr>
              {['Study place', 'Seat', 'State', 'Start', 'End', ''].map(
                (s, i) => (
                  <th key={i}>{s}</th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {data.reservations.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link to={'/admin/spaces/' + r.space.id + '/seats'}>
                    {r.space.name}
                  </Link>
                </td>
                <td>{r.seat.label}</td>
                <td>{r.status.replace('_', ' ')}</td>
                <td>{new Date(r.starts_at).toLocaleString()}</td>
                <td>{new Date(r.ends_at).toLocaleString()}</td>
                <td>
                  {['active', 'pending', 'upcoming', 'on_break'].includes(
                    r.status,
                  ) && (
                    <Button variant="quiet" onClick={() => setEnding(r)}>
                      End reservation
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AdminFeedback action={action} />
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
        {ending?.space.name} · seat {ending?.seat.label}
      </DecisionSheet>
    </div>
  );
}

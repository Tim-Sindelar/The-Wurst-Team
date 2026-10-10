import { useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  Alert,
  Avatar,
  Button,
  Card,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import * as q from '../../api/generated/@tanstack/react-query.gen';
import * as api from '../../api/generated';
import { Icon } from '../../components/Icon';
import { AdminDialog } from './AdminDialog';
import { AdminStat } from './AdminStat';
import { AdminStateChip } from './AdminStateChip';
import { AdminFeedback } from './AdminFeedback';
import { adminHeaders, errorMessage, useAdminAction } from './useAdminAction';
const duration = (seconds: number) =>
  Math.floor(seconds / 3600) + 'h ' + Math.floor((seconds % 3600) / 60) + 'm';
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase();
const labels = {
  upcoming: 'Upcoming',
  pending: 'Awaiting check-in',
  active: 'Checked in',
  on_break: 'On break',
  no_show: 'Missed check-in',
  ended: 'Ended',
};
const tones = {
  upcoming: 'reserved',
  pending: 'reserved',
  active: 'occupied',
  on_break: 'on_break',
  no_show: 'danger',
  ended: 'unavailable',
} as const;
export function AdminUsersPage() {
  const query = useQuery(q.adminListUsersOptions({ headers: adminHeaders }));
  const [search, setSearch] = useState('');
  const all = query.data?.users || [],
    users = all.filter((u) =>
      (u.name + ' ' + u.id).toLowerCase().includes(search.toLowerCase()),
    );
  return (
    <div className="admin-page">
      <header className="admin-page-header">
        <div>
          <Title order={1}>Users</Title>
          <Text c="dimmed">People, reservations and time spent studying.</Text>
        </div>
        <Button variant="secondary" onClick={() => void query.refetch()}>
          Refresh
        </Button>
      </header>
      <div className="admin-stats" aria-label="User summary">
        <AdminStat label="Users" value={all.length} />
        <AdminStat
          label="Current bookings"
          value={all.reduce((n, u) => n + u.live_reservations, 0)}
        />
        <AdminStat
          label="Reservations"
          value={all.reduce((n, u) => n + u.reservations, 0)}
        />
        <AdminStat
          label="Study time"
          value={duration(all.reduce((n, u) => n + u.study_seconds, 0))}
        />
      </div>
      <div className="admin-toolbar">
        <Title order={2}>
          All users{' '}
          <span className="text-small text-text-muted">
            {all.length} accounts
          </span>
        </Title>
        <TextInput
          className="admin-search"
          aria-label="Search users"
          placeholder="Search name or user ID"
          leftSection={<Icon name="search" />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />
      </div>
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
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Current bookings</th>
                <th className="num">Reservations</th>
                <th className="num">Study time</th>
                <th className="actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="admin-user-identity">
                      <Avatar radius="xl">{initials(u.name)}</Avatar>
                      <div className="grid gap-1">
                        <Link
                          className="admin-table-link"
                          to={'/admin/users/' + u.id}
                        >
                          {u.name}
                        </Link>
                        <Text size="sm" c="dimmed">
                          ID · {u.id.slice(0, 8)}
                        </Text>
                      </div>
                    </div>
                  </td>
                  <td>
                    <AdminStateChip
                      label={
                        u.live_reservations
                          ? u.live_reservations + ' live'
                          : 'No current booking'
                      }
                      tone={u.live_reservations ? 'reserved' : 'unavailable'}
                    />
                  </td>
                  <td className="num">{u.reservations}</td>
                  <td className="num">{duration(u.study_seconds)}</td>
                  <td className="actions">
                    <Button
                      variant="quiet"
                      component={Link}
                      to={'/admin/users/' + u.id}
                      rightSection={<Icon name="chevronRight" size="sm" />}
                    >
                      Manage
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!users.length && (
            <Text className="p-6" c="dimmed">
              {all.length
                ? 'No users match your search.'
                : 'No users yet. Student profiles and reservations appear here when created.'}
            </Text>
          )}
        </div>
      )}
      <Text size="sm" c="dimmed">
        All-time totals from the backend. Open a profile to edit the display
        name and manage reservations.
      </Text>
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
    return (
      <Alert variant="danger">
        {errorMessage(query.error)}
        <Button variant="quiet" onClick={() => void query.refetch()}>
          Retry
        </Button>
      </Alert>
    );
  return <UserForm key={query.data.user.name} data={query.data} />;
}
function UserForm({ data }: { data: api.AdminUserHistoryResponse }) {
  const action = useAdminAction();
  const [name, setName] = useState(data.user.name),
    [ending, setEnding] = useState<api.AdminReservationDetails | null>(null);
  const today = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Zurich',
  }).format(new Date(data.server_time));
  const dayKey = (date: Date) =>
    new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Zurich' }).format(
      date,
    );
  const activity = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(today + 'T12:00:00Z');
    date.setUTCDate(date.getUTCDate() - 6 + i);
    const key = dayKey(date);
    return {
      key,
      label: date.toLocaleDateString(undefined, {
        weekday: 'short',
        timeZone: 'Europe/Zurich',
      }),
      count: data.reservations.filter(
        (r) => dayKey(new Date(r.starts_at)) === key,
      ).length,
    };
  });
  const max = Math.max(1, ...activity.map((d) => d.count));
  return (
    <div className="admin-page">
      <Link to="/admin/users" className="admin-crumb">
        <Icon name="back" size="sm" />
        Users
      </Link>
      <header className="admin-page-header">
        <div className="admin-user-identity">
          <Avatar size="lg" radius="xl">
            {initials(data.user.name)}
          </Avatar>
          <div>
            <Title order={1}>{data.user.name}</Title>
            <Text c="dimmed">Reservations and study activity</Text>
          </div>
        </div>
      </header>
      <div className="admin-stats">
        <AdminStat label="Reservations" value={data.user.reservations} />
        <AdminStat
          label="Study time"
          value={duration(data.user.study_seconds)}
        />
        <AdminStat
          label="Current bookings"
          value={data.user.live_reservations}
        />
        <AdminStat
          label="Missed check-ins"
          value={data.reservations.filter((r) => r.status === 'no_show').length}
        />
      </div>
      <div className="admin-user-grid">
        <form
          className="admin-form"
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
          <Title order={2}>Profile</Title>
          <TextInput
            label="Display name"
            value={name}
            maxLength={80}
            required
            onChange={(e) => setName(e.currentTarget.value)}
          />
          <div className="grid gap-1">
            <span className="text-label font-bold tracking-label text-text-muted uppercase">
              User ID
            </span>
            <Text className="break-all">{data.user.id}</Text>
          </div>
          <div className="admin-form-actions">
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
        <Card className="admin-user-card">
          <Title order={2}>Reservation activity</Title>
          <Text size="sm" c="dimmed">
            Last 7 days · Europe/Zurich
          </Text>
          <div
            className="admin-activity-bars"
            role="img"
            aria-label={activity
              .map((d) => d.label + ': ' + d.count + ' reservations')
              .join(', ')}
          >
            {activity.map((d) => (
              <div key={d.key} className="grid gap-2 text-center">
                <div className="admin-activity-track">
                  <div
                    className="admin-activity-bar"
                    style={{ height: (d.count / max) * 100 + '%' }}
                  />
                </div>
                <strong className="text-small">{d.count}</strong>
                <span className="text-small text-text-muted">{d.label}</span>
              </div>
            ))}
          </div>
          <Text size="sm" c="dimmed">
            Reservations per day. Study time above is the recorded checked-in
            total.
          </Text>
        </Card>
      </div>
      <Title order={2}>Reservation history</Title>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              {['Study place', 'Seat', 'State', 'Start', 'End', 'Actions'].map(
                (t) => (
                  <th key={t}>{t}</th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {data.reservations.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link
                    className="admin-table-link"
                    to={'/admin/spaces/' + r.space.id + '/seats'}
                  >
                    {r.space.name}
                  </Link>
                </td>
                <td>{r.seat.label}</td>
                <td>
                  <AdminStateChip
                    label={labels[r.status]}
                    tone={tones[r.status]}
                  />
                </td>
                <td>{new Date(r.starts_at).toLocaleString()}</td>
                <td>{new Date(r.ends_at).toLocaleString()}</td>
                <td>
                  {['active', 'pending', 'upcoming', 'on_break'].includes(
                    r.status,
                  ) && (
                    <Button
                      variant="quiet"
                      className="admin-risky"
                      onClick={() => setEnding(r)}
                    >
                      End reservation
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.reservations.length && (
          <Text className="p-6" c="dimmed">
            No reservations yet.
          </Text>
        )}
      </div>
      <AdminFeedback action={action} />
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
        {ending?.space.name} · seat {ending?.seat.label}
      </AdminDialog>
    </div>
  );
}

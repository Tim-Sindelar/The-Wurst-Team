import { useState } from 'react';
import { Link } from 'react-router';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import * as q from '../../api/generated/@tanstack/react-query.gen';
import * as api from '../../api/generated';
import { DecisionSheet } from '../../components/DecisionSheet';
import { AdminFeedback } from './AdminFeedback';
import { adminHeaders, errorMessage, useAdminAction } from './useAdminAction';
export function AdminSpacesPage() {
  const query = useQuery(q.adminListSpacesOptions({ headers: adminHeaders }));
  const action = useAdminAction();
  const [search, setSearch] = useState(''),
    [showDeleted, setShowDeleted] = useState(false),
    [deleting, setDeleting] = useState<api.AdminSpaceSummary | null>(null);
  const active = (query.data?.spaces || []).filter((s) => !s.is_archived);
  const spaces = (query.data?.spaces || []).filter(
    (s) =>
      (showDeleted || !s.is_archived) &&
      s.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Title order={1}>Study spaces</Title>
          <Text c="dimmed">Live spaces, seats and reservations.</Text>
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={() => void query.refetch()}>
            Refresh
          </Button>
          <Button component={Link} to="/admin/new">
            Add space
          </Button>
        </div>
      </header>
      <div className="admin-stats">
        {[
          ['Spaces', active.length],
          ['Free seats', active.reduce((n, s) => n + s.free_seats, 0)],
          ['Occupied', active.reduce((n, s) => n + s.occupied_seats, 0)],
          ['On break', active.reduce((n, s) => n + s.on_break_seats, 0)],
        ].map(([label, value]) => (
          <Card key={label} className="p-4">
            <Text size="sm" c="dimmed">
              {label}
            </Text>
            <strong className="text-heading">{value}</strong>
          </Card>
        ))}
      </div>
      <TextInput
        label="Search spaces"
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
      />
      <Checkbox
        label="Show deleted study places"
        checked={showDeleted}
        onChange={(e) => setShowDeleted(e.currentTarget.checked)}
      />
      {query.isPending ? (
        <Text>Loading study spaces…</Text>
      ) : query.isError ? (
        <Alert variant="danger">{errorMessage(query.error)}</Alert>
      ) : (
        <div className="overflow-x-auto">
          <table className="admin-table">
            <thead>
              <tr>
                {[
                  'Space',
                  'Status',
                  'Seats',
                  'Active',
                  'Free',
                  'Occupied',
                  'On break',
                  'Actions',
                ].map((t) => (
                  <th key={t}>{t}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {spaces.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link
                      className="font-semibold"
                      to={'/admin/spaces/' + s.id + '/seats'}
                    >
                      {s.name}
                    </Link>
                    <Text size="sm" c="dimmed">
                      {s.timezone}
                    </Text>
                  </td>
                  <td>
                    {s.is_archived ? 'Deleted' : s.is_open ? 'Open' : 'Closed'}
                  </td>
                  <td>{s.total_seats}</td>
                  <td>{s.active_seats}</td>
                  <td>{s.free_seats}</td>
                  <td>{s.occupied_seats}</td>
                  <td>{s.on_break_seats}</td>
                  <td>
                    <div className="flex gap-2">
                      <Button
                        variant="quiet"
                        component={Link}
                        to={'/admin/spaces/' + s.id + '/seats'}
                      >
                        Manage
                      </Button>
                      {s.is_archived ? (
                        <Button
                          disabled={action.busy}
                          variant="quiet"
                          onClick={() =>
                            void action.run(
                              () =>
                                api.adminRestoreSpace({
                                  headers: adminHeaders,
                                  path: { space_id: s.id },
                                  throwOnError: true,
                                }),
                              'Study place restored.',
                            )
                          }
                        >
                          Restore
                        </Button>
                      ) : (
                        <Button variant="quiet" onClick={() => setDeleting(s)}>
                          Delete
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!spaces.length && (
            <Text className="p-4">No spaces match your search.</Text>
          )}
        </div>
      )}
      <AdminFeedback action={action} />
      <DecisionSheet
        opened={!!deleting}
        onClose={() => setDeleting(null)}
        title={'Delete ' + deleting?.name + '?'}
        safeLabel="Keep study place"
        actionLabel={action.busy ? 'Deleting…' : 'Delete study place'}
        actionTone="danger"
        onConfirm={() => {
          if (deleting)
            void action.run(
              () =>
                api.adminArchiveSpace({
                  headers: adminHeaders,
                  path: { space_id: deleting.id },
                  throwOnError: true,
                }),
              'Study place deleted. Use Show deleted study places to restore it.',
              () => setDeleting(null),
            );
        }}
      >
        Its seats, layout and reservation history are preserved. End live
        reservations first.
      </DecisionSheet>
    </div>
  );
}

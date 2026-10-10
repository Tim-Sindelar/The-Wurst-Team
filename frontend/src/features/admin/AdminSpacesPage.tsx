import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { Alert, Button, Checkbox, Text, TextInput, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import * as q from '../../api/generated/@tanstack/react-query.gen';
import * as api from '../../api/generated';
import { AdminDialog } from './AdminDialog';
import { Icon } from '../../components/Icon';
import { AdminStat } from './AdminStat';
import { AdminStateChip } from './AdminStateChip';
import { AdminFeedback } from './AdminFeedback';
import { adminHeaders, errorMessage, useAdminAction } from './useAdminAction';
export function AdminSpacesPage() {
  const query = useQuery(q.adminListSpacesOptions({ headers: adminHeaders }));
  const action = useAdminAction();
  const [search, setSearch] = useState(''),
    [showDeleted, setShowDeleted] = useState(false),
    [deleting, setDeleting] = useState<api.AdminSpaceSummary | null>(null),
    [permanentlyDeleting, setPermanentlyDeleting] =
      useState<api.AdminSpaceSummary | null>(null),
    [permanentBusy, setPermanentBusy] = useState(false);
  const busy = action.busy || permanentBusy;
  const active = (query.data?.spaces || []).filter((s) => !s.is_archived);
  const spaces = (query.data?.spaces || []).filter(
    (s) =>
      (showDeleted || !s.is_archived) &&
      s.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="admin-page">
      <header className="admin-page-header">
        <div>
          <Title order={1}>Study spaces</Title>
          <Text c="dimmed">Live spaces, seats and reservations.</Text>
        </div>
        <div className="admin-header-actions">
          <Button
            variant="secondary"
            leftSection={<Icon name="check" size="sm" />}
            onClick={() => void query.refetch()}
          >
            Refresh
          </Button>
          <Button
            component={Link}
            to="/admin/new"
            leftSection={<Icon name="plus" size="sm" />}
          >
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
          <AdminStat
            key={label}
            label={String(label)}
            value={value}
            detail={
              label === 'Free seats'
                ? 'of ' +
                  active.reduce((n, s) => n + s.active_seats, 0) +
                  ' active'
                : undefined
            }
          />
        ))}
      </div>
      <div className="admin-toolbar">
        <TextInput
          className="admin-search"
          aria-label="Search spaces"
          placeholder="Search spaces"
          leftSection={<Icon name="search" />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />
        <Checkbox
          label="Show deleted study places"
          checked={showDeleted}
          onChange={(e) => setShowDeleted(e.currentTarget.checked)}
        />
      </div>
      {query.isPending ? (
        <Text>Loading study spaces…</Text>
      ) : query.isError ? (
        <Alert variant="danger">{errorMessage(query.error)}</Alert>
      ) : (
        <div className="admin-table-wrap">
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
                  <th
                    key={t}
                    className={
                      [
                        'Seats',
                        'Active',
                        'Free',
                        'Occupied',
                        'On break',
                      ].includes(t)
                        ? 'num'
                        : t === 'Actions'
                          ? 'actions'
                          : undefined
                    }
                  >
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {spaces.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link
                      className="admin-table-link whitespace-nowrap"
                      to={'/admin/spaces/' + s.id + '/seats'}
                    >
                      {s.name}
                    </Link>
                    <Text size="sm" c="dimmed">
                      {s.timezone}
                    </Text>
                  </td>
                  <td>
                    <AdminStateChip
                      label={
                        s.is_archived
                          ? 'Deleted'
                          : s.is_open
                            ? 'Open'
                            : 'Closed'
                      }
                      tone={
                        !s.is_archived && s.is_open ? 'free' : 'unavailable'
                      }
                    />
                  </td>
                  <td className="num">{s.total_seats}</td>
                  <td className="num">{s.active_seats}</td>
                  <td className="num">{s.free_seats}</td>
                  <td className="num">{s.occupied_seats}</td>
                  <td className="num">{s.on_break_seats}</td>
                  <td>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        variant="quiet"
                        component={Link}
                        to={'/admin/spaces/' + s.id + '/seats'}
                      >
                        Manage
                      </Button>
                      {s.is_archived ? (
                        <>
                          <Button
                            disabled={busy}
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
                          <Button
                            disabled={busy}
                            variant="quiet"
                            className="admin-risky"
                            onClick={() => setPermanentlyDeleting(s)}
                          >
                            Delete permanently
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="quiet"
                          className="admin-risky"
                          disabled={busy}
                          onClick={() => setDeleting(s)}
                        >
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
      <Text size="sm" c="dimmed">
        Free means nobody has reserved the seat or is using it right now.
        Switched-off and closed seats never count as free. Occupied counts
        checked-in sessions only.
      </Text>
      <AdminFeedback action={action} />
      <AdminDialog
        opened={!!deleting}
        busy={action.busy}
        onClose={() => setDeleting(null)}
        title={'Delete ' + deleting?.name + '?'}
        safeLabel="Keep study place"
        actionLabel={action.busy ? 'Deleting…' : 'Delete study place'}
        actionTone="danger"
        onConfirm={() => {
          if (deleting && !busy)
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
      </AdminDialog>
      {permanentlyDeleting && (
        <PermanentDeleteDialog
          space={permanentlyDeleting}
          onClose={() => setPermanentlyDeleting(null)}
          onBusyChange={setPermanentBusy}
        />
      )}
    </div>
  );
}

function PermanentDeleteDialog({
  space,
  onClose,
  onBusyChange,
}: {
  space: api.AdminSpaceSummary;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const action = useAdminAction();
  const inFlight = useRef(false);
  async function confirm() {
    if (inFlight.current) return;
    inFlight.current = true;
    onBusyChange(true);
    try {
      await action.run(
        () =>
          api.adminPermanentlyDeleteSpace({
            headers: adminHeaders,
            path: { space_id: space.id },
            throwOnError: true,
          }),
        'Study space permanently deleted.',
        onClose,
      );
    } finally {
      inFlight.current = false;
      onBusyChange(false);
    }
  }
  return (
    <AdminDialog
      opened
      busy={action.busy}
      onClose={onClose}
      title={'Permanently delete ' + space.name + '?'}
      safeLabel="Keep deleted space"
      actionLabel={action.busy ? 'Deleting…' : 'Delete permanently'}
      actionTone="danger"
      onConfirm={() => void confirm()}
    >
      <Text>
        This permanently removes the study space, its layout, seats and
        reservation history. Existing seat QR links will stop working. It cannot
        be restored. The campus room remains available to create again.
      </Text>
      {action.error && (
        <Alert variant="danger" role="alert">
          {action.error}
        </Alert>
      )}
    </AdminDialog>
  );
}

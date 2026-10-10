import { useState, useRef } from 'react';
import { useOutletContext } from 'react-router';
import { Button, NativeSelect, Text, TextInput, Title } from '@mantine/core';
import * as api from '../../api/generated';
import { Icon } from '../../components/Icon';
import { AdminDialog } from './AdminDialog';
import { AdminFeedback } from './AdminFeedback';
import { adminHeaders, useAdminAction } from './useAdminAction';
export function AdminClosuresPage() {
  const space = useOutletContext<api.AdminSpaceOverview>(),
    action = useAdminAction(),
    form = useRef<HTMLFormElement>(null);
  const [seat, setSeat] = useState(''),
    [start, setStart] = useState(''),
    [end, setEnd] = useState(''),
    [reason, setReason] = useState(''),
    [creating, setCreating] = useState(false),
    [removing, setRemoving] = useState<api.ClosureDetails | null>(null);
  return (
    <div className="grid gap-6">
      <header className="admin-page-header">
        <div>
          <Title order={2}>Closures</Title>
          <Text c="dimmed">
            Temporarily close the whole study space or individual seats.
          </Text>
        </div>
        <Button
          disabled={space.is_archived}
          leftSection={<Icon name="plus" size="sm" />}
          onClick={() => setCreating(true)}
        >
          Add closure
        </Button>
      </header>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Scope</th>
              <th>From</th>
              <th>Until</th>
              <th>Reason</th>
              <th className="actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {space.closures.map((c) => (
              <tr key={c.id}>
                <td className="font-semibold">
                  {c.seat_id
                    ? 'Seat ' +
                      space.seats.find((s) => s.id === c.seat_id)?.label
                    : 'Whole study place'}
                </td>
                <td>{new Date(c.starts_at).toLocaleString()}</td>
                <td>{new Date(c.ends_at).toLocaleString()}</td>
                <td>{c.reason || 'No reason specified'}</td>
                <td className="actions">
                  <Button
                    variant="quiet"
                    className="admin-risky"
                    onClick={() => setRemoving(c)}
                  >
                    Remove closure
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!space.closures.length && (
          <Text c="dimmed" className="p-6">
            No current or upcoming closures.
          </Text>
        )}
      </div>
      <AdminDialog
        opened={creating}
        onClose={() => setCreating(false)}
        title="Add closure"
        safeLabel="Cancel"
        actionLabel={action.busy ? 'Adding…' : 'Add closure'}
        onConfirm={() => {
          if (!action.busy) form.current?.requestSubmit();
        }}
      >
        <form
          ref={form}
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(
              (force) =>
                api.adminCreateClosure({
                  path: { space_id: space.id },
                  headers: adminHeaders,
                  query: { force },
                  body: {
                    seat_id: seat || null,
                    starts_at: new Date(start).toISOString(),
                    ends_at: new Date(end).toISOString(),
                    reason: reason || null,
                  },
                  throwOnError: true,
                }),
              'Closure added.',
              () => {
                setCreating(false);
                setStart('');
                setEnd('');
                setReason('');
              },
            );
          }}
        >
          <NativeSelect
            label="Scope"
            data={[
              { value: '', label: 'Whole study place' },
              ...space.seats.map((s) => ({
                value: s.id,
                label: 'Seat ' + s.label,
              })),
            ]}
            value={seat}
            onChange={(e) => setSeat(e.currentTarget.value)}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput
              label="From"
              type="datetime-local"
              required
              value={start}
              onChange={(e) => setStart(e.currentTarget.value)}
            />
            <TextInput
              label="Until"
              type="datetime-local"
              required
              value={end}
              min={start}
              onChange={(e) => setEnd(e.currentTarget.value)}
            />
          </div>
          <Text size="sm" c="dimmed">
            Dates use your browser time zone:{' '}
            {Intl.DateTimeFormat().resolvedOptions().timeZone}.
          </Text>
          <TextInput
            label="Reason"
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.currentTarget.value)}
          />
        </form>
        {action.error && (
          <Text role="alert" c="var(--color-danger)">
            {action.error}
          </Text>
        )}
      </AdminDialog>
      <AdminFeedback action={action} />
      <AdminDialog
        opened={!!removing}
        onClose={() => setRemoving(null)}
        title="Remove this closure?"
        safeLabel="Keep closure"
        actionLabel="Remove closure"
        actionTone="danger"
        onConfirm={() => {
          if (removing)
            void action.run(
              (force) =>
                api.adminDeleteClosure({
                  path: { space_id: space.id, closure_id: removing.id },
                  headers: adminHeaders,
                  query: { force },
                  throwOnError: true,
                }),
              'Closure removed.',
              () => setRemoving(null),
            );
        }}
      >
        This reopens the selected seats and may change upcoming reservations.
      </AdminDialog>
    </div>
  );
}

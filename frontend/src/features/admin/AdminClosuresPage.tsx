import { useState } from 'react';
import { useOutletContext } from 'react-router';
import {
  Button,
  Card,
  NativeSelect,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import * as api from '../../api/generated';
import { DecisionSheet } from '../../components/DecisionSheet';
import { AdminFeedback } from './AdminFeedback';
import { adminHeaders, useAdminAction } from './useAdminAction';
export function AdminClosuresPage() {
  const space = useOutletContext<api.AdminSpaceOverview>();
  const action = useAdminAction();
  const [seat, setSeat] = useState(''),
    [start, setStart] = useState(''),
    [end, setEnd] = useState(''),
    [reason, setReason] = useState(''),
    [removing, setRemoving] = useState<api.ClosureDetails | null>(null);
  return (
    <div className="grid gap-4">
      <Title order={2}>Closures</Title>
      <form
        className="grid max-w-phone gap-3"
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
        <Text size="sm" c="dimmed">
          Dates use your browser time zone:{' '}
          {Intl.DateTimeFormat().resolvedOptions().timeZone}. Saved with a UTC
          offset.
        </Text>
        <TextInput
          label="Reason"
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.currentTarget.value)}
        />
        <Button type="submit" disabled={action.busy || space.is_archived}>
          Add closure
        </Button>
      </form>
      {space.closures.map((c) => (
        <Card key={c.id} className="grid gap-2 p-4">
          <strong>
            {c.seat_id
              ? 'Seat ' + space.seats.find((s) => s.id === c.seat_id)?.label
              : 'Whole study place'}
          </strong>
          <Text>
            {new Date(c.starts_at).toLocaleString()} –{' '}
            {new Date(c.ends_at).toLocaleString()}
          </Text>
          <Text c="dimmed">{c.reason || 'No reason specified'}</Text>
          <Button variant="quiet" onClick={() => setRemoving(c)}>
            Remove closure
          </Button>
        </Card>
      ))}
      {!space.closures.length && (
        <Text c="dimmed">No current or upcoming closures.</Text>
      )}
      <AdminFeedback action={action} />
      <DecisionSheet
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
      </DecisionSheet>
    </div>
  );
}

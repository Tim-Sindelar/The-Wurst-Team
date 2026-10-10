import { useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router';
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
export function AdminSettingsPage() {
  const space = useOutletContext<api.AdminSpaceOverview>();
  return (
    <SettingsForm
      key={space.name + space.timezone + space.is_archived}
      space={space}
    />
  );
}
function SettingsForm({ space }: { space: api.AdminSpaceOverview }) {
  const navigate = useNavigate(),
    action = useAdminAction();
  const [name, setName] = useState(space.name),
    [timezone, setTimezone] = useState(space.timezone),
    [deleting, setDeleting] = useState(false);
  return (
    <div className="grid gap-6">
      <form
        className="grid max-w-phone gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(
            (force) =>
              api.adminUpdateSpace({
                path: { space_id: space.id },
                headers: adminHeaders,
                query: { force },
                body: { name, timezone },
                throwOnError: true,
              }),
            'Settings saved.',
          );
        }}
      >
        <TextInput
          label="Name"
          value={name}
          required
          maxLength={200}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <NativeSelect
          label="Time zone"
          data={['Europe/Zurich', 'Europe/Berlin', 'UTC']}
          value={timezone}
          onChange={(e) => setTimezone(e.currentTarget.value)}
        />
        <Text size="sm" c="dimmed">
          Location and room border come from the campus room chosen when
          creating this study place.
        </Text>
        <div className="flex gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setName(space.name);
              setTimezone(space.timezone);
            }}
          >
            Discard changes
          </Button>
          <Button type="submit" disabled={action.busy}>
            Save changes
          </Button>
        </div>
      </form>
      <Card className="grid gap-3 p-4">
        <Title order={2}>
          {space.is_archived ? 'Restore study place' : 'Delete study place'}
        </Title>
        <Text c="dimmed">
          The layout, seats and reservation history are preserved.
        </Text>
        {space.is_archived ? (
          <Button
            variant="secondary"
            disabled={action.busy}
            onClick={() =>
              void action.run(
                () =>
                  api.adminRestoreSpace({
                    path: { space_id: space.id },
                    headers: adminHeaders,
                    throwOnError: true,
                  }),
                'Study place restored.',
              )
            }
          >
            Restore study place
          </Button>
        ) : (
          <Button variant="danger" onClick={() => setDeleting(true)}>
            Delete study place
          </Button>
        )}
      </Card>
      <AdminFeedback action={action} />
      <DecisionSheet
        opened={deleting}
        onClose={() => setDeleting(false)}
        title={'Delete ' + space.name + '?'}
        safeLabel="Keep study place"
        actionLabel="Delete study place"
        actionTone="danger"
        onConfirm={() =>
          void action.run(
            () =>
              api.adminArchiveSpace({
                path: { space_id: space.id },
                headers: adminHeaders,
                throwOnError: true,
              }),
            'Study place deleted.',
            () => navigate('/admin'),
          )
        }
      >
        End current and upcoming reservations before deleting. You can restore
        this place from the spaces list.
      </DecisionSheet>
    </div>
  );
}

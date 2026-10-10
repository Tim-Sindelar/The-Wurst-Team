import { Alert, Text } from '@mantine/core';
import { AdminDialog } from './AdminDialog';
import { StatusBanner } from '../../components/StatusBanner';
import type { useAdminAction } from './useAdminAction';
export function AdminFeedback({
  action,
}: {
  action: ReturnType<typeof useAdminAction>;
}) {
  return (
    <>
      {action.error && (
        <Alert variant="danger" role="alert">
          {action.error}
        </Alert>
      )}
      {!action.globalNotice && (
        <StatusBanner
          placement="admin"
          opened={!!action.notice}
          onClose={() => action.setNotice('')}
          title="Updated"
          icon="check"
        >
          {action.notice}
        </StatusBanner>
      )}
      <AdminDialog
        opened={!!action.conflict}
        onClose={() => action.setConflict(null)}
        title="Apply changes to existing reservations?"
        safeLabel="Keep reservations"
        actionLabel={action.busy ? 'Applying…' : 'Apply changes'}
        actionTone="danger"
        onConfirm={() => {
          if (!action.busy) action.conflict?.retry();
        }}
      >
        <span>
          {action.conflict?.impacts.map((i) => (
            <Text component="span" className="block" key={i.reservation_id}>
              {i.user.display_name} · {i.action} ·{' '}
              {new Date(i.previous_ends_at).toLocaleString()} →{' '}
              {new Date(i.new_ends_at).toLocaleString()}
            </Text>
          ))}
        </span>
      </AdminDialog>
    </>
  );
}

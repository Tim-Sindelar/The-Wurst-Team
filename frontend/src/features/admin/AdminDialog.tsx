import { Button, Modal } from '@mantine/core';
import type { ReactNode } from 'react';
export function AdminDialog({
  opened,
  onClose,
  title,
  children,
  safeLabel,
  actionLabel,
  actionTone = 'primary',
  onConfirm,
  busy = false,
}: {
  opened: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  safeLabel: string;
  actionLabel: ReactNode;
  actionTone?: 'primary' | 'danger';
  onConfirm: () => void;
  busy?: boolean;
}) {
  return (
    <Modal
      opened={opened}
      onClose={() => {
        if (!busy) onClose();
      }}
      closeOnClickOutside={!busy}
      closeOnEscape={!busy}
      centered
      title={title}
      size="var(--spacing-admin-dialog)"
      closeButtonProps={{ 'aria-label': 'Close', disabled: busy }}
    >
      <div className="admin-dialog-body">{children}</div>
      <div className="admin-dialog-actions">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          {safeLabel}
        </Button>
        <Button variant={actionTone} onClick={onConfirm} disabled={busy}>
          {actionLabel}
        </Button>
      </div>
    </Modal>
  );
}

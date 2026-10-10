import { Card } from '@mantine/core';
import type { ReactNode } from 'react';
export function AdminStat({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <Card className="admin-stat">
      <span className="text-label font-bold tracking-label text-text-muted uppercase">
        {label}
      </span>
      <span className="text-heading font-bold tabular-nums">
        {value}
        {detail && (
          <span className="ml-1 text-small text-text-muted">{detail}</span>
        )}
      </span>
    </Card>
  );
}

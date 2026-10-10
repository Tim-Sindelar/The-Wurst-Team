import { Badge } from '@mantine/core';
const tones = {
  free: '[--state:var(--color-seat-free)]',
  reserved: '[--state:var(--color-seat-reserved)]',
  occupied: '[--state:var(--color-seat-occupied)]',
  on_break: '[--state:var(--color-seat-break)]',
  claimable: '[--state:var(--color-seat-bookable)]',
  unavailable: '[--state:var(--color-seat-occupied)]',
  danger: '[--state:var(--color-danger)]',
  accent: '[--state:var(--color-accent)]',
};
export function AdminStateChip({
  label,
  tone = 'unavailable',
}: {
  label: string;
  tone?: keyof typeof tones;
}) {
  return (
    <Badge
      className={tones[tone]}
      leftSection={<span className="block size-2 rounded-full bg-(--state)" />}
    >
      {label}
    </Badge>
  );
}

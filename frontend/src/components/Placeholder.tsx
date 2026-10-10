import { Text } from '@mantine/core';
import { Icon, type IconName } from './Icon';

type PlaceholderProps = {
  icon: IconName;
  label: string;
  description: string;
};

/** Dashed stand-in for something built later (the campus map). Fills the screen. */
export function Placeholder({ icon, label, description }: PlaceholderProps) {
  return (
    <div
      className="grid min-h-[calc(100dvh-4.625rem-var(--spacing)*4)] flex-1 place-content-center justify-items-center gap-2 rounded-card border border-dashed border-border-strong p-4 text-center text-text-muted"
      role="img"
      aria-label={description}
    >
      <Icon name={icon} size="lg" />
      <Text>{label}</Text>
    </div>
  );
}

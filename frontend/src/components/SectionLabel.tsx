import { Text } from '@mantine/core';
import type { ReactNode } from 'react';

type SectionLabelProps = {
  children: ReactNode;
  as?: 'h2' | 'h3' | 'p';
  id?: string;
};

/** Small uppercase label above a section or inside a timer card. */
export function SectionLabel({ children, as = 'h2', id }: SectionLabelProps) {
  return (
    <Text
      component={as}
      id={id}
      className="text-label font-bold tracking-label text-text-muted uppercase"
    >
      {children}
    </Text>
  );
}

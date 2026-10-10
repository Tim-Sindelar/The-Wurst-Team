import { ActionIcon, Title } from '@mantine/core';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { cx } from './cx';
import { Icon } from './Icon';
import { ThemeToggle } from './ThemeToggle';
import { socialDemoEnabled } from '../features';

/* The phone column every screen sits in: 390px wide, centred on desktop,
   full height, with the action bar pinned to the bottom. */

export function Screen({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        'relative mx-auto flex w-full max-w-phone flex-col border-x border-border bg-bg',
        socialDemoEnabled ? 'min-h-full' : 'min-h-dvh',
        className,
      )}
    >
      {children}
    </div>
  );
}

type ScreenHeaderProps = {
  title: string;
  backTo: string;
  backLabel: string;
};

/** Top bar: back arrow, screen title, theme switch. */
export function ScreenHeader({ title, backTo, backLabel }: ScreenHeaderProps) {
  return (
    <header className="flex min-h-16 items-center gap-2 border-b border-border bg-surface pr-2 pl-4">
      <ActionIcon component={Link} to={backTo} aria-label={backLabel}>
        <Icon name="back" />
      </ActionIcon>
      <Title order={1} className="min-w-0 flex-1 truncate text-title font-bold">
        {title}
      </Title>
      <ThemeToggle />
    </header>
  );
}

/** Scrolling content of a screen, 16px gutter, 16px between blocks. */
export function ScreenMain({
  children,
  fit = false,
}: {
  children: ReactNode;
  fit?: boolean;
}) {
  return (
    <main
      className={cx(
        'flex flex-1 flex-col px-4 py-4',
        fit ? 'min-h-0 gap-3 [&>*]:shrink-0' : 'gap-4',
      )}
    >
      {children}
    </main>
  );
}

/** Bottom bar holding the screen's one primary action (and at most a secondary). */
export function ActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 grid gap-2 border-t border-border bg-bg px-4 pt-3 pb-[calc(--spacing(3)+env(safe-area-inset-bottom))]">
      {children}
    </div>
  );
}
